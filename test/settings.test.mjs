import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildConfigSchema, loadHostSchema, readHostConfig, importLegacyConfig, wireConfigSettings } from '../npm-package/lib/config-settings.js';

function hostSettings(user = {}, value = user) {
  const row = { ns: 'oh-my-dsh-slim', revision: 7, user, value };
  return {
    row, calls: [], describe() { return [row]; },
    async update(ns, patch, expected) {
      assert.equal(ns, row.ns);
      assert.equal(expected, row.revision);
      this.calls.push({ ns, patch, expected });
      row.user = structuredClone(patch); row.value = structuredClone(patch); row.revision++;
    },
  };
}
function fixture(t, document) {
  const dir = mkdtempSync(join(tmpdir(), 'omds-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'oh-my-dsh-slim.json');
  writeFileSync(path, typeof document === 'string' ? document : JSON.stringify(document));
  return path;
}
const validate = doc => { if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('invalid document'); };

test('Config resolves host schema before apply without profile-local duplicates', async () => {
  const schema = {};
  const calls = [];
  assert.equal(await loadHostSchema({ hostBase: 'file:///C:/host/resources/app.asar/dsh/node_modules/x/y.js', resolve(base, name) { calls.push([base, name]); return 'C:/host/schema.mjs'; }, importModule: async () => ({ default: schema }) }), schema);
  assert.equal(calls[0][1], '@deepseek-ai/schemastery');
  let imports = 0;
  assert.equal(await loadHostSchema({ hostBase: 'file:///C:/host/entry.js', resolve() { throw new Error('missing'); }, importModule: async () => { imports++; } }), undefined);
  assert.equal(imports, 0, 'a failed host resolution cannot silently fall back to stale profile peer');
});

test('modern descriptor values read live and are detached', () => {
  const settings = hostSettings({}, { roles: { oracle: { model: 'first' } } });
  const value = readHostConfig({ settings });
  value.roles.oracle.model = 'modified';
  assert.equal(readHostConfig({ settings }).roles.oracle.model, 'first');
  settings.row.value.roles.oracle.model = 'second';
  assert.equal(readHostConfig({ settings }).roles.oracle.model, 'second');
});

test('empty or missing forms retain file-channel fallback', () => {
  assert.equal(readHostConfig({ settings: hostSettings() }), undefined);
  assert.equal(readHostConfig({ settings: { describe: () => [] } }), undefined);
});

test('legacy JSON imports into empty user layer despite inherited values; file untouched', async t => {
  const doc = { presets: { custom: { oracle: { model: 'legacy' } } }, preset: 'custom', mcpServers: { docs: { transport: 'stdio', command: 'node' } } };
  const path = fixture(t, doc);
  const original = readFileSync(path, 'utf8');
  const settings = hostSettings({}, { preset: 'inherited' });
  assert.equal(await importLegacyConfig(settings, { path, validate }), true);
  assert.deepEqual(settings.calls[0], { ns: 'oh-my-dsh-slim', patch: doc, expected: 7 });
  assert.equal(readFileSync(path, 'utf8'), original);
  assert.equal(await importLegacyConfig(settings, { path, validate }), false);
  assert.equal(settings.calls.length, 1);
});

test('existing profile overrides are never overwritten', async t => {
  const path = fixture(t, { preset: 'legacy' });
  const settings = hostSettings({ preset: 'profile' });
  assert.equal(await importLegacyConfig(settings, { path, validate }), false);
  assert.equal(settings.calls.length, 0);
});

for (const [label, document, reject] of [
  ['malformed JSON', '{broken', false], ['invalid document', [], false], ['settings conflict', {}, true],
]) test(`${label} preserves original and reports import refusal`, async t => {
  const path = fixture(t, document);
  const original = readFileSync(path, 'utf8');
  const settings = hostSettings();
  if (reject) settings.update = async () => { throw new Error('revision conflict'); };
  const warnings = [];
  assert.equal(await importLegacyConfig(settings, { path, validate, log: { warn: msg => warnings.push(msg) } }), false);
  assert.equal(readFileSync(path, 'utf8'), original);
  assert.equal(warnings.length, 1);
});

test('injection owns runtime reader and waits for loader settlement before import', async t => {
  const path = fixture(t, { preset: 'legacy' });
  const settings = hostSettings();
  let settle;
  const ready = new Promise(resolve => { settle = resolve; });
  const disposers = [];
  const child = { settings, root: { loader: { await: () => ready } }, effect(setup) { disposers.push(setup()); } };
  wireConfigSettings({ inject(deps, callback) { assert.deepEqual(deps, ['settings']); callback(child); } }, { path, validate });
  assert.equal(settings.calls.length, 0);
  settle(); await ready; await new Promise(resolve => setImmediate(resolve));
  assert.equal(settings.calls.length, 1);
  assert.deepEqual(readHostConfig(), { preset: 'legacy' });
  for (const dispose of disposers) dispose();
  assert.equal(readHostConfig(), undefined);
});

test('disposed injection cannot start deferred legacy import', async t => {
  const path = fixture(t, {});
  const settings = hostSettings();
  let settle;
  const ready = new Promise(resolve => { settle = resolve; });
  const disposers = [];
  wireConfigSettings({ inject(_deps, cb) { cb({ settings, root: { loader: { await: () => ready } }, effect(setup) { disposers.push(setup()); } }); } }, { path, validate });
  for (const dispose of disposers) dispose();
  settle(); await ready; await new Promise(resolve => setImmediate(resolve));
  assert.equal(settings.calls.length, 0);
});

// Optional integration fixture: point DSH_HOST_REFERENCE_DIR at the host's
// node_modules root (the directory containing @deepseek-ai), or use the local
// extracted sibling. Missing fixtures skip integrations, never seam-only tests.
const hostReferenceRoot = process.env.DSH_HOST_REFERENCE_DIR
  ? pathToFileURL(resolve(process.env.DSH_HOST_REFERENCE_DIR) + '/').href
  : new URL('../../dsh-host-reference/dsh/node_modules/', import.meta.url).href;
const hostSchemaUrl = new URL('@deepseek-ai/schemastery/lib/index.mjs', hostReferenceRoot);
const hostSchemaSkip = existsSync(hostSchemaUrl) ? false
  : `Host schema integration unavailable at ${hostSchemaUrl.href}; set DSH_HOST_REFERENCE_DIR to a host node_modules root containing @deepseek-ai (or provide the extracted dsh-host-reference sibling).`;

test('schema preserves document fields and marks user fields volatile, not companion controls', { skip: hostSchemaSkip }, async () => {
  // No install: retain the actual host's schema implementation when available.
  const { default: z } = await import(hostSchemaUrl.href);
  const schema = buildConfigSchema(z);
  for (const key of ['preset', 'presets', 'roles', 'orchestrator', 'mcpServers', 'advanced']) assert.equal(schema.dict[key].meta.volatile, true, key);
  assert.notEqual(schema.dict.verbose.meta.volatile, true);
  const parsed = schema({ roles: { oracle: { model: 'native', effort: 'xhigh', mcps: ['docs'] } }, mcpServers: { docs: { transport: 'stdio', command: 'node', args: ['server'] } } });
  assert.equal(parsed.roles.get().oracle.model, 'native');
  assert.equal(parsed.mcpServers.get().docs.command, 'node');
  assert.throws(() => schema({ roles: { oracle: { effort: 'invalid space' } } }));
});

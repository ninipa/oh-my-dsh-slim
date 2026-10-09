import assert from 'node:assert/strict';
import test from 'node:test';
import { upstream } from './upstream-baseline.mjs';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfigDocument, EFFORT_LEVELS } from '../npm-package/preset/config.js';
import { apply as applyRequests } from '../npm-package/preset/subagent-roles.js';
import { latestOwnAssistant } from '../npm-package/preset/subagent-result.js';
import { escalationArgsAreDoomed, stripEscalationArgs, isDelegatedChild } from '../npm-package/preset/sandbox-strip.js';

const defaultDocument = JSON.parse(upstream('defaults.json'));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'omds-upstream-'));
  const env = { ...process.env };
  const file = join(dir, 'config.json');
  process.env.OH_MY_DSH_SLIM_CONFIG = file;
  process.env.OH_MY_DSH_SLIM_PROFILE_DIR = dir;
  process.env.DSH_HOME = dir;
  writeFileSync(join(dir, 'defaults.json'), JSON.stringify(defaultDocument));
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); rmSync(dir, { recursive: true, force: true }); });
  const source = upstream('config-loader.js').replace(/^import .*;\r?\n/gm, '').replace(/const ROOT = .*;/, 'const ROOT = baselineDir;').replace(/export /g, '');
  const original = new Function('existsSync', 'readFileSync', 'basename', 'dirname', 'join', 'fileURLToPath', 'baselineDir', source + '\nreturn { loadConfig, validateConfigDocument, EFFORT_LEVELS };')(existsSync, readFileSync, basename, dirname, join, fileURLToPath, dir);
  return { dir, original, save: doc => writeFileSync(file, JSON.stringify(doc)) };
}

for (const [label, doc] of [
  ['factory defaults', {}],
  ['compact overrides and deny union', { roles: { oracle: { model: 'custom', deny: ['bash'], tools: [] } }, advanced: { roles: { oracle: { deny: ['read'], temperature: 0.8, personaAppend: 'append' } } } }],
  ['compact replaces legacy role entry', { presets: { 'my-dsh-normal': { oracle: { model: 'legacy', effort: 'low' } } }, roles: { oracle: { temperature: 0.4 } } }],
  ['custom preset inherits factory roles', { preset: 'custom', presets: { custom: { fixer: { model: 'custom-fixer' } } } }],
  ['top-level orchestrator', { orchestrator: { effort: 'low', mcps: ['context7'] } }],
  ['observer force disabled', { roles: { observer: { enabled: true } } }],
]) test('upstream config parity: ' + label, t => {
  const f = fixture(t); f.save(doc);
  assert.deepEqual(loadConfig(), f.original.loadConfig());
  assert.deepEqual(EFFORT_LEVELS, f.original.EFFORT_LEVELS);
});

test('bundled default document is byte-for-byte upstream JSON behavior', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../npm-package/preset/defaults.json', import.meta.url), 'utf8')), defaultDocument);
});

test('unknown named presets fail load and validation just like upstream', t => {
  const f = fixture(t); f.save({ preset: 'missing' });
  for (const fn of [loadConfig, () => f.original.loadConfig(), () => validateConfigDocument({ preset: 'missing' }), () => f.original.validateConfigDocument({ preset: 'missing' })]) assert.throws(fn, /unknown preset/);
});

test('channel priority remains explicit file > snapshot > live settings > legacy', t => {
  const f = fixture(t);
  f.save({ roles: { fixer: { model: 'explicit' } } });
  writeFileSync(join(f.dir, 'profile.json'), JSON.stringify({ roles: { fixer: { model: 'snapshot' } } }));
  writeFileSync(join(f.dir, 'oh-my-dsh-slim.json'), JSON.stringify({ roles: { fixer: { model: 'legacy' } } }));
  const row = { ns: 'oh-my-dsh-slim', value: { roles: { fixer: { model: 'native' } } } };
  const ctx = { settings: { describe: () => [row] } };
  assert.equal(loadConfig(ctx).roles.fixer.model, 'explicit');
  delete process.env.OH_MY_DSH_SLIM_CONFIG;
  assert.equal(loadConfig(ctx).roles.fixer.model, 'snapshot');
  // Change snapshot directory rather than deleting a file.
  process.env.OH_MY_DSH_SLIM_PROFILE_DIR = join(f.dir, 'absent');
  assert.equal(loadConfig(ctx).roles.fixer.model, 'native');
  row.value.roles.fixer.model = 'hot-edit';
  assert.equal(loadConfig(ctx).roles.fixer.model, 'hot-edit');
  assert.equal(loadConfig({}).roles.fixer.model, 'legacy');
});

function requestHarness(llm) {
  let listener;
  applyRequests({ effect: fn => fn(), on: (_name, fn) => { listener = fn; }, get: () => llm });
  return (role, resolved) => listener({ agent: { options: {}, session: { header: { origin: 'subagent', delegationDepth: 1 }, ownEvents: () => role ? [{ type: 'subagent/descriptor', data: { persona: 'oh-my-dsh-slim-role:' + role + '.' } }] : [] } } }, async () => resolved);
}

test('role temperature overrides inherited temperature; none preserves effort', async t => {
  const f = fixture(t); f.save({ roles: { fixer: { effort: 'none', temperature: 0.6 } } });
  assert.deepEqual(await requestHarness()('fixer', { temperature: 1, reasoningEffort: 'low' }), { temperature: 0.6, reasoningEffort: 'low' });
  assert.deepEqual(await requestHarness()(undefined, {}), { reasoningEffort: 'high', temperature: 0.1 });
});

test('effort metadata validation uses rc.2 route and fails open on lookup failure', async t => {
  const f = fixture(t); f.save({ roles: { fixer: { effort: 'xhigh' } } });
  const run = requestHarness({ resolveModelInfo: async (provider, model) => { assert.equal(provider, 'actual'); assert.equal(model, 'actual-model'); return { reasoning: { efforts: [{ id: 'low' }] } }; } });
  await assert.rejects(run('fixer', { provider: 'actual', model: 'actual-model' }), /not offered/);
  assert.equal((await requestHarness({ resolveModelInfo: async () => { throw new Error('unknown'); } })('fixer', {})).reasoningEffort, 'xhigh');
  assert.equal((await requestHarness({ resolveModelInfo: () => { throw new Error('must not query unchanged effort'); } })('fixer', { reasoningEffort: 'xhigh' })).reasoningEffort, 'xhigh');
});

test('result scans inherited surface as upstream does (no silent bug fix)', () => {
  const event = { seq: 0, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'inherited' }] } } };
  assert.deepEqual(latestOwnAssistant({ events: [event], inheritedEventCount: 1 }), { kind: 'result', seq: 0, text: 'inherited' });
});

test('sandbox leaves valid widening intact and strips fixed child escalation', () => {
  const wider = { 'read-only': ['workspace-write', 'danger-full-access'], 'workspace-write': ['danger-full-access'] };
  assert.equal(escalationArgsAreDoomed('workspace-write', 'valid reason', 'read-only', wider), false);
  assert.equal(escalationArgsAreDoomed('workspace-write', 'valid reason', 'workspace-write', wider), true);
  assert.equal(escalationArgsAreDoomed('workspace-write', '', 'read-only', wider), true);
  assert.deepEqual(stripEscalationArgs({ command: 'test', sandbox_permissions: 'danger-full-access', justification: 'test' }), { command: 'test' });
  assert.equal(isDelegatedChild({ session: { header: { origin: 'subagent' } } }), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { upstream } from './upstream-baseline.mjs';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfigDocument, EFFORT_LEVELS, UPSTREAM_ROLE_IDS } from '../npm-package/preset/config.js';
import { apply as applyRequests } from '../npm-package/preset/subagent-roles.js';
import { latestOwnAssistant } from '../npm-package/preset/subagent-result.js';
import { escalationArgsAreDoomed, stripEscalationArgs, isDelegatedChild } from '../npm-package/preset/sandbox-strip.js';

const defaultDocument = JSON.parse(upstream('defaults.json'));

// Issue #11 (default coupling): the six delegation roles ship without a model
// route AND without a fixed effort — both follow the session. The 0.5.3
// baseline still pins provider/model/effort per role, so the parity harness
// feeds both loaders the same stripped base; the byte comparison below pins
// that the rest of every upstream key is unchanged. `orchestrator` is not a
// delegation role and keeps its shipped effort.
const stripShippedDefaults = (roleId, role) => {
  if (!UPSTREAM_ROLE_IDS.includes(roleId) || role === null || typeof role !== 'object' || Array.isArray(role)) return role;
  const { provider, model, effort, ...rest } = role;
  return rest;
};
const stripRoutes = (preset) => Object.fromEntries(Object.entries(preset).map(([roleId, role]) => [roleId, stripShippedDefaults(roleId, role)]));
const baselineDocument = {
  ...defaultDocument,
  presets: Object.fromEntries(Object.entries(defaultDocument.presets ?? {}).map(([name, preset]) => [name, stripRoutes(preset)])),
};

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'omds-upstream-'));
  const env = { ...process.env };
  const file = join(dir, 'config.json');
  process.env.OH_MY_DSH_SLIM_CONFIG = file;
  process.env.OH_MY_DSH_SLIM_PROFILE_DIR = dir;
  process.env.DSH_HOME = dir;
  writeFileSync(join(dir, 'defaults.json'), JSON.stringify(baselineDocument));
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); rmSync(dir, { recursive: true, force: true }); });
  const source = upstream('config-loader.js').replace(/^import .*;\r?\n/gm, '').replace(/const ROOT = .*;/, 'const ROOT = baselineDir;').replace(/export /g, '');
  const original = new Function('existsSync', 'readFileSync', 'basename', 'dirname', 'join', 'fileURLToPath', 'baselineDir', source + '\nreturn { loadConfig, validateConfigDocument, EFFORT_LEVELS };')(existsSync, readFileSync, basename, dirname, join, fileURLToPath, dir);
  return { dir, original, save: doc => writeFileSync(file, JSON.stringify(doc)) };
}

// The 0.5.3 baseline only knows the six upstream roles. Council is an
// intentional 0.8.0 addition, so parity is asserted on the upstream face and
// the council family gets its own assertions below.
const upstreamFace = (config) => ({ ...config, roles: Object.fromEntries(UPSTREAM_ROLE_IDS.map(id => [id, config.roles[id]])) });

// 0.8.6 stops shipping a per-role output cap (the model owns it), while the
// frozen 0.5.3 loader still injects one for the six upstream roles. Parity here
// is about merge precedence, so the cap is normalized away on both sides; the
// "no shipped cap" rule is pinned by package.test and the model-switch tests.
const withoutCaps = (config) => ({
  ...config,
  roles: Object.fromEntries(Object.entries(config.roles).map(([roleId, role]) => {
    if (role === null || typeof role !== 'object' || Array.isArray(role)) return [roleId, role];
    const { maxTokens, ...rest } = role;
    return [roleId, rest];
  })),
});
const comparable = (config) => withoutCaps(upstreamFace(config));

for (const [label, doc] of [
  ['factory defaults', {}],
  ['compact overrides and deny union', { roles: { oracle: { provider: 'prov', model: 'custom', deny: ['bash'], tools: [] } }, advanced: { roles: { oracle: { deny: ['read'], temperature: 0.8, personaAppend: 'append' } } } }],
  ['compact replaces legacy role entry', { presets: { 'my-dsh-normal': { oracle: { provider: 'prov', model: 'legacy', effort: 'low' } } }, roles: { oracle: { temperature: 0.4 } } }],
  ['custom preset inherits factory roles', { preset: 'custom', presets: { custom: { fixer: { provider: 'prov', model: 'custom-fixer' } } } }],
  ['top-level orchestrator', { orchestrator: { effort: 'low', mcps: ['context7'] } }],
  ['observer force disabled', { roles: { observer: { enabled: true } } }],
]) test('upstream config parity: ' + label, t => {
  const f = fixture(t); f.save(doc);
  assert.deepEqual(comparable(loadConfig()), comparable(f.original.loadConfig()));
  assert.deepEqual(EFFORT_LEVELS, f.original.EFFORT_LEVELS);
});

test('bundled defaults keep every upstream key except the role route and effort, and add the council family', () => {
  const bundled = JSON.parse(readFileSync(new URL('../npm-package/preset/defaults.json', import.meta.url), 'utf8'));
  const bundledPreset = bundled.presets['my-dsh-normal'];
  const upstreamPreset = defaultDocument.presets['my-dsh-normal'];
  // Issue #11 (default coupling): the shipped role route (provider/model) and
  // the fixed effort are intentionally gone — every delegation role follows
  // the session. Every OTHER upstream key stays identical, which is what this
  // comparison pins.
  assert.deepEqual({
    ...bundled,
    presets: { ...bundled.presets, 'my-dsh-normal': Object.fromEntries(Object.keys(upstreamPreset).map(key => [key, stripShippedDefaults(key, bundledPreset[key])])) },
  }, {
    ...defaultDocument,
    presets: { ...defaultDocument.presets, 'my-dsh-normal': stripRoutes(upstreamPreset) },
  }, 'every upstream key except the role route and effort stays identical');
  for (const roleId of UPSTREAM_ROLE_IDS) {
    assert.equal(bundledPreset[roleId].provider, undefined, roleId + ': inherits the session model (no provider)');
    assert.equal(bundledPreset[roleId].model, undefined, roleId + ': inherits the session model (no model)');
    assert.equal(bundledPreset[roleId].effort, undefined, roleId + ': inherits the session effort (no effort)');
  }
  assert.equal(bundledPreset.orchestrator.effort, 'max', 'the orchestrator is not a delegation role and keeps its effort');
  for (const roleId of ['councillor-alpha', 'councillor-beta', 'councillor-gamma']) {
    assert.equal(bundledPreset[roleId].enabled, false, roleId + ': disabled by default');
    assert.deepEqual(bundledPreset[roleId].tools, ['read', 'glob', 'grep'], roleId + ': read-only allow list');
    assert.deepEqual(bundledPreset[roleId].mcps, [], roleId + ': no MCP servers');
    assert.equal(bundledPreset[roleId].provider, undefined, roleId + ': model inherited, not pinned');
    assert.equal(bundledPreset[roleId].model, undefined, roleId + ': model inherited, not pinned');
  }
  assert.equal(bundledPreset.council.enabled, false, 'synthesizer defaults off (derived from seats)');
  assert.deepEqual(bundledPreset.council.mcps, [], 'synthesizer has no MCP servers');
  assert.equal(bundledPreset.council.tools, undefined, 'synthesizer declares no user tool list');
});

test('unknown named presets fail load and validation just like upstream', t => {
  const f = fixture(t); f.save({ preset: 'missing' });
  for (const fn of [loadConfig, () => f.original.loadConfig(), () => validateConfigDocument({ preset: 'missing' }), () => f.original.validateConfigDocument({ preset: 'missing' })]) assert.throws(fn, /unknown preset/);
});

test('channel priority remains explicit file > snapshot > live settings > legacy', t => {
  const f = fixture(t);
  f.save({ roles: { fixer: { provider: 'chan', model: 'explicit' } } });
  writeFileSync(join(f.dir, 'profile.json'), JSON.stringify({ roles: { fixer: { provider: 'chan', model: 'snapshot' } } }));
  writeFileSync(join(f.dir, 'oh-my-dsh-slim.json'), JSON.stringify({ roles: { fixer: { provider: 'chan', model: 'legacy' } } }));
  const row = { ns: 'oh-my-dsh-slim', value: { roles: { fixer: { provider: 'chan', model: 'native' } } } };
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

test('an unsupported effort on the mounted route is dropped; a failed lookup fails open', async t => {
  const f = fixture(t); f.save({ roles: { fixer: { effort: 'xhigh' } } });
  const run = requestHarness({ resolveModelInfo: async (provider, model) => { assert.equal(provider, 'actual'); assert.equal(model, 'actual-model'); return { reasoning: { efforts: [{ id: 'low' }] } }; } });
  // 0.8.4: a level the mounted model does not offer is dropped (the model
  // default runs) instead of rejecting the child's first request — the card
  // gates new saves, this path serves configuration written outside it.
  const dropped = await run('fixer', { provider: 'actual', model: 'actual-model', reasoningEffort: 'xhigh' });
  assert.equal('reasoningEffort' in dropped, false, 'the undeclared level is dropped instead of failing dispatch');
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostImport } from '../npm-package/preset/bridge.js';
import { patchedContext, roleIdForAgent, stockConfig } from '../npm-package/preset/roles.js';
import { apply as applyRoleRequests } from '../npm-package/preset/subagent-roles.js';
import { apply as applyEarlyClose } from '../npm-package/preset/early-close-context.js';

const childId = '11111111-2222-3333-4444-555555555555';
const parentId = 'parent';
const tick = () => new Promise(resolve => setImmediate(resolve));
// Optional integrations use the actual host source and Cordis, without an
// install. The env root contains @deepseek-ai; a missing fixture skips only its
// host-specific tests so all seam-only behavior checks remain runnable.
const referenceDir = process.env.DSH_HOST_REFERENCE_DIR
  ? resolve(process.env.DSH_HOST_REFERENCE_DIR)
  : fileURLToPath(new URL('../../dsh-host-reference/dsh/node_modules/', import.meta.url));
const referenceFile = (packageName, file = 'lib/index.js') => join(referenceDir, '@deepseek-ai', packageName, file);
const referenceSkip = packageName => existsSync(referenceFile(packageName)) ? false
  : `Host integration unavailable at ${referenceFile(packageName)}; set DSH_HOST_REFERENCE_DIR to a host node_modules root containing @deepseek-ai (or provide the extracted dsh-host-reference sibling).`;
const skipStock = referenceSkip('dsh-tool-subagent');
const skipCordis = referenceSkip('cordis');

test('host import uses the official loader base on CLI without an asar argv', async () => {
  const calls = [];
  const ctx = { loader: { ctx: { baseUrl: 'file:///cli/node_modules/host.js' }, internal: {
    import: async (...args) => { calls.push(args); return { host: true }; },
  } } };
  assert.deepEqual(await hostImport(ctx, 'host-package'), { host: true });
  assert.deepEqual(calls, [['host-package', 'file:///cli/node_modules/host.js', {}]]);
  ctx.loader.config = { bareModuleBaseUrl: 'file:///authoritative/host.js' };
  await hostImport(ctx, 'host-package');
  assert.equal(calls[1][1], 'file:///authoritative/host.js');
  await assert.rejects(hostImport({}, 'missing'), /base URL|loader/);
});

test('packaged host anchor wins over a profile loader context, but explicit bare base wins over both', async () => {
  const originalEntry = process.argv[1];
  const packagedRoot = resolve('fixture-packaged-host/resources/app.asar');
  const expectedBase = pathToFileURL(join(packagedRoot, 'dsh/node_modules/x/y.js')).href;
  const calls = [];
  const ctx = { loader: { ctx: { baseUrl: 'file:///profile/node_modules/entry.js' }, internal: {
    import: async (...args) => { calls.push(args); return { host: true }; },
  } } };
  try {
    process.argv[1] = join(packagedRoot, 'dsh/node_modules/@deepseek-ai/dsh/bin.js');
    // Fresh module state avoids poisoning the CLI seam's cached argv fallback.
    const { hostImport: packagedImport } = await import('../npm-package/preset/bridge.js?packaged-anchor-regression');
    assert.deepEqual(await packagedImport(ctx, 'host-package'), { host: true });
    assert.deepEqual(calls[0], ['host-package', expectedBase, {}]);
    ctx.loader.config = { bareModuleBaseUrl: 'file:///explicit/host.js' };
    await packagedImport(ctx, 'host-package');
    assert.equal(calls[1][1], 'file:///explicit/host.js');
  } finally {
    process.argv[1] = originalEntry;
  }
});

test('rc.2 own events identify a cold-resumed fork, not its parent role', () => {
  const descriptor = role => ({ type: 'subagent/descriptor', data: { persona: 'oh-my-dsh-slim-role:' + role + '.' } });
  const events = [descriptor('oracle'), descriptor('fixer')];
  assert.equal(roleIdForAgent({ session: { ownEvents: () => events.slice(1) } }), 'fixer');
  assert.equal(roleIdForAgent({ session: { inheritedEventCount: 1, snapshotEvents: from => events.slice(from) } }), 'fixer');
});

test('unknown delegated role preserves effort and fills upstream temperature', async () => {
  let listener;
  applyRoleRequests({ effect: callback => callback(), on: (_, fn) => { listener = fn; }, get: () => undefined });
  const resolved = { provider: 'p', model: 'm', reasoningEffort: 'high' };
  const output = await listener({ agent: { session: { header: { origin: 'subagent' }, ownEvents: () => [] } } }, async () => resolved);
  assert.deepEqual(output, { ...resolved, temperature: 0.1 });
});

test('metadata lookup failure retains upstream fail-open effort validation', async () => {
  let listener;
  const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  applyRoleRequests({ effect: callback => callback(), on: (_, fn) => { listener = fn; },
    get: () => ({ resolveModelInfo: async () => { throw abort; } }) });
  const output = await listener({ agent: { session: { header: { origin: 'subagent' },
    ownEvents: () => [{ type: 'subagent/descriptor', data: { persona: 'oh-my-dsh-slim-role:oracle.' } }] } } },
    async () => ({ provider: 'unique-cancel-provider', model: 'm' }));
  const { loadConfig } = await import('../npm-package/preset/config.js');
  assert.equal(output.reasoningEffort, loadConfig().roles.oracle.effort);
});

test('stock config forwards child model parameters and readonly deny filter', () => {
  const filter = { deny: ['write', 'edit', 'pwsh'] };
  const options = { provider: 'p', model: 'm', reasoningEffort: 'high', maxTokens: 100 };
  const config = stockConfig({ provider: 'in-process', definition: { roleId: 'explorer' } }, {
    agentOptions: options, persona: 'role marker', toolName: 'subagent_explorer', toolFilter: filter,
  });
  assert.equal(config.agentOptions, options);
  assert.equal(config.toolFilter, filter);
  assert.equal(config.definition, undefined);
});

// Execute the actual installed rc.2 stock apply body with small dependency
// seams. The reference snapshot omits its peer packages; no install is needed.
function stockApply() {
  const url = pathToFileURL(referenceFile('dsh-tool-subagent'));
  const source = readFileSync(url, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\};?\s*$/m, '');
  const schema = new Proxy(() => schema, { get: () => schema, apply: () => schema });
  return new Function('z', 'z$1', 'scopeOf', 'scopeChainOf', 'defineTool', 'SessionSeq', 'assertSubagentMaxDepth', 'parentAgentOptionsForDelegation', 'settleRun', 'ReasoningEffortId', source + '\nreturn apply;')(
    schema, schema, ctx => ctx.scope, scope => scope ? [scope] : [], value => value, value => value,
    () => {}, agent => agent.options, async value => value, value => value,
  );
}

for (const scoped of [false, true]) test(`actual stock registration keeps role description through ${scoped ? 'agent inject' : 'direct'} scope`, { skip: skipStock }, async () => {
  const tools = [];
  const callbacks = new Map();
  const provider = { name: 'in-process', capabilities: { depthLimit: true, agentOptions: true }, prepareContinuable() {} };
  const compositionScope = {};
  const runtime = { register: definition => { tools.push(definition); return () => {}; }, get: () => tools[0] };
  const candidate = { id: childId, session: { firstLiveSeq: 1, header: {} } };
  const ctx = {
    scope: compositionScope,
    tools: runtime,
    subagents: { getProvider: () => provider, resolveMaxDepth: () => undefined },
    sessionProjections: { register() {}, stateOf: () => [{ provider: 'p', model: 'm' }] },
    systemPrompt: { section() {}, getSectionOrder: () => 1 },
    logger: { info() {}, warn() {} },
    on: (event, fn) => { callbacks.set(event, fn); },
    get(service) { return ({ tools: runtime, agents: { list: () => [candidate] }, subagents: this.subagents, subagentModelSelection: {} })[service]; },
    inject(dependencies, fn) { assert.deepEqual(dependencies, ['tools', 'subagents', 'systemPrompt']); fn(this); return { dispose: async () => {} }; },
  };
  candidate.ctx = ctx;
  const seen = {};
  const childOptions = { provider: 'p', model: 'm', reasoningEffort: 'high', maxTokens: 100 };
  const readonlyFilter = { allow: ['read', 'skill'], deny: ['write', 'edit', 'pwsh', 'skill'] };
  const requests = [];
  const parent = { id: parentId, options: { provider: 'parent-provider', model: 'parent-model' },
    ctx: { scope: compositionScope, get: key => key === 'tools' ? { view: scope => { assert.equal(scope, compositionScope); return { restrictableNames: new Set(['read', 'write', 'edit', 'pwsh']) }; } } : undefined } };
  const originalGet = ctx.get;
  ctx.get = function (key) { return key === 'llm' ? { resolveCallConfig: async () => {} } : originalGet.call(this, key); };
  ctx.subagents.startContinuable = async request => { requests.push(request); return { childId }; };
  const foreground = [];
  ctx.subagents.start = async (providerName, request) => { foreground.push({ providerName, request }); return { id: 'foreground-test', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose() {} }; };
  stockApply()(patchedContext(ctx, seen, { toolName: 'subagent_explorer', description: 'Readonly explorer', stock: { provider: 'in-process', backgroundMode: 'continuable' } }, undefined, undefined, ctx => ctx?.scope), {
    provider: 'in-process', toolName: 'subagent_explorer', backgroundMode: 'continuable', maxDepth: 'provider-managed', modelSelectionSettings: scoped,
    agentOptions: childOptions, toolFilter: readonlyFilter, persona: 'role marker',
  });
  const tool = tools.find(value => value.name === 'subagent_explorer');
  assert.ok(seen.patched);
  assert.match(tool.description, /^Delegate a self-contained task/);
  assert.match(tool.description, / Role profile: Readonly explorer/);
  assert.match(tool.parameters.run_in_background.description, /only when the user explicitly asked to wait in place/);
  assert.match(tool.description, /background by default/);
  await tool.execute({ description: 'Search', prompt: 'Find callers' }, { agent: parent, signal: new AbortController().signal });
  assert.equal(requests[0].request.agentOptions, childOptions);
  assert.deepEqual(requests[0].request.toolFilter, { allow: ['read'], deny: ['write', 'edit', 'pwsh'] });
  assert.deepEqual(readonlyFilter, { allow: ['read', 'skill'], deny: ['write', 'edit', 'pwsh', 'skill'] });
  assert.equal(requests[0].request.persona, 'role marker');
  assert.equal(requests[0].request.parent, parent);
  await tool.execute({ description: 'Search foreground', prompt: 'Find callers', run_in_background: false }, { agent: parent, signal: new AbortController().signal });
  assert.equal(foreground[0].providerName, 'in-process');
  assert.deepEqual(foreground[0].request.toolFilter, { allow: ['read'], deny: ['write', 'edit', 'pwsh'] });
  assert.equal(foreground[0].request.parent, parent);
  if (scoped) {
    assert.match(tool.description, /Child LLM selection/);
    callbacks.get('agent/disposed')({ agent: candidate });
    callbacks.get('agent/created')({ agent: candidate });
    assert.equal(tools.filter(value => value.name === 'subagent_explorer').length, 2);
  }
});

test('actual ToolRuntime view and restrict accept filtered nested requests and preserve empty allow', { skip: referenceSkip('dsh-tools') }, async () => {
  const source = readFileSync(referenceFile('dsh-tools'), 'utf8');
  const method = (name, end) => source.slice(source.indexOf(`\n\t${name}(`), source.indexOf(end, source.indexOf(`\n\t${name}(`)));
  // Execute the actual bundled ToolRuntime methods with only layer storage seams.
  const view = new Function(`return { ${method('view', '\n\t/**')} }.view;`)();
  const restrict = new Function('scopeOf', `return { ${method('restrict', '\n\t/**')} }.restrict;`)(ctx => ctx.scope);
  const scope = {};
  const entries = new Map(['read', 'write', 'edit'].map(name => [name, {}]));
  const restrictions = [];
  const own = { tools: new Map(), admits: () => true };
  const runtime = { ctx: { scope }, view, restrict, modeFor: () => 'native', layers: {
    global: { tools: entries }, chainLayers: () => [own], peek: () => own,
    effect: (ctx, callback) => callback({ restrictions: { append: filter => restrictions.push(filter) } }),
  } };
  assert.equal(runtime.restrictableNames, undefined);
  assert.throws(() => runtime.restrict({ deny: ['skill'] }), /unknown global tool/);
  const calls = [];
  const ctx = { tools: { register(tool) { calls.push(tool); } }, subagents: {
    startContinuable(spec) { runtime.restrict(spec.request.toolFilter); return spec; },
  }, get(key) { return this[key]; } };
  const parent = { ctx: { scope, get: key => key === 'tools' ? runtime : undefined } };
  const wrapped = patchedContext(ctx, {}, { toolName: 'test-role' }, undefined, undefined, ctx => ctx?.scope);
  wrapped.tools.register({ name: 'test-role', execute: (_, exec) => wrapped.subagents.startContinuable({ request: { parent: exec.agent, toolFilter: { allow: ['skill'], deny: ['write', 'skill'] } } }) });
  const result = await calls[0].execute({}, { agent: parent });
  assert.equal(result.request.parent, parent);
  assert.deepEqual(result.request.toolFilter, { allow: [], deny: ['write'] });
  assert.equal(restrictions[0].allow.size, 0); // Empty allow remains deny-all, never widened.
  assert.equal(restrictions[0].deny.has('write'), true);
});

test('actual Cordis inject retains scoped service receiver and disposes registrations', { skip: skipCordis }, async () => {
  const { Context, Service } = await import(pathToFileURL(referenceFile('cordis')).href);
  const root = new Context();
  const registered = [];
  const service = { register(definition) {
    registered.push(definition);
    return this.ctx.effect(() => () => registered.splice(registered.indexOf(definition), 1));
  } };
  // Cordis traceable services associate each method call with the calling ctx.
  Object.defineProperty(service, Service.tracker, { value: { property: 'ctx', associate: 'tools' } });
  service.ctx = root;
  const provider = root.plugin({ name: 'runtime-test-provider', apply(ctx) { ctx.reflect.provide('tools', service); } });
  await provider;
  const owner = root.plugin({ name: 'runtime-test-owner', inject: ['tools'], async apply(ctx) {
    const scoped = patchedContext(ctx, {}, { toolName: 'role', description: 'specialist' });
    await scoped.inject(['tools'], inner => inner.tools.register({ name: 'role', description: 'host lifecycle' }));
  } });
  await owner;
  assert.match(registered[0].description, /^Delegate a self-contained task/);
  assert.match(registered[0].description, / Role profile: specialist/);
  await owner.dispose();
  assert.equal(registered.length, 0);
  await provider.dispose();
});

function earlyCloseHarness(rows, events = []) {
  const handlers = new Map();
  let section;
  const ctx = {
    composition: 'test-composition',
    on: (name, callback) => handlers.set(name, callback),
    loader: { ctx: { baseUrl: 'file:///host/entry.js' }, internal: { import: async specifier => specifier === '@deepseek-ai/dsh-scope' ? ({ scopeOf: value => value?.composition, scopeChainOf: value => value === undefined ? [] : [value] }) : ({ createUserMessage: value => ({ role: 'user', ...value }) }) } },
    subagents: { listDescendants: async id => { assert.equal(id, parentId); return rows; } },
    inject: (_, callback) => callback({ systemPrompt: { context: value => { section = value; } } }),
  };
  applyEarlyClose(ctx, {});
  const agent = { ctx: { composition: 'test-composition' }, id: parentId, session: { id: parentId, snapshotEvents: from => events.filter(event => event.seq >= from) } };
  return { handlers, agent, render: () => section.text({ agent }) };
}

test('early-close listener leaves foreign composition delegations untracked', async () => {
  const harness = earlyCloseHarness([]);
  const exec = { name: 'subagent_explorer', agent: { ...harness.agent, ctx: { composition: 'foreign' } }, arguments: { description: 'Foreign search' } };
  let preCalls = 0, postCalls = 0;
  await harness.handlers.get('tools/pre-execute')(exec, async () => { preCalls++; });
  const decision = await harness.handlers.get('tools/post-execute')(exec, { content: [{ type: 'text', text: 'started subagent ' + childId }] }, async () => { postCalls++; return 'unchanged'; });
  assert.equal(preCalls, 1); assert.equal(postCalls, 1); assert.equal(decision, 'unchanged');
  assert.equal(harness.render(), '');
});

test('rc.2 direct running inventory stays active then late settle notice removes it', async () => {
  const harness = earlyCloseHarness([{ id: childId, kind: 'child', parentId, depth: 1, activity: 'running' }]);
  const exec = { name: 'subagent_explorer', agent: harness.agent, arguments: { description: 'Search files' } };
  await harness.handlers.get('tools/pre-execute')(exec, async () => {});
  const decision = await harness.handlers.get('tools/post-execute')(exec, { content: [{ type: 'text', text: 'started subagent ' + childId }] }, async () => {});
  assert.equal(decision.additionalContexts[0].source.kind, 'oh-my-dsh-slim/early-close-context');
  assert.notEqual(decision.additionalContexts[0].source.kind, 'plugin', 'format v4 rejects generic plugin message sources');
  assert.match(harness.render(), /Search files/);
  await tick();
  assert.match(harness.render(), /Search files/);
  harness.handlers.get('agent/inbox/inserted')({ agent: harness.agent, message: { source: { kind: 'agent-message', senderSessionId: childId } } });
  assert.match(harness.render(), /reported/);
  harness.handlers.get('agent/inbox/inserted')({ agent: harness.agent, message: { source: { kind: 'subagent-settled', senderSessionId: childId } } });
  assert.equal(harness.render(), '');
});

test('live inventory settles inactive or non-direct entries, not catalog presence', async () => {
  for (const row of [
    { id: childId, kind: 'child', parentId, depth: 1, activity: 'inactive' },
    { id: childId, kind: 'child', parentId: 'other-parent', depth: 2, activity: 'running' },
  ]) {
    const harness = earlyCloseHarness([row]);
    const exec = { name: 'subagent_explorer', agent: harness.agent, arguments: {} };
    await harness.handlers.get('tools/pre-execute')(exec, async () => {});
    await harness.handlers.get('tools/post-execute')(exec, { content: [{ type: 'text', text: childId }] }, async () => {});
    assert.match(harness.render(), /still running|仍在运行/);
    await tick();
    assert.equal(harness.render(), '');
  }
});

test('rc.2 snapshot replay sees the sequence-zero finish notice', async () => {
  const events = [{ seq: 0, type: 'agent/inbox/spliced', data: { inserted: [
    { source: { kind: 'subagent-settled', senderSessionId: childId } },
  ] } }];
  const harness = earlyCloseHarness([{ id: childId, kind: 'child', parentId, depth: 1, activity: 'running' }], events);
  const exec = { name: 'subagent_explorer', agent: harness.agent, arguments: {} };
  await harness.handlers.get('tools/pre-execute')(exec, async () => {});
  await harness.handlers.get('tools/post-execute')(exec, { content: [{ type: 'text', text: childId }] }, async () => {});
  assert.equal(harness.render(), '');
  await tick();
  assert.equal(harness.render(), '');
});

test('settlement preceding tool result cannot reopen ledger', async () => {
  const harness = earlyCloseHarness([{ id: childId, kind: 'child', parentId, depth: 1, activity: 'running' }]);
  const exec = { name: 'subagent_explorer', agent: harness.agent, arguments: {} };
  await harness.handlers.get('tools/pre-execute')(exec, async () => {});
  harness.handlers.get('agent/inbox/inserted')({ agent: harness.agent, message: { source: { kind: 'subagent-settled', senderSessionId: childId } } });
  await harness.handlers.get('tools/post-execute')(exec, { content: [{ type: 'text', text: childId }] }, async () => {});
  assert.equal(harness.render(), '');
  await tick();
  assert.equal(harness.render(), '');
});

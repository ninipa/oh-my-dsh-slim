// Zero-cost role-subagent contract test. Captures the request emitted by the
// custom role tool and verifies JSON-driven model/tool settings, the stable
// role marker used by continuable resume, scoped MCP installation, and the
// 方案3 foreground-MCP transparency (description + foreground result note).
import { apply } from '../role-subagent.js';
import { resetConfigForTests } from '../config-loader.js';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Expected model comes from the bundled defaults.json (single source of truth).
const defaultsJson = JSON.parse(readFileSync(new URL('../defaults.json', import.meta.url), 'utf8'));
const expectedLibrarianModel = defaultsJson.presets[defaultsJson.preset].librarian.model;

let failures = 0;
const check = (ok, msg) => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}`); failures++; }
};

const provider = {
  name: 'spawn',
  capabilities: { depthLimit: true },
  inheritsParentContext: true,
  prepareContinuable: async () => ({ seed: [] }),
};

/** Fresh harness per scenario: captures the registered tool and requests. */
function makeHarness({ knownGlobals, services = {} } = {}) {
  const state = { tool: undefined, request: undefined, setupCount: 0, setupCallback: undefined, mcpCalls: [], startCalls: [], sections: [] };
  const ctx = {
    tools: {
      register(definition) { state.tool = definition; return () => {}; },
      get(name) { return state.tool?.name === name ? state.tool : undefined; },
      // Mirror of the host registry's global-tool names. `knownGlobals` lets a
      // scenario simulate deployments where some configured names are absent
      // (e.g. no `skill` tool). When omitted entirely the host is treated as
      // too old to expose tools.view() — apply must then keep filters as-is.
      ...(knownGlobals === undefined ? {} : {
        view() { return { restrictableNames: new Set(knownGlobals) }; },
      }),
    },
    get(name) { return name in services ? services[name] : undefined; },
    subagents: {
      getProvider(name) { return name === 'spawn' ? provider : undefined; },
      registerContinuableSetup(callback) { state.setupCount++; state.setupCallback = callback; return () => {}; },
      async startContinuable(spec) { state.request = spec.request; return { childId: 'test-child' }; },
      async start(_providerName, request) {
        state.startCalls.push(request);
        return {
          id: 'test-run',
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'foreground answer' }] }),
          dispose() {},
        };
      },
    },
    systemPrompt: { section(definition) { state.sections.push(definition); } },
    on() {},
    logger: { info() {}, warn() {} },
  };
  return { ctx, state };
}

const HOST_GLOBALS = [
  'ask_user_question', 'bash', 'edit', 'glob', 'grep', 'job_kill', 'job_list',
  'job_output', 'read', 'read_image', 'todo_write', 'web_search', 'write',
];

const EXEC = {
  agent: {
    id: 'parent',
    // The live registry view the plugin fits filters against (fitFilterToKnown
    // reads agent.ctx.tools.schemas(agent)). `skill` absent, like rc.2 hosts.
    ctx: { tools: { schemas: () => HOST_GLOBALS.map((name) => ({ name })) } },
  },
  signal: new AbortController().signal,
};
const LEGACY_EXEC = { agent: { id: 'parent' }, signal: new AbortController().signal };

// Global tools registered by the simulated host deployment. `skill` is
// deliberately absent — current DSH compositions do not register it, and
// 0.1.1-rc.2 tools.restrict() rejects unknown filter names.

console.log('\n[librarian: continuable + MCP defaults]');
{
  const { ctx, state } = makeHarness({ knownGlobals: HOST_GLOBALS });
  apply(ctx, {
    provider: 'spawn', roleId: 'librarian', toolName: 'subagent_librarian',
    backgroundMode: 'continuable', maxDepth: 1, persona: 'You are Librarian.',
    toolFilter: { deny: ['edit'] },
  });
  if (!state.tool) throw new Error('role tool was not registered');
  await state.tool.execute({ description: 'test research', prompt: 'test prompt' }, EXEC);
  check(state.setupCount === 1, `one continuable setup registered (got ${state.setupCount})`);
  check(state.request?.agentOptions?.dshRoleId === 'librarian', 'stable role id present in request');
  check(state.request?.agentOptions?.model === expectedLibrarianModel && state.request?.agentOptions?.maxTokens === 48000, `JSON model settings applied (${expectedLibrarianModel}): ${JSON.stringify(state.request?.agentOptions)}`);
  check(state.request?.persona?.includes('oh-my-dsh-slim-role:librarian'), 'role marker present in persona');
  check(state.request?.toolFilter?.allow === undefined, 'deny-only tool filter');
  const expectedDeny = ['edit', 'write', 'job_kill', 'job_list', 'job_output', 'todo_write', 'ask_user_question'];
  if (JSON.stringify(state.request?.toolFilter?.deny) !== JSON.stringify(expectedDeny)) throw new Error(`unexpected tool deny filter: ${JSON.stringify(state.request?.toolFilter?.deny)}`);
  check(!state.request.toolFilter.deny.includes('skill'), 'deny entry for unregistered "skill" is dropped (rc.2 restrict validation)');
  check(state.request.toolFilter.deny.includes('edit') && state.request.toolFilter.deny.includes('write'), 'deny entries for registered tools survive');
  const childCtx = {
    agent: { session: { events: [{ type: 'subagent/descriptor', data: { persona: state.request.persona } }] } },
    plugin(_plugin, config) { state.mcpCalls.push(config); return Promise.resolve(); },
    on() {},
  };
  state.setupCallback(childCtx);
  check(state.mcpCalls.map((call) => call.serverName).join(',') === 'context7,gh_grep', `scoped MCP calls: ${JSON.stringify(state.mcpCalls.map((c) => c.serverName))}`);

  console.log('\n[方案3: MCP role transparency]');
  check(state.tool.description.includes('do not mount this role\'s MCP tools (mcp__context7__*/mcp__gh_grep__*)'), 'tool description warns about missing MCP in foreground runs');
  const foreground = await state.tool.execute({ description: 'd', prompt: 'p', run_in_background: false }, EXEC);
  check(state.startCalls.length === 1, 'foreground request routed to subagents.start');
  const rendered = state.tool.output.render({}, foreground).map((part) => part.text).join('');
  check(rendered.includes('foreground run: this role\'s MCP tools') && rendered.includes('mcp__context7__'), 'foreground result carries the MCP transparency note');
}

console.log('\n[方案3: non-MCP role has no note]');
{
  const { ctx, state } = makeHarness();
  apply(ctx, {
    provider: 'spawn', roleId: 'explorer', toolName: 'subagent_explorer',
    backgroundMode: 'continuable', maxDepth: 1, persona: 'You are Explorer.',
  });
  check(!state.tool.description.includes('MCP tools'), 'explorer description has no MCP warning');
  const foreground = await state.tool.execute({ description: 'd', prompt: 'p', run_in_background: false }, EXEC);
  const rendered = state.tool.output.render({}, foreground).map((part) => part.text).join('');
  check(!rendered.includes('were not mounted'), 'explorer foreground result has no MCP note');
}

console.log('\n[方案3: explicit one-shot configuration stays unannotated]');
{
  const { ctx, state } = makeHarness();
  apply(ctx, {
    provider: 'spawn', roleId: 'librarian', toolName: 'subagent_librarian',
    backgroundMode: 'one-shot', maxDepth: 1, persona: 'You are Librarian.',
  });
  check(!state.tool.description.includes('do not mount this role\'s MCP tools'), 'one-shot librarian description has no MCP warning (user choice respected)');
}

console.log('\n[soft-disable: observer ships disabled]');
{
  // defaults.json force-locks observer.enabled=false: nothing may register.
  const { ctx, state } = makeHarness({ knownGlobals: HOST_GLOBALS });
  apply(ctx, {
    provider: 'spawn', roleId: 'observer', toolName: 'subagent_observer',
    backgroundMode: 'continuable', maxDepth: 1, persona: 'You are Observer.',
    advertisement: '@observer (subagent_observer)\nVisual lane…',
  });
  check(state.tool === undefined, 'disabled observer registers NO tool');
  check(state.setupCount === 0, 'disabled observer registers no MCP setup');
  check(state.sections.length === 0, 'disabled observer injects no prompt sections (no dead advertisement)');
}

console.log('\n[advertisement renders only while mounted]');
{
  const { ctx, state } = makeHarness({ knownGlobals: HOST_GLOBALS });
  apply(ctx, {
    provider: 'spawn', roleId: 'librarian', toolName: 'subagent_librarian',
    backgroundMode: 'continuable', maxDepth: 1, persona: 'You are Librarian.',
    advertisement: '@librarian routing blurb',
  });
  const adSection = state.sections.find((s) => s.name === 'ad:subagent_librarian');
  if (!adSection) { fail('advertisement section registered'); }
  else {
    check(String(adSection.text({ scope: 'x' })).includes('routing blurb'), 'advertisement renders while tool is mounted');
    state.tool = undefined;
    check(adSection.text({ scope: 'x' }) === '', 'advertisement goes dark once the tool unmounts');
  }
}

console.log('\n[legacy host without tools.view(): filters stay verbatim]');
{
  const { ctx, state } = makeHarness();
  apply(ctx, {
    provider: 'spawn', roleId: 'librarian', toolName: 'subagent_librarian',
    backgroundMode: 'continuable', maxDepth: 1, persona: 'You are Librarian.',
  });
  await state.tool.execute({ description: 'd', prompt: 'p' }, LEGACY_EXEC);
  check(state.request?.toolFilter?.deny?.includes('skill'), 'older host keeps configured deny untouched');
}

console.log('\n[model validation against imported provider catalog]');
{
  const catalog = [
    { id: 'mimo-v2.5', inputModalities: ['text', 'image'] },
    { id: 'kimi-k3', inputModalities: ['text', 'image'] },
    { id: 'deepseek-v4-flash', inputModalities: ['text'] },
  ];
  const offered = makeHarness({ knownGlobals: HOST_GLOBALS, services: { llm: { listModels: async () => catalog } } });
  apply(offered.ctx, {
    provider: 'spawn', roleId: 'fixer', toolName: 'subagent_fixer',
    backgroundMode: 'continuable', maxDepth: 1, persona: 'F.',
  });
  await offered.state.tool.execute({ description: 'd', prompt: 'p' }, EXEC);
  check(true, 'offered model (bundled mimo-v2.5) passes validation');

  // A user-configured model the provider does not offer fails LOUD with both
  // sides of the mismatch, cached so every retry gets the same message.
  const home = mkdtempSync(join(tmpdir(), 'oh-my-dsh-slim-mv-'));
  const cfgPath = join(home, 'oh-my-dsh-slim.json');
  writeFileSync(cfgPath, JSON.stringify({ preset: 'custom', presets: { custom: { fixer: { model: 'ghost-model' } } } }));
  const previous = process.env.OH_MY_DSH_SLIM_CONFIG;
  process.env.OH_MY_DSH_SLIM_CONFIG = cfgPath;
  resetConfigForTests();
  try {
    const ghost = makeHarness({ knownGlobals: HOST_GLOBALS, services: { llm: { listModels: async () => catalog } } });
    apply(ghost.ctx, {
      provider: 'spawn', roleId: 'fixer', toolName: 'subagent_fixer',
      backgroundMode: 'continuable', maxDepth: 1, persona: 'F.',
    });
    let threw = '';
    try { await ghost.state.tool.execute({ description: 'd', prompt: 'p' }, EXEC); } catch (e) { threw = e.message; }
    check(threw.includes('"ghost-model"') && threw.includes('Imported models:'), `fails loud naming model + imported list (got: ${threw.slice(0, 90)})`);
    check(threw.includes('Vision-capable: kimi-k3, mimo-v2.5') || threw.includes('Vision-capable: mimo-v2.5, kimi-k3'), 'lists vision-capable subset');
    let threwAgain = '';
    try { await ghost.state.tool.execute({ description: 'd', prompt: 'p' }, EXEC); } catch (e) { threwAgain = e.message; }
    check(threwAgain === threw, 'cached error repeats identically');
  } finally {
    if (previous === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
    else process.env.OH_MY_DSH_SLIM_CONFIG = previous;
    resetConfigForTests();
    rmSync(home, { recursive: true, force: true });
  }
}

console.log('\n[soft-disable generic gate: any role via user JSON]');
{
  const home = mkdtempSync(join(tmpdir(), 'oh-my-dsh-slim-dis-'));
  const cfgPath = join(home, 'oh-my-dsh-slim.json');
  writeFileSync(cfgPath, JSON.stringify({ preset: 'custom', presets: { custom: { explorer: { enabled: false } } } }));
  const previous = process.env.OH_MY_DSH_SLIM_CONFIG;
  process.env.OH_MY_DSH_SLIM_CONFIG = cfgPath;
  resetConfigForTests();
  try {
    const { ctx, state } = makeHarness({ knownGlobals: HOST_GLOBALS });
    apply(ctx, {
      provider: 'spawn', roleId: 'explorer', toolName: 'subagent_explorer',
      backgroundMode: 'continuable', maxDepth: 1, persona: 'E.',
    });
    check(state.tool === undefined && state.sections.length === 0, 'user-disabled non-observer role mounts nothing');
  } finally {
    if (previous === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
    else process.env.OH_MY_DSH_SLIM_CONFIG = previous;
    resetConfigForTests();
    rmSync(home, { recursive: true, force: true });
  }
}

console.log('\\n[one-shot jobs path: run_in_background=true on one-shot role]');
{
  const jobState = { started: 0, run: undefined };
  const provider = { name: 'spawn', capabilities: { depthLimit: true }, inheritsParentContext: false };
  const registered = [];
  const ctx = {
    tools: {
      register(definition) { registered.push(definition); return () => {}; },
      get() { return undefined; },
      view() { return { restrictableNames: new Set(HOST_GLOBALS) }; },
    },
    subagents: {
      getProvider(n) { return n === 'spawn' ? provider : undefined; },
      registerContinuableSetup() { return () => {}; },
      async start(_p, _req) { jobState.started++; return { id: 'r1', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose() {} }; },
    },
    get(name) { return name === 'jobs' ? { start(job) { jobState.run = job.run; return 'job-9'; } } : undefined; },
    systemPrompt: { section() {} }, on() {}, logger: { info() {}, warn() {} },
  };
  apply(ctx, {
    provider: 'spawn', roleId: 'fixer', toolName: 'subagent_fixer',
    backgroundMode: 'one-shot', maxDepth: 1, persona: 'F.',
  });
  const captured = await registered[registered.length - 1].execute(
    { description: 'd', prompt: 'p', run_in_background: true },
    EXEC,
  );
  check(captured.kind === 'background' && captured.jobId === 'job-9', `returns background job id (got ${JSON.stringify(captured)})`);
  check(jobState.started === 0, 'job is queued without starting the child');
  jobState.run();
  check(jobState.started === 1, 'invoking job run starts exactly one child');
}

console.log('\\n[foreground abnormal stop surfaces partial output]');
{
  const provider = { name: 'spawn', capabilities: { depthLimit: true }, inheritsParentContext: false };
  const registered = [];
  const ctx = {
    tools: {
      register(definition) { registered.push(definition); return () => {}; },
      get() { return undefined; },
      view() { return { restrictableNames: new Set(HOST_GLOBALS) }; },
    },
    subagents: {
      getProvider(n) { return n === 'spawn' ? provider : undefined; },
      registerContinuableSetup() { return () => {}; },
      async start(_p, _req) {
        return {
          id: 'r2',
          result: Promise.resolve({ stopReason: 'error', output: [{ type: 'text', text: 'partial bits before crash' }] }),
          dispose() {},
        };
      },
    },
    get() { return undefined; },
    systemPrompt: { section() {} }, on() {}, logger: { info() {}, warn() {} },
  };
  apply(ctx, {
    provider: 'spawn', roleId: 'fixer', toolName: 'subagent_fixer',
    backgroundMode: 'one-shot', maxDepth: 1, persona: 'F.',
  });
  let threw = '';
  try {
    await registered[registered.length - 1].execute({ description: 'd', prompt: 'p', run_in_background: false }, EXEC);
  } catch (error) { threw = error.message; }
  check(threw.includes('subagent run failed') && threw.includes('partial bits before crash'), `abnormal stop carries partial output (got: ${threw.slice(0, 100)})`);
}

console.log('\n[allow-list foot-gun: all-unregistered allow fails loud]');
{
  const plugin = (await import('../role-subagent.js'));
  const known = new Set(['read', 'glob', 'grep']);
  let threw = '';
  try {
    plugin.fitFilterToKnown(known, ['skill', 'web_fetch'], []);
  } catch (error) { threw = error.message; }
  check(threw.includes('none of the configured tools') && threw.includes('glob, grep, read'), `empty-fitted allow throws with available list (got: ${threw.slice(0, 120)})`);
  const partial = plugin.fitFilterToKnown(known, ['read', 'skill'], ['grep']);
  check(partial.allow?.join(',') === 'read' && partial.deny?.includes('grep'), 'partially-known allow keeps registered entries');
}

console.log('\n[legacy host without tools.view(): filters stay verbatim]');
{
  const { ctx, state } = makeHarness();
  apply(ctx, {
    provider: 'spawn', roleId: 'librarian', toolName: 'subagent_librarian',
    backgroundMode: 'continuable', maxDepth: 1, persona: 'You are Librarian.',
  });
  await state.tool.execute({ description: 'd', prompt: 'p' }, LEGACY_EXEC);
  check(state.request?.toolFilter?.deny?.includes('skill'), 'older host keeps configured deny untouched');
}

if (failures > 0) {
  console.log(`\nROLE SUBAGENT: ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nROLE SUBAGENT: ALL CHECKS PASSED');

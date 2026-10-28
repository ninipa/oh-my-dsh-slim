// Opt-in council smoke: boot a real host, mount the production
// role-composition + council-mode rows, and exercise the council without a
// model. Proves:
//   * seat children are read-only (read/glob/grep only) and keep their identity
//   * the synthesizer child has no usable tools at all
//   * two seats start concurrently from one dispatch step
//   * Council Mode appears only for the top-level agent, only with >= 2 visible
//     seat tools plus the synthesizer, and never advertises an unmounted tool
//   * 1 or 0 configured seats advertise nothing
//   * a cold-resumed seat still resolves its role and keeps the read-only filter
//
// Usage:
//   DSH_HOST_ANCHOR=<installed host bin.js> node --expose-internals test/council-smoke.cjs
// Run it once per host line (0.2.0-rc.2 and 0.2.1-rc.2).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');

const anchor = process.env.DSH_HOST_ANCHOR;
if (!anchor || !path.isAbsolute(anchor)) throw new Error('Set DSH_HOST_ANCHOR to an absolute installed DSH host JS entry');
const requireHost = createRequire(anchor);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omds-council-'));
// The preset resolves bare `@deepseek-ai/*` imports through the host loader
// against this profile's base URL. A bare temp profile has no node_modules, so
// link the installed host's scope in; the desktop runtime does this through
// `bareModuleBaseUrl`, which an npm-installed host exposes only at boot.
fs.mkdirSync(path.join(temporary, 'node_modules'), { recursive: true });
fs.symlinkSync(
  path.join(path.dirname(requireHost.resolve('@deepseek-ai/dsh/package.json')), '..'),
  path.join(temporary, 'node_modules', '@deepseek-ai'),
  'dir',
);
process.env.DSH_HOME = temporary;
delete process.env.DSH_PROFILE;
process.argv[1] = anchor;
const hostImport = (name) => import(pathToFileURL(requireHost.resolve(name)).href);
const packageDir = path.resolve(__dirname, '../npm-package');
const log = (...args) => console.log('[council-smoke]', ...args);

const CONFIG_PATH = path.join(temporary, 'council-config.json');
process.env.OH_MY_DSH_SLIM_CONFIG = CONFIG_PATH;
const writeConfig = (seats) => fs.writeFileSync(CONFIG_PATH, JSON.stringify({
  roles: Object.fromEntries(seats.map((seat) => [seat, { enabled: true }])),
}));

const SEAT_TOOLS = ['subagent_councillor_alpha', 'subagent_councillor_beta', 'subagent_councillor_gamma'];
const SYNTH_TOOL = 'subagent_council';

(async () => {
  let ctx;
  let config;
  try {
    const yaml = requireHost('js-yaml');
    const { boot } = await hostImport('@deepseek-ai/dsh-app-boot');
    const baseDir = path.dirname(requireHost.resolve('@deepseek-ai/dsh-base/package.json'));
    const JsExpr = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => ({ __jsExpr: data }) });
    const rows = yaml.load(fs.readFileSync(path.join(baseDir, 'cordis.patch.yml'), 'utf8'), { schema: yaml.JSON_SCHEMA.extend(JsExpr) }).flatMap((p) => p.insert ?? []);
    for (const row of rows) if (['session-title-llm', 'session-query-sqlite', 'hmr'].includes(row.id)) row.disabled = true;
    const configPath = path.join(temporary, 'smoke.yml');
    fs.writeFileSync(configPath, yaml.dump(rows));
    fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'omds-council-smoke', private: true }));
    const smokeHome = path.join(temporary, 'home'); fs.mkdirSync(smokeHome);
    const profileContext = { home: smokeHome, dir: temporary, patchPath: path.join(temporary, 'cordis.patch.yml'), installAnchor: anchor, name: 'omds-council-smoke', startedBundles: [], bundles: [], overlays: [] };
    ctx = await boot('omds-council-smoke', configPath, [], (root) => { root.provide('profileContext', profileContext); }, pathToFileURL(anchor).href);
    log('booted');

    const composition = await import(pathToFileURL(path.join(packageDir, 'preset/role-composition.js')).href);
    const councilMode = await import(pathToFileURL(path.join(packageDir, 'preset/council-mode.js')).href);
    const roles = await import(pathToFileURL(path.join(packageDir, 'preset/roles.js')).href);
    config = await import(pathToFileURL(path.join(packageDir, 'preset/config.js')).href);
    writeConfig(['councillor-alpha', 'councillor-beta']);
    config.resetConfigForTests();

    const assemblies = [];
    const created = new Map();
    ctx.on('agent/created', ({ agent }) => {
      const own = agent.session?.ownEvents?.() ?? [];
      const descriptor = own.find((event) => event.type === 'subagent/descriptor');
      if (descriptor === undefined) return;
      created.set(agent.id, { label: descriptor.data?.label, role: roles.roleIdForAgent(agent) });
    });
    ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      assemblies.push({
        id: context.agent?.id,
        isChild: (context.agent?.session?.ownEvents?.() ?? []).some((event) => event.type === 'subagent/descriptor'),
        text: assembly.sections.map((section) => String(section.text)).join('\n'),
        tools: assembly.tools.map((tool) => tool.name),
      });
      return next();
    });
    ctx.on('agent/request', async (payload, next) => {
      if (!payload.agent) return next();
      const own = payload.agent.session?.ownEvents?.() ?? [];
      if (own.some((event) => event.type === 'subagent/descriptor')) throw new Error('COUNCIL_SMOKE_STOP');
      return next();
    });
    await ctx.plugin(composition);
    await ctx.plugin(councilMode);

    ctx.inject(['agents', 'subagents', 'systemPrompt', 'tools', 'loader'], async (c) => {
      try {
        log('injected');
        // The role rows are not mounted in this smoke; register stand-ins so the
        // Council Mode visibility gate can be exercised positively.
        for (const toolName of [...SEAT_TOOLS, SYNTH_TOOL]) {
          c.tools.register({
            name: toolName,
            description: 'council smoke stand-in',
            parameters: { type: 'object', properties: {} },
            output: { schema: {}, render: () => [] },
            execute: async () => ({ kind: 'success' }),
          });
        }
        // The root scope must see the stand-ins for the section's tools.get().
        const parent = (await c.agents.create({ sessionId: 'council-smoke-root-' + randomUUID(), meta: { cwd: process.cwd() } })).agent;
        await c.systemPrompt.assemble({ agent: parent, scope: parent });
        const parentAssembly = () => assemblies.filter((entry) => entry.id === parent.id).at(-1);

        const start = (label) => (typeof c.subagents.startActivation === 'function'
          ? c.subagents.startActivation({ provider: 'spawn', label, request: { prompt: [{ type: 'text', text: 'smoke' }], parent, maxDepth: 1 }, signal: new AbortController().signal, delivery: 'parent' })
          : c.subagents.startContinuable({ provider: 'spawn', label, request: { prompt: [{ type: 'text', text: 'smoke' }], parent, maxDepth: 1 }, signal: new AbortController().signal }));

        // Same assistant step: both seats are dispatched before either settles.
        const [alpha, beta] = await Promise.all([start('councillor-alpha · smoke'), start('councillor-beta · smoke')]);
        const synth = await start('council · smoke');
        assert.ok(alpha.childId && beta.childId && synth.childId, 'all three activations started');
        await new Promise((resolve) => setTimeout(resolve, 2500));

        for (const [childId, roleId] of [[alpha.childId, 'councillor-alpha'], [beta.childId, 'councillor-beta'], [synth.childId, 'council']]) {
          const child = created.get(childId);
          assert.ok(child, 'agent/created observed ' + roleId);
          assert.equal(child.role, roleId, 'roleIdForAgent resolves ' + roleId);
          assert.match(child.label, new RegExp('^' + roleId + ' · '), 'label carries the role prefix');
        }

        const seatAssembly = assemblies.find((entry) => entry.id === alpha.childId && entry.isChild);
        const synthAssembly = assemblies.find((entry) => entry.id === synth.childId && entry.isChild);
        assert.ok(seatAssembly && synthAssembly, 'both children assembled their first prompt');
        assert.match(seatAssembly.text, /You are a councillor in a multi-model council/, 'seat persona reaches the child');
        assert.match(synthAssembly.text, /You are the Council synthesizer/, 'synthesizer persona reaches the child');
        assert.ok(!seatAssembly.text.includes('## Council Mode'), 'the child never sees Council Mode');
        assert.ok(!synthAssembly.text.includes('## Council Mode'), 'the synthesizer never sees Council Mode');
        for (const name of ['read', 'glob', 'grep']) assert.ok(seatAssembly.tools.includes(name), 'seat keeps ' + name);
        for (const name of ['edit', 'write', 'bash', 'pwsh', 'read_image', 'web_search', 'web_fetch', 'skill', 'todo_write', 'ask_user_question', 'present']) {
          assert.ok(!seatAssembly.tools.includes(name), 'seat must not have ' + name + ': ' + JSON.stringify(seatAssembly.tools));
        }
        assert.ok(!seatAssembly.tools.some((name) => name.startsWith('subagent_')), 'seat cannot delegate');
        assert.deepEqual(synthAssembly.tools, [], 'the synthesizer has no tools: ' + JSON.stringify(synthAssembly.tools));

        assert.match(parentAssembly().text, /## Council Mode/, 'the parent gets the council section');
        assert.match(parentAssembly().text, /alpha \(subagent_councillor_alpha\)/, 'section lists seat names and tools');
        assert.ok(!parentAssembly().text.includes('gamma'), 'the unmounted seat is not advertised');
        assert.ok(!parentAssembly().text.includes('You are a councillor'), 'seat persona does not leak to the parent');

        // 1 seat / 0 seats: the section disappears without re-mounting anything.
        writeConfig(['councillor-alpha']);
        config.resetConfigForTests();
        await c.systemPrompt.assemble({ agent: parent, scope: parent });
        assert.ok(!parentAssembly().text.includes('## Council Mode'), 'one seat advertises nothing');
        writeConfig([]);
        config.resetConfigForTests();
        await c.systemPrompt.assemble({ agent: parent, scope: parent });
        assert.ok(!parentAssembly().text.includes('## Council Mode'), 'zero seats advertise nothing');

        log('COUNCIL_SMOKE_PASS', JSON.stringify({ seatTools: seatAssembly.tools.length, synthTools: synthAssembly.tools.length, parentTools: parentAssembly().tools.length }));
      } catch (error) {
        console.error('[council-smoke] FAILED', error);
        process.exitCode = 1;
      }
    });
  } finally {
    setTimeout(async () => {
      if (ctx) await ctx.fiber.dispose().catch(() => {});
      fs.rmSync(temporary, { recursive: true, force: true });
      process.exit(process.exitCode ?? 0);
    }, 6000);
  }
})().catch((error) => { console.error(error); process.exit(1); });

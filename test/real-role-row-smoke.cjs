// Opt-in real-role-row smoke: mount the production role row (not a stand-in),
// call the tool it registers, and inspect the child it creates. This is the
// zero-model version of the live path the real-model council test exercised.
//
//   * the wrapper intercepts the stock registration and prefixes the label
//   * roleIdForAgent resolves the seat from that label
//   * role-composition applies the councillor persona and the read/glob/grep
//     ceiling to the child
//
// Usage:
//   DSH_HOST_ANCHOR=<installed host bin.js> node --expose-internals test/real-role-row-smoke.cjs
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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omds-real-role-'));
process.env.DSH_HOME = temporary;
delete process.env.DSH_PROFILE;
process.argv[1] = anchor;
const hostImport = (name) => import(pathToFileURL(requireHost.resolve(name)).href);
const packageDir = path.resolve(__dirname, '../npm-package');
const log = (...args) => console.log('[real-role]', ...args);

const CONFIG_PATH = path.join(temporary, 'config.json');
process.env.OH_MY_DSH_SLIM_CONFIG = CONFIG_PATH;
fs.writeFileSync(CONFIG_PATH, JSON.stringify({ roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } }));

(async () => {
  let ctx;
  try {
    const yaml = requireHost('js-yaml');
    const { boot } = await hostImport('@deepseek-ai/dsh-app-boot');
    const baseDir = path.dirname(requireHost.resolve('@deepseek-ai/dsh-base/package.json'));
    const JsExpr = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => ({ __jsExpr: data }) });
    const rows = yaml.load(fs.readFileSync(path.join(baseDir, 'cordis.patch.yml'), 'utf8'), { schema: yaml.JSON_SCHEMA.extend(JsExpr) }).flatMap((p) => p.insert ?? []);
    for (const row of rows) if (['session-title-llm', 'session-query-sqlite', 'hmr'].includes(row.id)) row.disabled = true;
    const configPath = path.join(temporary, 'smoke.yml');
    fs.writeFileSync(configPath, yaml.dump(rows));
    fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'omds-real-role-smoke', private: true }));
    const smokeHome = path.join(temporary, 'home'); fs.mkdirSync(smokeHome);
    const profileContext = { home: smokeHome, dir: temporary, patchPath: path.join(temporary, 'cordis.patch.yml'), installAnchor: anchor, name: 'omds-real-role-smoke', startedBundles: [], bundles: [], overlays: [] };
    ctx = await boot('omds-real-role-smoke', configPath, [], (root) => { root.provide('profileContext', profileContext); }, pathToFileURL(anchor).href);
    log('booted');

    const composition = await import(pathToFileURL(path.join(packageDir, 'preset/role-composition.js')).href);
    const roles = await import(pathToFileURL(path.join(packageDir, 'preset/roles.js')).href);
    const config = await import(pathToFileURL(path.join(packageDir, 'preset/config.js')).href);
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
      if (own.some((event) => event.type === 'subagent/descriptor')) throw new Error('REAL_ROLE_SMOKE_STOP');
      return next();
    });
    await ctx.plugin(composition);
    await ctx.plugin(roles, {
      definition: { roleId: 'councillor-alpha', toolName: 'subagent_councillor_alpha' },
      provider: 'spawn',
      backgroundMode: 'continuable',
      maxDepth: 1,
    });

    ctx.inject(['agents', 'systemPrompt', 'tools', 'loader'], async (c) => {
      try {
        const scope = await hostImport('@deepseek-ai/dsh-scope');
        const parent = (await c.agents.create({ sessionId: 'real-role-root-' + randomUUID(), meta: { cwd: process.cwd() } })).agent;
        const tool = c.tools.get('subagent_councillor_alpha', scope.scopeOf(parent.ctx));
        assert.ok(tool, 'the production role row registered its tool');
        const result = await tool.execute({ description: 'real role row probe', prompt: 'smoke' }, { agent: parent, signal: new AbortController().signal });
        log('tool result', JSON.stringify(result).slice(0, 200));
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const [childId] = [...created.keys()];
        assert.ok(childId, 'the tool created a child');
        const child = created.get(childId);
        assert.equal(child.role, 'councillor-alpha', 'roleIdForAgent resolves the seat from the wrapper label');
        assert.equal(child.label, 'councillor-alpha · real role row probe', 'the wrapper prefixes the label');
        const assembly = assemblies.find((entry) => entry.id === childId && entry.isChild);
        assert.ok(assembly, 'the child assembled its first prompt');
        assert.match(assembly.text, /You are a councillor in a multi-model council/, 'the seat persona reaches the child');
        for (const name of ['read', 'glob', 'grep']) assert.ok(assembly.tools.includes(name), 'seat keeps ' + name);
        for (const name of ['edit', 'write', 'bash', 'pwsh', 'web_search', 'web_fetch', 'skill', 'todo_write', 'ask_user_question', 'present']) {
          assert.ok(!assembly.tools.includes(name), 'seat must not have ' + name + ': ' + JSON.stringify(assembly.tools));
        }
        assert.ok(!assembly.tools.some((name) => name.startsWith('subagent_')), 'seat cannot delegate');
        log('REAL_ROLE_ROW_SMOKE_PASS', JSON.stringify({ tools: assembly.tools.length, label: child.label }));
      } catch (error) {
        console.error('[real-role] FAILED', error);
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

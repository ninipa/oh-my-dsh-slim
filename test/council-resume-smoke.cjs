// Opt-in cold-resume smoke: a seat child created before a host restart must
// still resolve its role and keep the read-only filter after resume. This is
// the security half of "identity works for cold resumes": source says
// agents.resume announces agent/created with source "resume", and this proves
// the composition actually reapplies on a real host.
//
// Usage:
//   DSH_HOST_ANCHOR=<installed host bin.js> node --expose-internals test/council-resume-smoke.cjs
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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omds-council-resume-'));
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
const log = (...args) => console.log('[council-resume]', ...args);

const CONFIG_PATH = path.join(temporary, 'council-config.json');
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
    fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'omds-council-resume-smoke', private: true }));
    const smokeHome = path.join(temporary, 'home'); fs.mkdirSync(smokeHome);
    const profileContext = { home: smokeHome, dir: temporary, patchPath: path.join(temporary, 'cordis.patch.yml'), installAnchor: anchor, name: 'omds-council-resume-smoke', startedBundles: [], bundles: [], overlays: [] };

    const composition = await import(pathToFileURL(path.join(packageDir, 'preset/role-composition.js')).href);
    const roles = await import(pathToFileURL(path.join(packageDir, 'preset/roles.js')).href);
    const config = await import(pathToFileURL(path.join(packageDir, 'preset/config.js')).href);
    config.resetConfigForTests();

    const bootHost = async () => boot('omds-council-resume-smoke', configPath, [], (root) => { root.provide('profileContext', profileContext); }, pathToFileURL(anchor).href);

    // ---- first process: create a seat child and let it persist ---------------
    ctx = await bootHost();
    log('booted #1');
    const assemblies = [];
    ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      assemblies.push({
        id: context.agent?.id,
        tools: assembly.tools.map((tool) => tool.name),
        text: assembly.sections.map((section) => String(section.text)).join('\n'),
      });
      return next();
    });
    ctx.on('agent/request', async (payload, next) => {
      if (!payload.agent) return next();
      const own = payload.agent.session?.ownEvents?.() ?? [];
      if (own.some((event) => event.type === 'subagent/descriptor')) throw new Error('COUNCIL_RESUME_STOP');
      return next();
    });
    await ctx.plugin(composition);
    let childId;
    await new Promise((resolve, reject) => {
      ctx.inject(['agents', 'subagents', 'systemPrompt', 'loader'], async (c) => {
        try {
          const parent = (await c.agents.create({ sessionId: 'council-resume-root-' + randomUUID(), meta: { cwd: process.cwd() } })).agent;
          const receipt = await (typeof c.subagents.startActivation === 'function'
            ? c.subagents.startActivation({ provider: 'spawn', label: 'councillor-alpha · resume', request: { prompt: [{ type: 'text', text: 'smoke' }], parent, maxDepth: 1 }, signal: new AbortController().signal, delivery: 'parent' })
            : c.subagents.startContinuable({ provider: 'spawn', label: 'councillor-alpha · resume', request: { prompt: [{ type: 'text', text: 'smoke' }], parent, maxDepth: 1 }, signal: new AbortController().signal }));
          childId = receipt.childId;
          assert.ok(childId, 'the child started');
          await new Promise((done) => setTimeout(done, 2500));
          resolve();
        } catch (error) { reject(error); }
      });
    });
    await ctx.fiber.dispose();
    ctx = undefined;
    log('disposed #1', childId);

    // ---- second process: resume the persisted child --------------------------
    ctx = await bootHost();
    log('booted #2');
    const resumedAssemblies = [];
    const created = new Map();
    ctx.on('agent/created', ({ agent, source }) => {
      created.set(agent.id, { source, role: roles.roleIdForAgent(agent) });
    });
    ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      resumedAssemblies.push({
        id: context.agent?.id,
        tools: assembly.tools.map((tool) => tool.name),
        text: assembly.sections.map((section) => String(section.text)).join('\n'),
      });
      return next();
    });
    await ctx.plugin(composition);

    const scope = await hostImport('@deepseek-ai/dsh-scope');
    const resumed = await ctx.get('agents').resume({ resumeSessionId: childId, agentOptions: {} });
    const agent = resumed.agent ?? resumed;
    assert.ok(agent, 'the child resumed');
    await ctx.get('systemPrompt').assemble({ agent, scope: scope.scopeOf(agent.ctx) });
    await new Promise((done) => setTimeout(done, 500));

    const seen = created.get(agent.id);
    assert.ok(seen, 'agent/created fired for the resumed child');
    assert.equal(seen.source, 'resume', 'the announcement came from the resume path');
    assert.equal(seen.role, 'councillor-alpha', 'roleIdForAgent resolves the persisted label');
    const assembly = resumedAssemblies.find((entry) => entry.id === agent.id);
    assert.ok(assembly, 'the resumed child assembled a prompt');
    assert.match(assembly.text, /You are a councillor in a multi-model council/, 'the seat persona reapplies on resume');
    for (const name of ['read', 'glob', 'grep']) assert.ok(assembly.tools.includes(name), 'seat keeps ' + name);
    for (const name of ['edit', 'write', 'bash', 'pwsh', 'web_search', 'web_fetch', 'skill', 'todo_write', 'ask_user_question', 'present']) {
      assert.ok(!assembly.tools.includes(name), 'resumed seat must not have ' + name + ': ' + JSON.stringify(assembly.tools));
    }
    assert.ok(!assembly.tools.some((name) => name.startsWith('subagent_')), 'resumed seat cannot delegate');
    log('COUNCIL_RESUME_SMOKE_PASS', JSON.stringify({ tools: assembly.tools.length }));
  } catch (error) {
    console.error('[council-resume] FAILED', error);
    process.exitCode = 1;
  } finally {
    setTimeout(async () => {
      if (ctx) await ctx.fiber.dispose().catch(() => {});
      fs.rmSync(temporary, { recursive: true, force: true });
      process.exit(process.exitCode ?? 0);
    }, 6000);
  }
})().catch((error) => { console.error(error); process.exit(1); });

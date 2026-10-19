// Opt-in role-composition smoke: boot a real host, mount the production
// role-composition row, and create one real subagent. Proves the 0.7.0
// runtime channel end to end without a model:
//   * descriptor.label carries the role id at agent/created (live identity)
//   * the role persona lands in the child's first prompt, not the parent's
//   * tools.restrict removes write tools from the child only
//   * roleIdForAgent() still resolves the role (the precondition for the
//     per-role effort/temperature hook and per-role MCP mounting)
//
// Usage:
//   DSH_HOST_ANCHOR=<installed host bin.js> node --expose-internals test/role-composition-smoke.cjs
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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omds-role-composition-'));
process.env.DSH_HOME = temporary;
delete process.env.DSH_PROFILE;
delete process.env.OH_MY_DSH_SLIM_CONFIG;
process.argv[1] = anchor;
const hostImport = (name) => import(pathToFileURL(requireHost.resolve(name)).href);
const packageDir = path.resolve(__dirname, '../npm-package');
const log = (...args) => console.log('[role-smoke]', ...args);

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
    // The role composition reads the merged role configuration; the settings
    // service resolves it through the profile manifest, so the scratch home
    // needs one even though this smoke mounts no bundle.
    fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'omds-role-smoke', private: true }));
    const smokeHome = path.join(temporary, 'home'); fs.mkdirSync(smokeHome);
    const profileContext = { home: smokeHome, dir: temporary, patchPath: path.join(temporary, 'cordis.patch.yml'), installAnchor: anchor, name: 'omds-role-smoke', startedBundles: [], bundles: [], overlays: [] };
    ctx = await boot('omds-role-smoke', configPath, [], (root) => { root.provide('profileContext', profileContext); }, pathToFileURL(anchor).href);
    log('booted');

    const composition = await import(pathToFileURL(path.join(packageDir, 'preset/role-composition.js')).href);
    const roles = await import(pathToFileURL(path.join(packageDir, 'preset/roles.js')).href);
    // Mount the production row on the root fiber, like a preset composition
    // does. Listed after the observers so a fiber reload cannot drop them.
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
      if (own.some((event) => event.type === 'subagent/descriptor')) throw new Error('ROLE_SMOKE_STOP');
      return next();
    });
    await ctx.plugin(composition);

    ctx.inject(['agents', 'subagents', 'systemPrompt', 'tools', 'loader'], async (c) => {
      try {
      log('injected');
      const parent = (await c.agents.create({ sessionId: 'role-smoke-root-' + randomUUID(), meta: { cwd: process.cwd() } })).agent;
      await c.systemPrompt.assemble({ agent: parent, scope: parent });
      const receipt = await (typeof c.subagents.startActivation === 'function'
        ? c.subagents.startActivation({ provider: 'spawn', label: 'oracle · smoke', request: { prompt: [{ type: 'text', text: 'smoke' }], parent, maxDepth: 1 }, signal: new AbortController().signal, delivery: 'parent' })
        : c.subagents.startContinuable({ provider: 'spawn', label: 'oracle · smoke', request: { prompt: [{ type: 'text', text: 'smoke' }], parent, maxDepth: 1 }, signal: new AbortController().signal }));
      const childId = receipt.childId;
      assert.ok(childId, 'host started a child');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const child = created.get(childId);
      assert.ok(child, 'agent/created observed the child');
      assert.equal(child.label, 'oracle · smoke', 'descriptor.label persists the role prefix');
      assert.equal(child.role, 'oracle', 'roleIdForAgent resolves the role (effort/MCP precondition)');

      const childAssembly = assemblies.find((entry) => entry.id === childId && entry.isChild);
      const parentAssembly = assemblies.find((entry) => entry.id === parent.id);
      assert.ok(childAssembly, 'the child assembled its first prompt');
      assert.ok(parentAssembly, 'the parent assembled a prompt');
      assert.match(childAssembly.text, /You are Oracle/, 'role persona reaches the child prompt');
      assert.doesNotMatch(parentAssembly.text, /You are Oracle/, 'role persona does not leak to the parent');
      assert.ok(!childAssembly.tools.includes('edit') && !childAssembly.tools.includes('write'),
        'restricted roles lose write tools: ' + JSON.stringify(childAssembly.tools));
      assert.ok(parentAssembly.tools.includes('edit') && parentAssembly.tools.includes('write'),
        'parent tool surface is unchanged');
      log('ROLE_COMPOSITION_SMOKE_PASS', JSON.stringify({ childTools: childAssembly.tools.length, parentTools: parentAssembly.tools.length }));
      } catch (error) {
        console.error('[role-smoke] FAILED', error);
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

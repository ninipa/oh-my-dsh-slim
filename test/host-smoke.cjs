// Opt-in: run under the installed host's Electron/Node with --expose-internals.
// DSH_HOST_ANCHOR must be an absolute installed host JS entry (inside ASAR is OK).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const anchor = process.env.DSH_HOST_ANCHOR;
if (!anchor || !path.isAbsolute(anchor)) throw new Error('Set DSH_HOST_ANCHOR to an absolute installed DSH host JS entry');
const requireHost = createRequire(anchor);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omds-native-host-'));
process.env.DSH_HOME = temporary;
delete process.env.DSH_PROFILE;
delete process.env.OH_MY_DSH_SLIM_CONFIG;
process.argv[1] = anchor;
const hostImport = name => import(pathToFileURL(requireHost.resolve(name)).href);
(async () => {
 let ctx;
 try {
  const yaml = requireHost('js-yaml');
  const { boot } = await hostImport('@deepseek-ai/dsh-app-boot');
  const baseDir = path.dirname(requireHost.resolve('@deepseek-ai/dsh-base/package.json'));
  const JsExpr = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: data => ({ __jsExpr: data }) });
  const rows = yaml.load(fs.readFileSync(path.join(baseDir, 'cordis.patch.yml'), 'utf8'), { schema: yaml.JSON_SCHEMA.extend(JsExpr) }).flatMap(p => p.insert ?? []);
  const disabled = new Set(['session-title-llm', 'session-query-sqlite', 'hmr']);
  for (const row of rows) if (disabled.has(row.id)) row.disabled = true;
  const configPath = path.join(temporary, 'smoke.yml');
  fs.writeFileSync(configPath, yaml.dump(rows));
  const packageDir = path.resolve(__dirname, '../npm-package');
  const patches = [{ insert: [
   { id: 'oh-my-dsh-slim-profiles', name: pathToFileURL(path.join(packageDir, 'lib/profile-registry.js')).href },
   { id: 'agent-preset-registry', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'oh-my-dsh-slim' } },
   { id: 'oh-my-dsh-slim', name: pathToFileURL(path.join(packageDir, 'lib/index.js')).href },
   { id: 'preset-oh-my-dsh-slim', name: pathToFileURL(path.join(packageDir, 'preset/preset.js')).href },
  ] }];
  const fixtureBundle = path.join(temporary, 'node_modules', 'omds-smoke-bundle');
  fs.mkdirSync(fixtureBundle, { recursive: true });
  fs.writeFileSync(path.join(fixtureBundle, 'package.json'), JSON.stringify({ name: 'omds-smoke-bundle', version: '1.0.0', dsh: { bundle: { patch: ['cordis.patch.yml'] } } }));
  fs.writeFileSync(path.join(fixtureBundle, 'cordis.patch.yml'), yaml.dump(patches));
  fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'omds-native-smoke', private: true, dsh: { profile: { bundles: ['omds-smoke-bundle'] } } }));
  const smokeHome = path.join(temporary, 'home'); fs.mkdirSync(smokeHome);
  const profileContext = { home: smokeHome, dir: temporary, patchPath: path.join(temporary, 'cordis.patch.yml'), installAnchor: anchor, name: 'omds-native-smoke', startedBundles: [], bundles: ['omds-smoke-bundle'], overlays: [] };
  ctx = await boot('omds-native-smoke', configPath, patches, root => { root.provide('profileContext', profileContext); }, pathToFileURL(anchor).href);
  const registry = ctx.get('agentPresets');
  if (!registry) throw new Error('Native preset registry unavailable');
  const roster = await registry.list();
  console.log('PRESET_ROSTER ' + JSON.stringify(roster));
  const preset = await registry.resolve('oh-my-dsh-slim');
  if (preset.broken) throw new Error(preset.broken);
  const form = ctx.get('settings')?.describe().find(row => row.ns === 'oh-my-dsh-slim');
  if (!form) throw new Error('Native role settings namespace unavailable');
  console.log('NATIVE_SETTINGS_SMOKE_PASS ' + form.ns);
  console.log('NATIVE_HOST_SMOKE_PASS ' + JSON.stringify(preset));
  const assert = require('node:assert/strict');
  const profileModule = await import(pathToFileURL(path.join(packageDir, 'lib/profile-registry.js')).href);
  const configModule = await import(pathToFileURL(path.join(packageDir, 'preset/config.js')).href);
  const endpoints = profileModule.makeProfileEndpoints({ agentPresets: registry, getEditor: () => ctx.get('configEditor'), getSettings: () => ctx.get('settings') });
  const first = await endpoints.create({ displayName: 'Named A', config: { roles: { oracle: { model: 'profile-a', effort: 'none' } } } });
  const second = await endpoints.create({ displayName: 'Named B', config: {} });
  for (const id of [first.id, second.id]) { const named = await registry.resolve(id); if (named.broken) throw new Error(named.broken); }
  assert.equal(form.base.presets[form.base.preset].designer.model, 'deepseek-v4-flash');
  const aCtx = ctx.extend(), bCtx = ctx.extend();
  configModule.bindProfileContext(aCtx, first.id); configModule.bindProfileContext(bCtx, second.id);
  assert.equal(configModule.loadConfig(aCtx).roles.oracle.model, 'profile-a');
  assert.notEqual(configModule.loadConfig(bCtx).roles.oracle.model, 'profile-a');
  const saved = await endpoints.save({ id: first.id, config: { roles: { oracle: { model: 'profile-new' } } }, expectedRevision: first.revision });
  assert.equal(configModule.loadConfig(aCtx).roles.oracle.model, 'profile-new');
  assert.notEqual(configModule.loadConfig(bCtx).roles.oracle.model, 'profile-new');
  await assert.rejects(endpoints.save({ id: first.id, config: {}, expectedRevision: first.revision }), error => error.code === 'PROFILE_CONFLICT');
  await endpoints.setDefault({ profileId: first.id });
  assert.equal(registry.defaultId, first.id);
  const overrideFile = path.join(temporary, 'override.json');
  fs.writeFileSync(overrideFile, JSON.stringify({ roles: { oracle: { model: 'env-first' } } }));
  process.env.OH_MY_DSH_SLIM_CONFIG = overrideFile;
  assert.equal(configModule.loadConfig(aCtx).roles.oracle.model, 'env-first');
  delete process.env.OH_MY_DSH_SLIM_CONFIG;
  assert.equal(configModule.loadConfig(aCtx).roles.oracle.model, 'profile-new');
  const persistedText = fs.readFileSync(profileContext.patchPath, 'utf8');
  assert.ok(persistedText.includes(first.id));
  const { readProfilePatches } = await hostImport('@deepseek-ai/dsh-app-boot');
  const restartPatches = readProfilePatches('omds-native-smoke', profileContext);
  await ctx.fiber.dispose(); ctx = undefined;
  ctx = await boot('omds-native-smoke', configPath, restartPatches, root => { root.provide('profileContext', profileContext); }, pathToFileURL(anchor).href);
  const restarted = profileModule.makeProfileEndpoints({ agentPresets: ctx.get('agentPresets'), getEditor: () => ctx.get('configEditor'), getSettings: () => ctx.get('settings') });
  const afterRestart = await restarted.list();
  assert.equal(afterRestart.profiles.find(row => row.id === first.id).revision, saved.revision);
  assert.equal(afterRestart.defaultProfileId, first.id);
  console.log('NATIVE_PROFILE_RESTART_ISOLATION_PASS');
  const scope = await hostImport('@deepseek-ai/dsh-scope');
  const hook = await import(pathToFileURL(path.join(packageDir, 'preset/subagent-roles.js')).href);
  const namedRootA = scope.createScope(ctx, Symbol('profile-a'));
  const namedRootB = scope.createScope(ctx, Symbol('profile-b'));
  const childA = scope.createScope(namedRootA.ctx, Symbol('child-a'), { parent: scope.scopeOf(namedRootA.ctx) });
  const childB = scope.createScope(namedRootB.ctx, Symbol('child-b'), { parent: scope.scopeOf(namedRootB.ctx) });
  const scopeProfiles = { a: { roles: { oracle: { temperature: 0.2, effort: 'none' } } }, b: { roles: { oracle: { temperature: 0.8, effort: 'none' } } } };
  const handlers = [];
  const makeHook = scoped => ({ loader: ctx.get('loader'), get: key => key === 'omdsProfiles' ? { read: id => scopeProfiles[id] } : ctx.get(key),
    effect: callback => callback(), on: (event, handler) => { handlers.push(handler); return () => {}; },
    ...{} });
  // Keep the genuine host scope tag by extending the real Cordis context;
  // only event collection/config channel are supplied as an injectable fixture.
  const installHook = (scoped, id) => {
    const proxy = new Proxy(scoped, { get(target, key) { const fixture = makeHook(scoped); return key in fixture ? fixture[key] : Reflect.get(target, key); } });
    hook.apply(proxy, { profileId: id });
  };
  installHook(namedRootA.ctx, 'a'); installHook(namedRootB.ctx, 'b');
  const fakeAgent = scoped => ({ ctx: scoped, session: { header: { origin: 'subagent', delegationDepth: 1 }, ownEvents: () => [{ type: 'subagent/descriptor', data: { persona: 'Internal role id: oh-my-dsh-slim-role:oracle.' } }] } });
  const runHook = agent => handlers.reduceRight((next, handler) => () => handler({ agent }, next), async () => ({ temperature: 0.4, reasoningEffort: 'high' }))();
  const patched = await Promise.all([runHook(fakeAgent(childA.ctx)), runHook(fakeAgent(childB.ctx))]);
  assert.deepEqual(patched.map(row => row.temperature), [0.2, 0.8]);
  await childA.dispose(); await childB.dispose(); await namedRootA.dispose(); await namedRootB.dispose();
  console.log('NATIVE_PROFILE_SCOPE_GATE_PASS');
   // Exercise the adapter with the installed ASAR ToolRuntime and real scopes.
   const roles = await import(pathToFileURL(path.join(packageDir, 'preset/roles.js')).href);
   const parentScope = scope.createScope(ctx, Symbol('filter-parent'));
   const childScope = scope.createScope(parentScope.ctx, Symbol('filter-child'), { parent: scope.scopeOf(parentScope.ctx) });
   let capturedTool;
   const fakeRegistry = { async startContinuable(spec) {
     childScope.ctx.get('tools').restrict(spec.request.toolFilter);
     return spec;
   } };
   const serviceTools = parentScope.ctx.get('tools');
   assert.equal(typeof serviceTools.view, 'function');
   assert.equal(serviceTools.restrictableNames, undefined);
   const known = serviceTools.view(scope.scopeOf(parentScope.ctx)).restrictableNames;
   const valid = [...known].find(name => name !== 'run_code');
   assert.ok(valid, 'installed runtime has no restrictable tools');
   const missing = '__omds_missing_global_tool__';
   assert.ok(!known.has(missing));
   const original = { request: { toolFilter: { allow: [valid, missing], deny: [missing] } } };
   const adapterContext = new Proxy(parentScope.ctx, { get(target, key) {
     if (key === 'get') return name => name === 'subagents' ? fakeRegistry : name === 'tools' ? new Proxy(serviceTools, { get(tools, property) {
       return property === 'register' ? definition => { capturedTool = definition; } : Reflect.get(tools, property);
     } }) : target.get(name);
     return Reflect.get(target, key);
   } });
   const adapted = roles.patchedContext(adapterContext, {}, { toolName: 'filter-smoke', stock: {} }, undefined, undefined, scope.scopeOf);
   adapted.get('tools').register({ name: 'filter-smoke', description: '', parameters: {}, execute: () => adapted.subagents.startContinuable(original) });
   const filtered = await capturedTool.execute({}, { agent: { ctx: parentScope.ctx } });
   assert.deepEqual(filtered.request.toolFilter, { allow: [valid], deny: [] });
   assert.deepEqual(original.request.toolFilter, { allow: [valid, missing], deny: [missing] });
   await childScope.dispose(); await parentScope.dispose();
   console.log('NATIVE_TOOL_FILTER_START_PASS');
 } finally {
  if (ctx) await ctx.fiber.dispose();
  // Target is a fresh mkdtemp directory, never a user profile/home.
  fs.rmSync(temporary, { recursive: true, force: true });
 }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

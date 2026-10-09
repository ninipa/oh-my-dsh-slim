// Installed-host HTTP transport acceptance; no model calls or browser rendering.
// Run with Electron --expose-internals and DSH_HOST_ANCHOR (or a plain Node host).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const anchor = process.env.DSH_HOST_ANCHOR;
if (!anchor || !path.isAbsolute(anchor)) throw Error('Set DSH_HOST_ANCHOR to an absolute installed host JS entry');
const requireHost = createRequire(anchor);
const hostImport = name => import(pathToFileURL(requireHost.resolve(name)).href);
const hostBase = pathToFileURL(anchor).href;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omds-web-host-'));
process.env.DSH_HOME = path.join(temporary, 'home');
fs.mkdirSync(process.env.DSH_HOME);
delete process.env.DSH_PROFILE;
delete process.env.OH_MY_DSH_SLIM_CONFIG;
process.argv[1] = anchor;
let ctx;
let port;
let cookie;
function request(route, { method = 'POST', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(cookie && { cookie }), ...headers } }, res => {
      const chunks = []; res.on('data', x => chunks.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.setTimeout(10000, () => req.destroy(Error('HTTP smoke timeout')));
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}
let sequence = 0;
async function rpc(method, payload = {}) {
  const rpcId = 'smoke-' + ++sequence;
  const res = await request('/omds/' + method, { body: { type: 'client-request', rpcId, method, payload } }).catch(error => { error.message = method + ': ' + error.message + '; bound port ' + port + ', live port ' + ctx?.get('webServer')?.port; throw error; });
  assert.equal(res.status, 200, res.text);
  const message = JSON.parse(res.text);
  assert.equal(message.type, 'server-response'); assert.equal(message.rpcId, rpcId);
  return message.result;
}
(async () => {
  try {
    const yaml = requireHost('js-yaml');
    const bootModule = await hostImport('@deepseek-ai/dsh-app-boot');
    const { boot, entryListSchema, readProfilePatches } = bootModule;
    const { provideCmdline } = await hostImport('@deepseek-ai/dsh-cmdline');
    const schema = entryListSchema ?? yaml.JSON_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: data => ({ __jsExpr: data }) }));
    const loadPatch = name => yaml.load(fs.readFileSync(path.join(path.dirname(requireHost.resolve(name + '/package.json')), 'cordis.patch.yml'), 'utf8'), { schema });
    const baseRows = loadPatch('@deepseek-ai/dsh-base').flatMap(p => p.insert ?? []);
    for (const row of baseRows) if (['session-title-llm', 'hmr'].includes(row.id)) row.disabled = true;
    const webPatches = loadPatch('@deepseek-ai/dsh-web-app');
    // No native desktop directory dialog exists under ELECTRON_RUN_AS_NODE.
    // This optional UI-only row is unrelated to HTTP/auth/profile transport.
    for (const patch of webPatches) for (const row of patch.insert ?? []) {
      if (row.id === 'directory-picker') row.disabled = true;
      if (row.id === 'web-runtime') row.config.printUrl = false;
    }
    // Resolve all host rows at the installed anchor, never from the temporary
    // configuration directory. This also works with npm-prefix/non-ASAR hosts.
    const anchorNames = rows => { for (const row of rows) { if (row.name?.startsWith('@deepseek-ai/')) row.name = pathToFileURL(requireHost.resolve(row.name)).href; if (row.insert) anchorNames(row.insert); if (row.group && Array.isArray(row.config)) anchorNames(row.config); } };
    anchorNames(baseRows); anchorNames(webPatches);
    const configPath = path.join(temporary, 'smoke.yml'); fs.writeFileSync(configPath, yaml.dump(baseRows, { schema }));
    const packageDir = path.resolve(__dirname, '../npm-package');
    const fixtureBundle = path.join(temporary, 'node_modules', 'omds-web-smoke-bundle'); fs.mkdirSync(fixtureBundle, { recursive: true });
    fs.writeFileSync(path.join(fixtureBundle, 'package.json'), JSON.stringify({ name: 'omds-web-smoke-bundle', version: '1.0.0', dsh: { bundle: { patch: ['cordis.patch.yml'] } } }));
    fs.writeFileSync(path.join(fixtureBundle, 'cordis.patch.yml'), yaml.dump(webPatches, { schema }));
    fs.cpSync(packageDir, path.join(temporary, 'node_modules', 'oh-my-dsh-slim'), { recursive: true, dereference: true });
    fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'omds-web-smoke', private: true, dsh: { profile: { bundles: ['omds-web-smoke-bundle', 'oh-my-dsh-slim'] } } }));
    const profileContext = { home: process.env.DSH_HOME, dir: temporary, patchPath: path.join(temporary, 'cordis.patch.yml'), installAnchor: anchor, name: 'omds-web-smoke', startedBundles: [], bundles: ['omds-web-smoke-bundle', 'oh-my-dsh-slim'], overlays: [] };
    const start = async patches => {
      ctx = await boot('omds-web-smoke', configPath, patches, root => {
        root.provide('profileContext', profileContext);
        provideCmdline(root, { args: ['--host', '127.0.0.1', '--port', '0', '--no-open'], exit: code => { throw Error('Unexpected host appExit ' + code); } });
        root.get('loader').config.bareModuleBaseUrl = hostBase;
      }, pathToFileURL(path.join(temporary, 'package.json')).href);
      for (const entry of ctx.get('loader').entries()) {
        if (entry.disabled) continue;
        assert.equal(entry.fiber?.state, 2, 'Host row not active: ' + entry.options.id);
      }
      port = ctx.get('webServer').port; assert.ok(port > 0);
      assert.equal(ctx.get('webServer').host, '127.0.0.1');
    };
    await start(readProfilePatches('omds-web-smoke', profileContext));
    assert.equal((await request('/omds/profile-list', { body: {} })).status, 401);
    assert.equal((await request('/omds/profile-list', { body: {}, headers: { host: 'evil.invalid' } })).status, 403);
    assert.equal((await request('/omds/profile-list', { body: {}, headers: { origin: 'http://evil.invalid' } })).status, 403);
    const authenticated = new URL(ctx.get('connection').authenticatedUrl(`http://127.0.0.1:${port}/`));
    const exchange = await request(authenticated.pathname + authenticated.search, { method: 'GET' });
    assert.equal(exchange.status, 303); assert.ok(exchange.headers['set-cookie']?.length);
    cookie = exchange.headers['set-cookie'][0].split(';')[0];
    console.log('WEB_AUTH_FENCE_PASS');
    const listed = await rpc('profile-list'); assert.equal(listed.ok, true); assert.ok(listed.value.profiles.some(p => p.id === 'oh-my-dsh-slim'));
    const created = await rpc('profile-create', { displayName: 'HTTP Named A', config: { roles: { oracle: { model: 'http-a', effort: 'none' } } } }); assert.equal(created.ok, true);
    const first = created.value;
    const saved = await rpc('profile-save', { id: first.id, expectedRevision: first.revision, config: { roles: { oracle: { model: 'http-saved' } } } }); assert.equal(saved.ok, true);
    const stale = await rpc('profile-save', { id: first.id, expectedRevision: first.revision, config: {} }); assert.equal(stale.ok, false); assert.equal(stale.error.code, 'PROFILE_CONFLICT');
    const defaulted = await rpc('profile-set-default', { profileId: first.id }); assert.equal(defaulted.ok, true, JSON.stringify(defaulted));
    const migrated = await rpc('profile-migrate', { profileId: first.id }); assert.equal(migrated.ok, true); assert.equal(migrated.value.changed, false);
    const afterSave = await rpc('profile-list'); assert.equal(afterSave.value.defaultProfileId, first.id); assert.equal(afterSave.value.profiles.find(p => p.id === first.id).config.roles.oracle.model, 'http-saved');
    console.log('WEB_PROFILE_HTTP_ROUTES_PASS');
    assert.equal((await request('/omds/profile-list', { body: '{bad' })).status, 400);
    assert.equal((await request('/omds/profile-list', { body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
    const invalid = await request('/omds/profile-list', { body: { rpcId: 'invalid' } }); assert.equal(JSON.parse(invalid.text).result.error.code, 'gateway/bad-request');
    const mismatch = await request('/omds/profile-list', { body: { type: 'client-request', rpcId: 'mismatch', method: 'profile-save', payload: {} } }); assert.equal(JSON.parse(mismatch.text).result.error.code, 'gateway/bad-request');
    const unknown = await rpc('unknown-endpoint'); assert.equal(unknown.ok, false); assert.equal(unknown.error.code, 'UNKNOWN_ENDPOINT');
    assert.equal((await request('/omds/profile-list', { method: 'GET' })).status, 404);
    console.log('WEB_RPC_ENVELOPE_VALIDATION_PASS');
    const restart = readProfilePatches('omds-web-smoke', profileContext);
    await ctx.fiber.dispose(); ctx = undefined; cookie = undefined;
    await start(restart);
    const restartUrl = new URL(ctx.get('connection').authenticatedUrl(`http://127.0.0.1:${port}/`));
    const nextExchange = await request(restartUrl.pathname + restartUrl.search, { method: 'GET' }); assert.equal(nextExchange.status, 303); cookie = nextExchange.headers['set-cookie'][0].split(';')[0];
    const persisted = await rpc('profile-list'); assert.equal(persisted.ok, true); assert.equal(persisted.value.defaultProfileId, first.id); assert.equal(persisted.value.profiles.find(p => p.id === first.id).revision, saved.value.revision);
    console.log('WEB_PROFILE_HTTP_RESTART_PASS');
    const owner = [...ctx.get('loader').entries()].find(entry => entry.options.id === 'oh-my-dsh-slim');
    assert.ok(owner?.fiber, 'companion owner fiber unavailable'); await owner.fiber.dispose();
    const removed = await request('/omds/profile-list', { body: { type: 'client-request', rpcId: 'removed', method: 'profile-list', payload: {} } }); assert.notEqual(removed.status, 200);
    console.log('WEB_OMDS_ROUTE_DISPOSAL_PASS');
  } finally {
    if (ctx) await ctx.fiber.dispose();
    // The fixture contains physical copies only: never create junctions/symlinks.
    // Verify the deletion root is the freshly-created temp-directory family.
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('omds-web-host-'));
    const rejectLinks = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name); const stat = fs.lstatSync(child);
      assert.equal(stat.isSymbolicLink(), false, 'Refusing cleanup through link: ' + child);
      if (stat.isDirectory()) rejectLinks(child);
    } };
    rejectLinks(temporary);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

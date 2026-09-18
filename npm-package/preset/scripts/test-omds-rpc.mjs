// Zero-cost unit test for the /omds RPC transport in the npm package's host
// half (../npm-package/lib/index.js).
//
// Regression target (2026-09-10, DSH 0.1.5): `connection.rpc.handle()` was
// unusable — it registers its route through the reading context's `webServer`
// and cordis resolves that owner to the plugin's own fiber, which does not
// declare `webServer`, so the call threw
//   cannot get property "webServer" without inject
// and the channel never appeared (the settings card then reported
// 配置列表读取失败 with nothing in the server log). The transport now
// registers the prefix route on `webServer` itself and speaks the connection
// envelope, so this test pins the parts that broke and the parts a naive
// rewrite would break:
//   1. registration shape: a `prefix` route at `/omds` on `webServer`;
//   2. the trust fence on that route (401 unauthenticated, body "unauthorized");
//   3. the client envelope: `{type:'server-response', rpcId, result}` with the
//      caller's rpcId echoed, `{ok:true, value}` on success, and a coded
//      `{ok:false, error:{code,message,details}}` whose `details` is a record —
//      both 0.1.2 and 0.1.5 clients reject a failure envelope without it.
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../npm-package/lib/index.js';

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

const home = join(tmpdir(), `omds-rpc-unit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
mkdirSync(home, { recursive: true });
const prevHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;

try {
  // ----------------------------------------------------------------- stubs
  // The native roster shape: every entry carries the preset.yml `path` the
  // endpoints turn into a profile directory (presetDirOf = dirname(path)).
  const presetPath = (id) => join(home, '.agent-presets', id, 'preset.yml');
  const roster = [
    { id: 'oh-my-dsh-slim', name: '极简角色委派', path: presetPath('oh-my-dsh-slim') },
    { id: 'profile-omd-ds-abc123', name: 'omd-ds', path: presetPath('profile-omd-ds-abc123') },
  ];
  const agentPresets = {
    list: async () => roster.map((entry) => ({ ...entry })),
    resolve: async (id) => ({ id, path: presetPath(id) }),
    copy: async () => {},
    defaultId: 'oh-my-dsh-slim',
  };
  const settings = { register: () => {}, describe: () => ({}) };

  let route;
  const cctx = {
    webServer: { register: (registered) => { route = registered; return () => {}; } },
    connection: { requestRejection: (req) => (req.reject === true ? 401 : undefined) },
    agentPresets,
    inject: (deps, callback) => { if (deps.includes('settings')) callback({ settings }); },
  };
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    inject: (deps, callback) => {
      if (deps.includes('webServer')) callback(cctx);
      else if (deps.includes('settings')) callback({ settings });
    },
  };

  apply(ctx, { hostVersion: '0.1.5-rc.1' });

  // ------------------------------------------------------------ registration
  console.log('\n[registration: prefix route on webServer]');
  check(route !== undefined, 'the transport registers a webServer route');
  check(route?.kind === 'prefix' && route?.path === '/omds', `/omds prefix route (got ${route?.kind} ${route?.path})`);
  check(typeof route?.handler === 'function', 'route carries a request handler');

  const call = async (body, options = {}) => {
    const res = {
      code: undefined,
      headers: undefined,
      body: undefined,
      writeHead(code, headers) { this.code = code; this.headers = headers; },
      end(payload) { this.body = payload; },
    };
    const req = {
      url: `/omds${body?.method === undefined ? '' : `/${body.method}`}`,
      reject: options.reject === true,
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body ?? {})); },
    };
    await route.handler(req, res);
    return res;
  };
  const envelope = (res) => JSON.parse(res.body);

  // ------------------------------------------------------------------ fence
  console.log('\n[fence]');
  const rejected = await call({ type: 'client-request', rpcId: 'r0', method: 'profile-list' }, { reject: true });
  check(rejected.code === 401 && rejected.body === 'unauthorized', 'an unauthenticated request is rejected with 401');

  // ---------------------------------------------------------------- success
  console.log('\n[envelope: success]');
  const listed = await call({ type: 'client-request', rpcId: 'r1', method: 'profile-list', payload: {} });
  const listedBody = envelope(listed);
  check(listed.code === 200, 'profile-list answers 200');
  check(listedBody.type === 'server-response', 'response carries the server-response envelope type');
  check(listedBody.rpcId === 'r1', 'the caller rpcId is echoed back');
  check(listedBody.result?.ok === true && Array.isArray(listedBody.result.value?.profiles ?? listedBody.result.value),
    'profile-list returns ok:true with the roster value');

  // ------------------------------------------------------- envelope: errors
  console.log('\n[envelope: failures]');
  const unknown = envelope(await call({ type: 'client-request', rpcId: 'r2', method: 'profile-nope' }));
  check(unknown.rpcId === 'r2', 'unknown endpoint still echoes rpcId');
  check(unknown.result?.ok === false && unknown.result.error?.code === 'NOT_FOUND', 'unknown endpoint maps to NOT_FOUND');
  check(unknown.result?.error?.details !== null && typeof unknown.result?.error?.details === 'object',
    'error.details is a record (0.1.2/0.1.5 clients reject a failure envelope without it)');

  const conflicted = envelope(await call({
    type: 'client-request',
    rpcId: 'r3',
    method: 'profile-create',
    payload: { displayName: 'omd-ds' },
  }));
  check(conflicted.result?.ok === false && conflicted.result.error?.code === 'PROFILE_NAME_CONFLICT',
    'a coded endpoint error survives the transport');
  check(typeof conflicted.result?.error?.details === 'object', 'coded errors keep a record details field');

  // -------------------------------------------------------------- url fallback
  console.log('\n[endpoint resolution]');
  const noMethod = envelope(await call({ type: 'client-request', rpcId: 'r4' }));
  check(noMethod.rpcId === 'r4', 'a body without method still answers in-envelope');
} finally {
  if (prevHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

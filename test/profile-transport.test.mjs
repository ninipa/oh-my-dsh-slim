import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerProfileTransport } from '../npm-package/lib/profile-transport.js';

function owner(connection = {}) {
  const disposers = [];
  const routes = [];
  const child = { connection,
    effect(callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose); return dispose; },
    webServer: { register(route) { routes.push(route); return () => routes.splice(routes.indexOf(route), 1); } },
  };
  return { child, routes, dispose() { for (const cleanup of disposers.reverse()) cleanup(); } };
}

test('transport imports the native registration method and passes the injected caller explicitly', async () => {
  const { child, dispose } = owner({ marker: 'connection' });
  const handler = () => {};
  const marker = {};
  class HostConnectionService { register(ctx, channel, callback) {
    assert.equal(this, child.connection);
    assert.equal(ctx, child);
    assert.equal(channel, '/omds');
    assert.equal(callback, handler);
    return marker;
  } }
  assert.equal(await registerProfileTransport(child, handler, async (ctx, name) => {
    assert.equal(ctx, child);
    assert.equal(name, '@deepseek-ai/dsh-client-connection');
    return { HostConnectionService };
  }), marker);
  dispose();
});

test('disposed injection cannot register after an asynchronous host import finishes', async () => {
  const { child, dispose } = owner();
  let finish;
  const pending = registerProfileTransport(child, () => {}, () => new Promise(resolve => { finish = resolve; }));
  dispose();
  finish({ HostConnectionService: class { register() { assert.fail('late route registration'); } } });
  await pending;
});

test('missing native registration and failed imports are not silently swallowed', async () => {
  await assert.rejects(registerProfileTransport(owner().child, () => {}, async () => ({})), /native RPC registration/);
  await assert.rejects(registerProfileTransport(owner().child, () => {}, async () => { throw Error('host unavailable'); }), /host unavailable/);
});

const referenceDir = process.env.DSH_HOST_REFERENCE_DIR
  ? resolve(process.env.DSH_HOST_REFERENCE_DIR)
  : fileURLToPath(new URL('../../dsh-host-reference/dsh/node_modules/', import.meta.url));
const connectionFile = join(referenceDir, '@deepseek-ai', 'dsh-client-connection', 'lib', 'index.js');
const skip = existsSync(connectionFile) ? false
  : `Host transport integration unavailable at ${connectionFile}; set DSH_HOST_REFERENCE_DIR to a host node_modules root containing @deepseek-ai.`;

test('actual host register fences before bridge, forwards native handler and peer, and cleans up the caller route', { skip }, async () => {
  // Execute the real exported service's register method. Protocol helper seams
  // deliberately remain unchanged identities; full HTTP/schema/abort acceptance
  // belongs to the web-composition smoke, not to a fabricated wire implementation.
  const source = readFileSync(connectionFile, 'utf8');
  const begin = source.indexOf('\tregister(owner, channel, handler) {');
  const end = source.indexOf('\n\tregisterInterceptor(', begin);
  assert.ok(begin >= 0 && end > begin, 'real HostConnectionService.register source');
  const method = source.slice(begin, end).replace(/^\tregister\(/, 'function register(');
  let bridged = 0;
  const peer = {};
  const signal = new AbortController().signal;
  const callback = async (endpoint, payload, cancel, actualPeer) => {
    assert.equal(endpoint, 'profile-list');
    assert.deepEqual(payload, {});
    assert.equal(cancel, signal);
    assert.equal(actualPeer, peer);
    return { ok: true, value: ['profile'] };
  };
  const nativeFetchHandler = {};
  const register = new Function('assertChannel', 'rpcFetchHandler', 'bridge', `return (${method});`)(
    channel => assert.equal(channel, '/omds'),
    (channel, handler, actualPeer) => {
      assert.equal(handler, callback);
      assert.equal(actualPeer, peer);
      nativeFetchHandler.invoke = () => handler('profile-list', {}, signal, actualPeer);
      return nativeFetchHandler;
    },
    async (req, res, handler) => {
      bridged++;
      assert.equal(handler, nativeFetchHandler);
      res.result = await handler.invoke();
    },
  );
  const connection = { operator: peer, admit: req => req.admission };
  const fixture = owner(connection);
  await registerProfileTransport(fixture.child, callback, async () => ({ HostConnectionService: { prototype: { register } } }));
  assert.equal(fixture.routes.length, 1);
  assert.equal(fixture.routes[0].kind, 'prefix');
  assert.equal(fixture.routes[0].path, '/omds');
  for (const rejection of [401, 403]) {
    const res = { writeHead(status) { this.status = status; }, end(text) { this.text = text; } };
    await fixture.routes[0].handler({ admission: { rejection } }, res);
    assert.equal(res.status, rejection);
    assert.equal(res.text, rejection === 401 ? 'unauthorized' : 'forbidden');
    assert.equal(bridged, 0, 'denial happens before any parsing/backend bridge');
  }
  const response = {};
  await fixture.routes[0].handler({ admission: { peer } }, response);
  assert.deepEqual(response.result, { ok: true, value: ['profile'] });
  assert.equal(bridged, 1);
  fixture.dispose();
  assert.equal(fixture.routes.length, 0, 'caller-owned route cleanup');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, serverConfig, isContinuableAgent, MCP_WAIT_TIMEOUT_MS } from '../npm-package/preset/role-mcp.js';
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

function fixture(t, { delay, fail } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omds-mcp-'));
  const previous = process.env.OH_MY_DSH_SLIM_CONFIG;
  const path = join(dir, 'config.json');
  process.env.OH_MY_DSH_SLIM_CONFIG = path;
  const writeConfig = (command = 'not-executed') => writeFileSync(path, JSON.stringify({
    preset: 'legacy', mcpServers: {
      context7: { transport: 'streamable-http', url: 'https://not-contacted.invalid', headers: { token: 'test' } },
      gh_grep: { transport: 'stdio', command, args: [], env: { TEST: '1' } },
    }, presets: { legacy: { librarian: { mcps: ['context7', 'gh_grep'] } } },
  }));
  writeConfig();
  t.after(() => {
    if (previous === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
    else process.env.OH_MY_DSH_SLIM_CONFIG = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  const composition = {}, foreign = {}, handlers = new Map(), cleanup = [], agents = [], mounted = [], warnings = [];
  const mcp = { async apply() {} };
  const ctx = {
    key: composition,
    loader: { config: { bareModuleBaseUrl: 'file:///mock/index.js' }, internal: { async import(id) {
      if (id === '@deepseek-ai/dsh-scope') return { scopeOf: (c) => c.key, scopeChainOf: (k) => [k, k?.parent] };
      assert.equal(id, '@deepseek-ai/dsh-mcp-client'); return mcp;
    } } },
    agents: { list: () => agents }, logger: { warn: (...args) => warnings.push(args) },
    effect(setup) { cleanup.push(setup()); },
    on(event, fn) { handlers.set(event, fn); },
  };
  function agent(role = 'librarian', mode = 'continuable', parent = composition) {
    const listeners = new Map(), visible = new Set();
    const a = { id: 'agent-' + agents.length, options: {}, session: { events: role ? [{ type: 'subagent/descriptor', data: { mode, persona: 'oh-my-dsh-slim-role:' + role + '.' } }] : [] } };
    a.ctx = {
      key: { parent }, tools: { schemas: (scope) => { assert.equal(scope, a); return [...visible].map((name) => ({ name })); } },
      on(event, fn) { listeners.set(event, fn); return () => listeners.delete(event); },
      plugin(plugin, config) {
        assert.equal(plugin, mcp);
        const record = { agent: a, config, disposed: 0 }; mounted.push(record);
        let closed = false;
        const startup = Promise.resolve().then(async () => {
          if (delay) await delay.promise;
          if (fail === config.serverName) throw new Error('mock connection failed');
          if (!closed) visible.add('mcp__' + config.serverName + '__lookup');
        });
        const fiber = {
          async await() { await startup; return this; },
          async dispose() { if (closed) return; closed = true; record.disposed++; visible.delete('mcp__' + config.serverName + '__lookup'); await startup.catch(() => {}); },
        };
        return fiber;
      },
    };
    a.assemble = async () => {
      const assembly = { tools: a.ctx.tools.schemas(a) };
      const fn = listeners.get('system-prompt/assemble');
      if (fn) await fn(assembly, { agent: a }, async () => assembly);
      return assembly;
    };
    a.visible = visible; a.listeners = listeners; agents.push(a); return a;
  }
  return { ctx, agent, mounted, warnings, foreign, writeConfig,
    emit: async (event, payload) => handlers.get(event)?.(payload),
    dispose: async () => { for (const fn of cleanup.reverse()) await fn(); } };
}

test('native services and legacy client config remain unchanged', () => {
  assert.deepEqual(inject, ['loader', 'agents', 'tools']);
  assert.equal(MCP_WAIT_TIMEOUT_MS, 20000);
  assert.deepEqual(serverConfig('context7', { transport: 'stdio', command: 'local' }), { transport: 'stdio', command: 'local', serverName: 'context7' });
});

test('continuable eligibility excludes one-shot, unknown and inherited descriptors', () => {
  assert.equal(isContinuableAgent({ options: { dshRunMode: 'continuable' } }), true);
  assert.equal(isContinuableAgent({ options: { dshRunMode: 'one-shot' }, session: { events: [{ type: 'subagent/descriptor', data: { mode: 'continuable' } }] } }), false);
  assert.equal(isContinuableAgent({ session: { inheritedEventCount: 1, events: [{ type: 'subagent/descriptor', data: { mode: 'continuable' } }] } }), false);
  assert.equal(isContinuableAgent({ session: { ownEvents: () => [{ type: 'subagent/descriptor', data: { mode: 'continuable' } }] } }), true);
  assert.equal(isContinuableAgent({}), false);
});

test('only exact continuable librarian scope mounts MCP and first snapshot refreshes', async (t) => {
  const f = fixture(t);
  const main = f.agent(null), oracle = f.agent('oracle'), foreground = f.agent('librarian', 'one-shot');
  const child = f.agent(); f.agent('librarian', 'continuable', f.foreign);
  await apply(f.ctx);
  const assembly = await child.assemble();
  assert.deepEqual(assembly.tools.map((x) => x.name), ['mcp__context7__lookup', 'mcp__gh_grep__lookup']);
  assert.equal(f.mounted.length, 2);
  assert.ok(f.mounted.every((x) => x.agent === child));
  assert.equal(main.visible.size + oracle.visible.size + foreground.visible.size, 0);
  assert.equal(f.mounted[0].config.failOnStartupError, undefined);
  assert.equal(f.mounted[1].config.command, 'not-executed');
  await f.emit('agent/created', { agent: child });
  await f.emit('tools/change');
  assert.equal(f.mounted.length, 2);
  assert.equal((await child.assemble()).tools.length, 2, 'continued conversation retains clients');
  await f.dispose();
  assert.equal(child.visible.size, 0);
  assert.equal(child.listeners.size, 0);
  assert.ok(f.mounted.every((x) => x.disposed === 1));
});

test('startup failure is open and preserves successful earlier server', async (t) => {
  const f = fixture(t, { fail: 'gh_grep' });
  await apply(f.ctx);
  const child = f.agent();
  await f.emit('agent/created', { agent: child });
  const assembly = await child.assemble();
  assert.deepEqual(assembly.tools.map((x) => x.name), ['mcp__context7__lookup']);
  assert.equal(f.warnings.length, 1);
  assert.equal((await child.assemble()).tools.length, 1);
  assert.ok(f.mounted.every((x) => x.disposed === 0));
  await f.dispose();
});

test('20-second first assembly cap is failure-open and later tools remain usable', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const delay = deferred(), f = fixture(t, { delay });
  await apply(f.ctx);
  const child = f.agent();
  await f.emit('agent/created', { agent: child });
  let completed = false;
  const first = child.assemble().then((x) => { completed = true; return x; });
  await flush();
  t.mock.timers.tick(19999); await flush(); assert.equal(completed, false);
  t.mock.timers.tick(1); await flush();
  assert.equal((await first).tools.length, 0);
  assert.equal((await child.assemble()).tools.length, 0, 'second turn never repeats startup wait');
  delay.resolve(); await flush();
  assert.equal((await child.assemble()).tools.length, 2, 'native late registration benefits send_message follow-up');
  await f.dispose();
});

test('pending teardown claims connections and cancels first-assembly wait', async (t) => {
  const delay = deferred(), f = fixture(t, { delay });
  await apply(f.ctx);
  const child = f.agent();
  await f.emit('agent/created', { agent: child });
  const assembling = child.assemble(); await flush();
  const stopping = f.dispose();
  assert.equal(f.mounted[0].disposed, 1);
  assert.equal((await assembling).tools.length, 0);
  delay.resolve(); await stopping;
  assert.equal(f.mounted.length, 1);
  assert.equal(child.visible.size, 0);
});

test('parallel names isolate Agent disposal and new Agents read latest profile config', async (t) => {
  const f = fixture(t), first = f.agent();
  await apply(f.ctx); await first.assemble();
  f.writeConfig('new-command');
  const second = f.agent(); await f.emit('agent/created', { agent: second }); await second.assemble();
  assert.equal(f.mounted.at(-1).config.command, 'new-command');
  await f.emit('agent/disposed', { agent: first });
  assert.equal(first.visible.size, 0); assert.equal(second.visible.size, 2);
  await f.emit('tools/change'); await flush();
  assert.equal(f.mounted.length, 4, 'disposed Agent cannot reconnect through stale registry notification');
  await f.dispose();
});

test('leaving composition unregisters exact Agent clients', async (t) => {
  const f = fixture(t), child = f.agent();
  await apply(f.ctx); await child.assemble();
  child.ctx.key.parent = f.foreign;
  await f.emit('tools/change'); await flush();
  assert.equal(child.visible.size, 0);
  assert.equal(child.listeners.size, 0);
  await f.dispose();
});

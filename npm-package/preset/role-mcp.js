// Native compatibility restoration: continuable roles alone own MCP clients.
// The host owns connections and registrations; the first assembly waits at
// most 20 seconds and remains failure-open, as in the 0.1.x preset.
import { hostImport } from './bridge.js';
import { loadConfig, bindProfileContext } from './config.js';
import { roleIdForAgent } from './roles.js';

export const name = 'omds-role-mcp';
export const inject = ['loader', 'agents', 'tools'];
export const MCP_WAIT_TIMEOUT_MS = 20000;
export function serverConfig(serverName, server) {
  return { ...server, serverName };
}

/** Persisted descriptors restore eligibility after a cold resume. */
export function isContinuableAgent(agent) {
  if (agent?.options?.dshRunMode !== undefined) return agent.options.dshRunMode === 'continuable';
  const session = agent?.session;
  const events = typeof session?.ownEvents === 'function' ? session.ownEvents()
    : typeof session?.snapshotEvents === 'function' ? session.snapshotEvents(session.inheritedEventCount ?? 0)
    : (session?.events ?? []).slice(session?.inheritedEventCount ?? 0);
  return events.some((event) => event?.type === 'subagent/descriptor' && event.data?.mode === 'continuable');
}

async function quiesce(fiber) {
  await fiber.dispose();
  try { await fiber.await(); } catch { /* startup diagnostics belong to the client */ }
}

export async function apply(ctx, config = {}) {
  bindProfileContext(ctx, config.profileId);
  loadConfig(ctx);
  const scope = await hostImport(ctx, '@deepseek-ai/dsh-scope');
  const mcp = await hostImport(ctx, '@deepseek-ai/dsh-mcp-client');
  if (typeof scope.scopeOf !== 'function' || typeof scope.scopeChainOf !== 'function' || typeof mcp.apply !== 'function') {
    throw new Error('oh-my-dsh-slim: role MCP requires native dsh-scope and dsh-mcp-client APIs');
  }
  const composition = scope.scopeOf(ctx);
  if (composition === undefined) throw new Error('oh-my-dsh-slim: role MCP must mount in the scoped agent preset composition');
  const entries = new Map();
  const departed = new WeakSet();
  let disposed = false;
  const belongs = (agent) => scope.scopeChainOf(scope.scopeOf(agent.ctx)).includes(composition);
  const report = (error) => ctx.logger.warn('role-subagent: MCP setup failed: %s', String(error?.message ?? error));

  function stop(entry) {
    if (entry.stopping) return entry.stopping;
    entry.stopped = true;
    entry.unlisten?.();
    entry.cancelWait?.();
    entry.stopping = (async () => {
      // Claim pending native connects immediately, before draining setup.
      const closing = entry.fibers.map(quiesce);
      await entry.ready.catch(() => {});
      const results = await Promise.allSettled(closing);
      for (const result of results) if (result.status === 'rejected') report(result.reason);
    })();
    return entry.stopping;
  }

  function ensure(agent) {
    if (disposed || departed.has(agent)) return;
    const existing = entries.get(agent);
    if (existing) {
      if (!belongs(agent) || !isContinuableAgent(agent)) {
        stop(existing).finally(() => {
          if (entries.get(agent) === existing) entries.delete(agent);
        }).catch(report);
      }
      return;
    }
    if (!belongs(agent) || !isContinuableAgent(agent)) return;
    const loaded = loadConfig(ctx);
    const role = loaded.roles[roleIdForAgent(agent)];
    if (!role || role.enabled === false) return;
    const names = [...new Set(role.mcps ?? [])].filter((id) => loaded.servers[id] !== undefined);
    if (!names.length) return;
    const entry = { fibers: [], stopped: false, waited: false, ready: undefined };
    entries.set(agent, entry);
    entry.unlisten = agent.ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      if (!entry.waited && !entry.stopped) {
        entry.waited = true;
        let timer;
        const timeout = new Promise((resolve) => {
          entry.cancelWait = resolve;
          timer = setTimeout(resolve, MCP_WAIT_TIMEOUT_MS);
        });
        try {
          await Promise.allSettled([Promise.race([entry.ready, timeout])]);
        } finally {
          clearTimeout(timer);
          entry.cancelWait = undefined;
        }
        if (!entry.stopped) {
          // assemble has already captured its tool snapshot. Refresh only the
          // exact Agent's native MCP schemas, preserving all existing entries.
          for (const tool of agent.ctx.tools.schemas(context.agent ?? agent)) {
            if (tool.name.startsWith('mcp__') && !assembly.tools.some((item) => item.name === tool.name)) assembly.tools.push(tool);
          }
        }
      }
      return next();
    });
    // Serialize clients, matching the legacy install order. Created observers
    // do not return this readiness promise: only the first assembly waits.
    entry.ready = Promise.resolve().then(async () => {
      for (const serverName of names) {
        if (disposed || entry.stopped) return;
        const fiber = agent.ctx.plugin(mcp, serverConfig(serverName, loaded.servers[serverName]));
        entry.fibers.push(fiber);
        await fiber.await();
      }
    });
    entry.ready.catch(report); // retain successful earlier clients on failure
  }

  function reconcile() {
    if (disposed) return;
    for (const agent of ctx.agents.list()) {
      try { ensure(agent); } catch (error) { report(error); }
    }
  }
  ctx.effect(() => async () => {
    disposed = true;
    await Promise.allSettled([...entries.values()].map(stop));
    entries.clear();
  });
  ctx.on('agent/created', ({ agent }) => { ensure(agent); });
  ctx.on('agent/disposed', ({ agent }) => {
    departed.add(agent);
    const entry = entries.get(agent);
    if (!entry) return;
    return stop(entry).finally(() => entries.delete(agent));
  });
  ctx.on('tools/change', reconcile);
  reconcile(); // attach already-live continuable children after preset reload
}

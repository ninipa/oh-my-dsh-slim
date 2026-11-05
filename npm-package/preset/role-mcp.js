// Native compatibility restoration: continuable roles alone own MCP clients.
// The host owns connections and registrations; the first step waits at most
// 20 seconds and remains failure-open, as in the 0.1.x preset.
import { hostImport } from './bridge.js';
import { loadConfig, bindProfileContext } from './config.js';
import { detectHostDshVersion, compareSemver } from '../lib/host-version.js';
import { ROLE_TABLE, roleIdForAgent } from './roles.js';

export const name = 'omds-role-mcp';
export const inject = ['loader', 'agents', 'tools'];
export const MCP_WAIT_TIMEOUT_MS = 20000;

/**
 * First host line that resolves a step's admitted tool set BEFORE prompt
 * assembly. From there the assembly waterfall no longer carries `tools`, so the
 * 0.2.1 pattern (wait inside the waterfall, then append schemas to the snapshot)
 * cannot work: the wait has to finish before `tools.resolve()` runs, which
 * leaves the serial `agent/created` dispatch as the only pre-step hook.
 */
export const STEP_TOOLS_BEFORE_ASSEMBLY = '0.2.2-rc.1';

/** Whether this host needs the pre-step wait; unreadable versions keep 0.2.1 behavior. */
export function waitsBeforeStep(ctx) {
  const version = detectHostDshVersion({ ctx });
  return typeof version === 'string' && compareSemver(version, STEP_TOOLS_BEFORE_ASSEMBLY) >= 0;
}

/**
 * Whether a role may mount MCP tools. Council seats are read-only and the
 * synthesizer is tool-less; MCP tools are appended to the assembly by this
 * module outside tools.restrict, so mounting them for a council role would
 * bypass that boundary. Config validation rejects a non-empty mcps list too.
 * @param roleId - a role id from the session descriptor.
 */
export function roleSupportsMcp(roleId) {
  const row = ROLE_TABLE[roleId];
  return row?.synthesisOnly !== true && !Array.isArray(row?.fixedAllow);
}

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
  const preStepWait = waitsBeforeStep(ctx);
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
    if (disposed || departed.has(agent)) return void 0;
    const existing = entries.get(agent);
    if (existing) {
      if (!belongs(agent) || !isContinuableAgent(agent)) {
        stop(existing).finally(() => {
          if (entries.get(agent) === existing) entries.delete(agent);
        }).catch(report);
        return void 0;
      }
      return existing.stopped ? void 0 : existing;
    }
    if (!belongs(agent) || !isContinuableAgent(agent)) return void 0;
    const loaded = loadConfig(ctx);
    const roleId = roleIdForAgent(agent);
    const role = loaded.roles[roleId];
    if (!role || role.enabled === false) return void 0;
    // Council seats are read-only and the synthesizer is tool-less. MCP tools
    // are appended to the assembly outside tools.restrict, so mounting them for
    // a council role would bypass that boundary. Config validation rejects a
    // non-empty mcps list too; this is the defense-in-depth half.
    if (!roleSupportsMcp(roleId)) return void 0;
    const names = [...new Set(role.mcps ?? [])].filter((id) => loaded.servers[id] !== undefined);
    if (!names.length) return void 0;
    const entry = { fibers: [], stopped: false, waited: false, ready: undefined };
    entries.set(agent, entry);
    // 0.2.1 and older build the tool list during prompt assembly and expose it
    // to the waterfall, so waiting there (and refreshing the snapshot) keeps
    // the bound independent of agent creation. 0.2.2 resolves the step's tool
    // set first; that wait moves to agent/created below.
    if (!preStepWait) {
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
    }
    // Serialize clients, matching the legacy install order. Created observers
    // do not return this readiness promise: only the first step waits.
    entry.ready = Promise.resolve().then(async () => {
      for (const serverName of names) {
        if (disposed || entry.stopped) return;
        const fiber = agent.ctx.plugin(mcp, serverConfig(serverName, loaded.servers[serverName]));
        entry.fibers.push(fiber);
        await fiber.await();
      }
    });
    entry.ready.catch(report); // retain successful earlier clients on failure
    return entry;
  }

  /**
   * Bound one readiness wait exactly like the 0.2.1 assembly path: at most
   * MCP_WAIT_TIMEOUT_MS, failures absorbed. Returns a settled promise so the
   * serial creation dispatch can await it without ever rejecting creation.
   */
  function waitReady(entry) {
    let timer;
    const timeout = new Promise((resolve) => {
      entry.cancelWait = resolve;
      timer = setTimeout(resolve, MCP_WAIT_TIMEOUT_MS);
    });
    return Promise.allSettled([Promise.race([entry.ready, timeout])]).finally(() => {
      clearTimeout(timer);
      entry.cancelWait = undefined;
    });
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
  ctx.on('agent/created', ({ agent }) => {
    const entry = ensure(agent);
    // Serial listeners are awaited before the created Agent is usable, which is
    // the only hook that finishes before the 0.2.2 step tool snapshot.
    if (preStepWait && entry) return waitReady(entry);
  });
  ctx.on('agent/disposed', ({ agent }) => {
    departed.add(agent);
    const entry = entries.get(agent);
    if (!entry) return;
    return stop(entry).finally(() => entries.delete(agent));
  });
  ctx.on('tools/change', reconcile);
  reconcile(); // attach already-live continuable children after preset reload
}

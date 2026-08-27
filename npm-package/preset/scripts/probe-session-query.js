// probe-session-query — zero-cost host API probe (PLAN-BACKGROUND-DELEGATION
// 方案 4 步骤 0). Replaces the stock headless runner; NEVER sends a model
// request. Boots the composed tree, inventories ctx.sessionQuery /
// ctx.subagents from app and agent scopes, then exercises readSurface /
// readEvent / readSession / listChildren against two synthetic subagent-child
// sessions: one kept live in the store, one detached so the read must fall
// back to session persistence. Also pins the two expected error paths
// (unknown session id; full-text search disabled under openAt: never).
//
// Preset-compat section ([compat], added 2026-08-22 after the rc.2
// tools.restrict() regression): when the preset is installed in the probe
// home, mounts it into the probe agent and validates every role's EFFECTIVE
// toolFilter against the real host registry via the production code path
// (role-subagent.js resolveEffectiveFilter) plus a live tools.restrict() call.
// This is the check that would have caught the upgrade break before any GUI
// session. Usage requires copying the preset into <DSH_HOME>/.agent-presets/
// and pinning agent-presets.default (see probe-patch.headless.yml).
// Verdict shapes are printed as one JSON document on stdout.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Same dependency resolution as ../role-subagent.js: a plugin file outside the
// harness tree cannot bare-import @deepseek-ai/*, so resolve them from the
// global DSH install (the same install the `dsh` CLI runs).
function resolveDshPackage() {
  const roots = [];
  if (process.env.DSH_HOME) {
    roots.push(join(process.env.DSH_HOME, 'profiles', 'node_modules'));
    roots.push(join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules'));
  }
  for (const command of ['npm root -g', 'zsh -lic "npm root -g"']) {
    try { roots.push(execSync(command, { encoding: 'utf8' }).trim()); } catch {}
  }
  try {
    const dshBin = realpathSync(execSync('command -v dsh', { encoding: 'utf8' }).trim());
    roots.push(dirname(dirname(dirname(dirname(dshBin)))));
  } catch {}
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const root = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!root) throw new Error('probe-session-query: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return join(root, '@deepseek-ai/dsh/package.json');
}

const require = createRequire(resolveDshPackage());

export const name = 'probe-session-query';
export const inject = ['agentDefaultModel', 'agents', 'sessions'];

export function apply(ctx) {
  const exit = ctx.get('appExit');
  if (exit === void 0) throw new Error('probe-session-query: the launcher must provide ctx.appExit');
  run(ctx).then(
    (code) => exit(code),
    (error) => {
      process.stderr.write(`probe-session-query failed: ${error?.stack ?? String(error)}\n`);
      exit(1);
    },
  );
}

function methodsOf(service) {
  if (service === void 0 || service === null) return [];
  const found = new Set();
  let proto = Object.getPrototypeOf(service);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof service[key] === 'function') found.add(key);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...found].sort();
}

async function settle(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, code: error?.code, message: error?.message };
  }
}

function eventText(event) {
  const message = event?.data?.message;
  if (message === void 0 || !Array.isArray(message.content)) return void 0;
  return message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

function summarizeSurface(outcome) {
  if (!outcome.ok) return outcome;
  const { session, capturedThroughSeq, events } = outcome.value;
  return {
    ok: true,
    id: session.id,
    parentSession: session.parentSession,
    origin: session.origin,
    delegationDepth: session.delegationDepth,
    capturedThroughSeq,
    events: events.map((event) => ({ seq: event.seq, type: event.type, text: eventText(event) })),
  };
}

function summarizeWindow(outcome) {
  if (!outcome.ok) return outcome;
  const { target, startSeq, endSeq, events } = outcome.value;
  return {
    ok: true,
    target: { seq: target.seq, type: target.type, text: eventText(target) },
    startSeq,
    endSeq,
    eventCount: events.length,
  };
}

function summarizeLog(outcome) {
  if (!outcome.ok) return outcome;
  const { session, events } = outcome.value;
  return {
    ok: true,
    id: session.id,
    eventCount: events.length,
    types: events.map((event) => event.type),
  };
}

function summarizeChildren(outcome) {
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    rows: outcome.value.map((row) => row.kind === 'child'
      ? { kind: row.kind, id: row.id, mode: row.mode, activity: row.activity, hasChildren: row.hasChildren }
      : row),
  };
}

async function run(ctx) {
  // Dynamic import (not top-level require): the loader boots plugin entries in
  // parallel, and require() of an ESM module that the tree is concurrently
  // importing fails with ERR_REQUIRE_ESM_RACE_CONDITION. import() joins the
  // in-flight load instead of racing it.
  const { installModelSelection } = await import(require.resolve('@deepseek-ai/dsh-agent'));
  const { createAssistantMessage, createUserMessage } = await import(require.resolve('@deepseek-ai/dsh-llm'));
  const { SessionId } = await import(require.resolve('@deepseek-ai/dsh-session'));

  await ctx.get('loader')?.await();
  const report = { app: {}, agentScope: {}, live: {}, cold: {}, errors: {} };

  const query = ctx.get('sessionQuery');
  report.app.sessionQueryMounted = query !== void 0;
  report.app.sessionQueryMethods = methodsOf(query);
  const subagents = ctx.get('subagents');
  report.app.subagentsMounted = subagents !== void 0;
  report.app.subagentsListChildren = typeof subagents?.listChildren === 'function';
  report.app.sessionPersistenceMounted = ctx.get('sessionPersistence') !== void 0;

  const agents = ctx.get('agents');
  const defaultModel = ctx.get('agentDefaultModel');
  const sessions = ctx.get('sessions');
  if (agents === void 0 || defaultModel === void 0 || sessions === void 0) {
    process.stderr.write('probe-session-query: agents/defaultModel/sessions all required\n');
    return 1;
  }

  const selection = defaultModel.currentSelection();
  const presets = ctx.get('agentPresets');
  const presetDir = presets !== void 0 && process.env.DSH_HOME
    ? join(process.env.DSH_HOME, '.agent-presets', 'oh-my-dsh-slim')
    : undefined;
  const compat = { presetInstalled: presetDir !== undefined && existsSync(presetDir), roles: {} };
  let presetModule;
  if (compat.presetInstalled) {
    // Load the REAL production filter code from the installed preset copy.
    presetModule = await import(join('file://', presetDir, 'role-subagent.js')).catch(() => undefined);
    compat.productionCodeLoaded = presetModule?.fitFilterToKnown !== undefined && presetModule?.knownToolNames !== undefined;
  }
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: void 0 });
      if (presets !== void 0) await presets.mount(agentCtx);
      report.agentScope.presetServicePresent = presets !== void 0;
      report.agentScope.sessionQueryViaGet = agentCtx.get('sessionQuery') !== void 0;
      try {
        report.agentScope.sessionQueryViaProperty = agentCtx.sessionQuery !== void 0;
      } catch (error) {
        report.agentScope.sessionQueryViaProperty = `throws: ${error.message}`;
      }
      try {
        report.agentScope.subagentsListChildren = typeof agentCtx.subagents?.listChildren === 'function';
      } catch (error) {
        report.agentScope.subagentsListChildren = `throws: ${error.message}`;
      }
      try {
        report.agentScope.subagentsViaGet = typeof agentCtx.get('subagents')?.listChildren === 'function';
      } catch (error) {
        report.agentScope.subagentsViaGet = `throws: ${error.message}`;
      }
    },
  });
  const parentId = agent.session.id;

  const userTurn = () => createUserMessage({
    content: [{ type: 'text', text: 'probe question' }],
    source: { kind: 'user' },
  });
  const assistantTurn = (text) => ({
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: selection.provider, model: selection.model },
    }),
  });

  // Live child: stays in the store; queries resolve from the live record.
  const liveChildId = SessionId(`session-${randomUUID()}`);
  const liveChild = sessions.create(liveChildId, {
    meta: { cwd: process.cwd(), parentSession: parentId, origin: 'subagent', delegationDepth: 1 },
  });
  liveChild.append('user/message', userTurn(), { surfaceOp: 'append' });
  liveChild.append('assistant/message', assistantTurn('PROBE_FINAL_ANSWER live'), { surfaceOp: 'append', sourceEventSeqs: [] });
  await sessions.flush(liveChild);

  // Cold child: flushed to persistence, then detached from the store so the
  // same reads must resolve through the persisted log instead.
  const coldChildId = SessionId(`session-${randomUUID()}`);
  const coldChild = sessions.prepare(coldChildId, {
    meta: { cwd: process.cwd(), parentSession: parentId, origin: 'subagent', delegationDepth: 1 },
  });
  const detachCold = sessions.enter(coldChild);
  sessions.announce(coldChild);
  coldChild.append('user/message', userTurn(), { surfaceOp: 'append' });
  coldChild.append('assistant/message', assistantTurn('PROBE_FINAL_ANSWER cold'), { surfaceOp: 'append', sourceEventSeqs: [] });
  await sessions.flush(coldChild);
  detachCold();
  await new Promise((resolve) => setTimeout(resolve, 300));

  report.live.readSurface = summarizeSurface(await settle(query.readSurface(liveChildId)));
  report.live.readEvent = summarizeWindow(await settle(query.readEvent({ sessionId: liveChildId, seq: 1 })));
  report.live.readSession = summarizeLog(await settle(query.readSession(liveChildId)));
  report.live.listChildren = summarizeChildren(await settle(subagents.listChildren(parentId)));

  report.cold.readSurface = summarizeSurface(await settle(query.readSurface(coldChildId)));
  report.cold.readEvent = summarizeWindow(await settle(query.readEvent({ sessionId: coldChildId, seq: 1 })));
  report.cold.listChildren = summarizeChildren(await settle(subagents.listChildren(parentId)));

  // Preset-compat validation (post-create: the live agent handle exposes the
  // exact visible tool set that tools.restrict() validates against).
  if (compat.presetInstalled && presetModule?.fitFilterToKnown && presetModule?.knownToolNames) {
    const known = presetModule.knownToolNames(agent);
    compat.knownToolCount = known instanceof Set ? known.size : 0;
    let configured;
    try {
      configured = JSON.parse(readFileSync(join(presetDir, 'defaults.json'), 'utf8'));
      configured = configured?.presets?.[configured?.preset] ?? {};
    } catch { configured = {}; }
    for (const roleId of ['oracle', 'designer', 'fixer', 'explorer', 'librarian', 'observer']) {
      const deny = Array.isArray(configured[roleId]?.deny) ? configured[roleId].deny : [];
      if (deny.length === 0) continue;
      const rawUnknown = deny.filter((n) => !(known instanceof Set && known.has(n)));
      const effective = presetModule.fitFilterToKnown(known, undefined, deny);
      const finalUnknown = (effective.deny ?? []).filter((n) => !known.has(n));
      compat.roles[roleId] = {
        configuredDeny: deny.length,
        rawUnknown,
        effectiveDenyCount: (effective.deny ?? []).length,
        finalUnknown,
        ok: finalUnknown.length === 0,
      };
    }
  }

  report.errors.unknownSession = await settle(query.readSurface(SessionId('session-probe-missing')));
  report.errors.searchDisabled = await settle(query.searchSessions({ query: 'probe' }));
  report.compat = compat;

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const pass = report.app.sessionQueryMounted
    && report.agentScope.sessionQueryViaGet === true
    && report.live.readSurface.ok
    && report.cold.readSurface.ok
    && report.live.listChildren.ok
    && report.cold.listChildren.ok
    && (!compat.presetInstalled || Object.values(compat.roles).length === 6)
    && Object.values(compat.roles).every((entry) => entry.ok === true);
  process.stdout.write(`PROBE_VERDICT: ${pass ? 'PASS' : 'FAIL'}\n`);
  return pass ? 0 : 1;
}

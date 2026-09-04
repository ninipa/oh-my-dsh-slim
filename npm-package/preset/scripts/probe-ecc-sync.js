// probe-ecc-sync — zero-cost runtime contract probe for the early-close-context
// live inbox path (PLAN-DELEGATION-LIFECYCLE §4.5, synthetic-injection form).
// Replaces the stock headless runner; NEVER sends a model request.
//
// What it verifies on a REAL host + REAL preset composition (early-close-context
// among the mounted rows):
//   1. the preset (incl. ECC + its inject deps systemPrompt/subagents) mounts
//      cleanly into a real agent ctx — a mount/load error throws loudly;
//   2. `agent/inbox/inserted` fires for that agent when a message enters its
//      live inbox, with the fused payload ECC destructures ({agent, message});
//   3. payload.agent.id === the agent's session id (the gating key ECC's live
//      listener compares against trackedParents, which is keyed by
//      exec.agent.session?.id at tools/pre-execute);
//   4. message.source round-trips verbatim — for each delivery shape ECC
//      classifies: {kind:'agent-message',form:'relay',senderSessionId},
//      {kind:'subagent-report',form:'relay',senderSessionId} (legacy alias)
//      and {kind:'subagent-settled',form:'notice',senderSessionId} — plus a
//      non-delivery {kind:'user'} noise message that must be ignored;
//   5. no ECC listener throws on any of those shapes (host dispatch logs
//      "listener threw/rejected"; the probe also traps agent-scope logger
//      warnings emitted during the injection window);
//   6. injected messages land in the session event log as agent/inbox/spliced
//      records — i.e. ECC's replay path (scanSessionEvents) can observe the
//      same deliveries after a later composition mount.
// Ledger *timing* (settled child absent from the next prompt assembly) is not
// observable without a real model turn; that half is the real-headless probe.
// Verdict shapes are printed as one JSON document on stdout.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Same dependency resolution as ../role-subagent.js / ../early-close-context.js:
// a plugin file outside the harness tree cannot bare-import @deepseek-ai/*.
function resolveDshPackage() {
  const roots = [];
  if (process.env.DSH_HOME) {
    roots.push(join(process.env.DSH_HOME, 'profiles', 'node_modules'));
    roots.push(join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules'));
  }
  const probeOptions = { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] };
  for (const command of ['npm root -g', 'zsh -lic "npm root -g"']) {
    try {
      roots.push(execSync(command, probeOptions).trim());
      break;
    } catch {}
  }
  try {
    const dshBin = realpathSync(execSync('command -v dsh', probeOptions).trim());
    roots.push(dirname(dirname(dirname(dirname(dshBin)))));
  } catch {}
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const root = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!root) throw new Error('probe-ecc-sync: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return join(root, '@deepseek-ai/dsh/package.json');
}

const require = createRequire(resolveDshPackage());

export const name = 'probe-ecc-sync';
export const inject = ['agentDefaultModel', 'agents', 'sessions'];

export function apply(ctx) {
  const exit = ctx.get('appExit');
  if (exit === void 0) throw new Error('probe-ecc-sync: the launcher must provide ctx.appExit');
  run(ctx).then(
    (code) => exit(code),
    (error) => {
      process.stderr.write(`probe-ecc-sync failed: ${error?.stack ?? String(error)}\n`);
      exit(1);
    },
  );
}

async function run(ctx) {
  const { installModelSelection } = await import(require.resolve('@deepseek-ai/dsh-agent'));
  const { createUserMessage } = await import(require.resolve('@deepseek-ai/dsh-llm'));
  const { SessionId } = await import(require.resolve('@deepseek-ai/dsh-session'));
  await ctx.get('loader')?.await();

  const report = { env: {}, mount: {}, events: [], checks: {}, spliced: [] };
  const agents = ctx.get('agents');
  const sessions = ctx.get('sessions');
  const defaultModel = ctx.get('agentDefaultModel');
  const presets = ctx.get('agentPresets');
  const presetsMounted = presets !== void 0;
  if (agents === void 0 || sessions === void 0 || defaultModel === void 0) {
    process.stderr.write('probe-ecc-sync: agents/sessions/agentDefaultModel all required\n');
    return 1;
  }
  let selection;
  try {
    selection = defaultModel.currentSelection();
  } catch (error) {
    selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' };
    report.env.selectionFallback = error instanceof Error ? error.message : String(error);
  }
  report.env = {
    ...report.env,
    provider: selection?.provider,
    model: selection?.model,
    presetDirPresent: process.env.DSH_HOME
      && existsSync(join(process.env.DSH_HOME, '.agent-presets', 'oh-my-dsh-slim')),
  };

  const captured = []; // { at, agentId, sessionId, kind, form, senderSessionId, roundTrip }
  const scopeWarnings = [];
  let warned;
  const agentCtxLogger = ctx.get('logger');
  if (agentCtxLogger !== void 0 && typeof agentCtxLogger.warn === 'function') {
    warned = agentCtxLogger.warn;
    agentCtxLogger.warn = (...args) => {
      scopeWarnings.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
      return warned(...args);
    };
  }

  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection?.provider, model: selection?.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: void 0 });
      let mountError;
      try {
        if (presets !== void 0) await presets.mount(agentCtx);
      } catch (error) {
        mountError = error instanceof Error ? error.stack ?? error.message : String(error);
      }
      report.mount = {
        presetsMounted,
        ok: mountError === void 0,
        error: mountError,
      };
      agentCtx.on('agent/inbox/inserted', ({ agent: subject, message }) => {
        captured.push({
          at: Date.now(),
          agentId: subject?.id,
          sessionId: agentCtx.agent?.session?.id,
          source: message?.source === void 0 ? null : { ...message.source },
          hasContent: Array.isArray(message?.content),
        });
      });
    },
  });
  const parentId = agent.session.id;
  const parentAgentId = agent.id;
  report.mount.agentId = parentAgentId;
  report.mount.sessionId = parentId;

  const childId = SessionId(randomUUID());
  const cases = [
    {
      label: 'agent-message relay',
      source: { kind: 'agent-message', form: 'relay', senderSessionId: childId },
      text: `Agent ${childId} sent a message:`,
    },
    {
      label: 'legacy subagent-report relay',
      source: { kind: 'subagent-report', form: 'relay', senderSessionId: childId },
      text: 'legacy relay spelling',
    },
    {
      label: 'subagent-settled notice',
      source: { kind: 'subagent-settled', form: 'notice', summary: 's', senderSessionId: childId },
      text: `Background subagent ${childId} finished and will do no further work unless you send it more.`,
    },
    {
      label: 'noise user message',
      source: { kind: 'user' },
      text: 'ordinary user text',
    },
  ];

  for (const entry of cases) {
    const message = createUserMessage({
      content: [{ type: 'text', text: entry.text }],
      source: { ...entry.source },
    });
    agent.inject(message);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  if (warned !== void 0) agentCtxLogger.warn = warned; // restore before further use

  // Classify what ECC itself would see for each captured event.
  report.events = captured.map((event) => {
    const source = event.source;
    const classified = source !== null && typeof source.senderSessionId === 'string'
      ? (source.kind === 'agent-message' || source.kind === 'subagent-report') ? 'report'
        : source.kind === 'subagent-settled' ? 'settled' : 'ignored'
      : 'ignored';
    return { ...event, source: undefined, classified };
  });

  const byLabel = Object.fromEntries(cases.map((entry, index) => [entry.label, captured[index]]));
  report.checks = {
    mountOk: report.mount.ok === true,
    eventCount: captured.length === cases.length,
    relayAgentIdMatchesSession: byLabel['agent-message relay']?.agentId === parentAgentId
      && byLabel['agent-message relay']?.agentId === parentId,
    sourceRoundTrip: cases.every((entry) => {
      const got = byLabel[entry.label];
      if (got === void 0) return false;
      const s = got.source;
      return s !== null && Object.keys(entry.source).every((k) => s[k] === entry.source[k]);
    }),
    contentPresent: captured.every((event) => event.hasContent === true),
    noiseIgnored: byLabel['noise user message'] !== void 0,
    noListenerThrow: scopeWarnings.filter((w) => w.includes('listener threw') || w.includes('listener rejected')).length === 0,
  };
  if (scopeWarnings.length > 0) report.checks.scopeWarnings = scopeWarnings;

  // Durable visibility (informational only): injected-but-unclaimed deliveries
  // stay in the live inbox — spliced session-log records are committed at a
  // real step boundary when the batch is claimed, which a zero-turn probe never
  // reaches. The live inbox event (captured above) is the contract ECC's sync
  // path consumes; claim-time persistence is covered by the real-headless probe.
  try {
    await sessions.flush(agent.session);
  } catch {}
  for (const event of agent.session.events ?? []) {
    if (event.type !== 'agent/inbox/spliced') continue;
    for (const msg of event?.data?.inserted ?? []) {
      const source = msg?.source;
      if (source === void 0) continue;
      report.spliced.push({
        seq: event.seq,
        kind: source.kind,
        senderSessionId: source.senderSessionId,
      });
    }
  }
  report.checks.splicedVisible = 'unclaimed (live inbox only; claim-time persistence needs a real turn — see real-headless probe)';

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const pass = report.checks.mountOk
    && report.checks.eventCount
    && report.checks.relayAgentIdMatchesSession
    && report.checks.sourceRoundTrip
    && report.checks.contentPresent
    && report.checks.noListenerThrow;
  process.stdout.write(`PROBE_VERDICT: ${pass ? 'PASS' : 'FAIL'}\n`);
  return pass ? 0 : 1;
}

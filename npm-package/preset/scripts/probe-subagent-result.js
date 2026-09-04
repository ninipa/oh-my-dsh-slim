// probe-subagent-result — zero-cost REAL-service probe for subagent-result.js.
// Replaces the stock headless runner; NEVER sends a model request.
//
// subagent_result is a singleton tool row of the preset; its execute() runs
// the plugin's real code against the real ctx.sessionQuery over real sessions.
// This probe mounts the REAL preset on a parent agent, grabs the registered
// tool definition from the real tools registry, and calls execute() directly:
//   - tool registered exactly once under the real name;
//   - settled-style child (assistant final message) -> {kind:'result'} with
//     the expected text (readSurface live path);
//   - child with no assistant message -> {kind:'no-assistant-message'};
//   - child whose parentSession is another session -> authorization error;
//   - unknown session id -> mapped "no session" error;
//   - cold child (flushed then detached from the store) still resolves through
//     session persistence -> {kind:'result'}.
// Verdict: one JSON document on stdout, PROBE_VERDICT line, exit code.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function resolveHostRoot() {
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
  if (!root) throw new Error('probe-subagent-result: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return root;
}

export const name = 'probe-subagent-result';
export const inject = ['agents', 'agentDefaultModel', 'sessions'];

export function apply(ctx) {
  const exit = ctx.get('appExit');
  if (exit === void 0) throw new Error('probe-subagent-result: the launcher must provide ctx.appExit');
  run(ctx).then(
    (code) => exit(code),
    (error) => {
      process.stderr.write(`probe-subagent-result failed: ${error?.stack ?? String(error)}\n`);
      exit(1);
    },
  );
}

async function run(ctx) {
  const hostRoot = resolveHostRoot();
  const requireHost = createRequire(join(hostRoot, '@deepseek-ai/dsh/package.json'));
  const { SessionId } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-session')).href);
  const { installModelSelection } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-agent')).href);
  const { createUserMessage, createAssistantMessage } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-llm')).href);
  await ctx.get('loader')?.await();

  const agents = ctx.get('agents');
  const sessions = ctx.get('sessions');
  const defaultModel = ctx.get('agentDefaultModel');
  const presets = ctx.get('agentPresets');
  if (agents === void 0 || sessions === void 0 || defaultModel === void 0 || presets === void 0) {
    process.stderr.write('probe-subagent-result: agents/sessions/agentDefaultModel/agentPresets all required\n');
    return 1;
  }
  const checks = {};
  const facts = {};
  let selection;
  try {
    selection = defaultModel.currentSelection();
  } catch {
    selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' };
  }

  const captured = { tool: undefined, toolCount: 0 };
  const { agent: parent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection?.provider, model: selection?.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: void 0 });
      await presets.mount(agentCtx);
      // Scoped registration shadows globals: look up through the AGENT scope
      // (tools.get without scopeKey returns the global view -> undefined).
      let found = agentCtx.tools?.get?.('subagent_result', agentCtx.agent);
      if (found === undefined) found = agentCtx.tools?.get?.('subagent_result');
      if (found === undefined) {
        // Some registry shapes need an explicit view; report absence clearly.
        captured.tool = undefined;
        captured.toolCount = 0;
        return;
      }
      captured.tool = found;
      captured.toolCount = 1;
    },
  });
  const parentId = parent.id;
  facts.parentId = parentId;
  checks.toolRegistered = captured.tool !== undefined;
  if (captured.tool === undefined) {
    process.stdout.write(`${JSON.stringify({ facts, checks }, null, 2)}\n`);
    process.stdout.write('PROBE_VERDICT: FAIL\n');
    return 1;
  }
  const execute = captured.tool.execute ?? captured.tool.run;
  checks.executeCallable = typeof execute === 'function';
  facts.registrationName = captured.tool.name ?? captured.tool.definition?.name ?? '?';

  const userTurn = (text) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
  // assistant/message events must be identified by {turn, step, message} —
  // the same shape probe-session-query uses (a bare message is rejected by
  // session validation as "lacks an identified message").
  const assistantTurn = (text, step = 1) => ({
    turn: 1,
    step,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: selection.provider, model: selection.model },
    }),
  });

  function makeChild(label, { withFinal, parentFor }) {
    const id = SessionId(`session-${randomUUID()}`);
    const child = sessions.create(id, {
      meta: {
        cwd: process.cwd(),
        parentSession: parentFor ?? parentId,
        origin: 'subagent',
        delegationDepth: 1,
      },
    });
    child.append('user/message', userTurn(`${label} question`), { surfaceOp: 'append' });
    if (withFinal) {
      child.append('assistant/message', assistantTurn(`${label} FINAL ANSWER ${randomUUID()}`), {
        surfaceOp: 'append',
        sourceEventSeqs: [],
      });
    }
    return { id, child, label };
  }

  const liveDone = makeChild('live-done', { withFinal: true });
  await sessions.flush(liveDone.child);
  const liveNoMsg = makeChild('live-nomsg', { withFinal: false });
  await sessions.flush(liveNoMsg.child);
  const foreign = makeChild('foreign', { withFinal: true, parentFor: SessionId('session-someone-else') });
  await sessions.flush(foreign.child);
  // Cold child: flushed to persistence, then detached so reads must fall back
  // to session persistence (same construction as probe-session-query).
  const coldId = SessionId(`session-${randomUUID()}`);
  const cold = sessions.prepare(coldId, {
    meta: { cwd: process.cwd(), parentSession: parentId, origin: 'subagent', delegationDepth: 1 },
  });
  const detach = sessions.enter(cold);
  sessions.announce(cold);
  cold.append('user/message', userTurn('cold question'), { surfaceOp: 'append' });
  cold.append('assistant/message', assistantTurn('cold FINAL ANSWER'), { surfaceOp: 'append', sourceEventSeqs: [] });
  await sessions.flush(cold);
  detach();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const execCtx = { agent: parent };
  async function callTool(childId) {
    return execute({ subagent_id: String(childId) }, execCtx);
  }
  async function callExpectError(childId, snippet) {
    try {
      await callTool(childId);
      return `no error thrown (expected ${snippet})`;
    } catch (error) {
      const message = error?.message ?? String(error);
      return message.includes(snippet) ? true : message;
    }
  }

  try {
    const out = await callTool(liveDone.id);
    checks.liveResult = out?.kind === 'result' && typeof out?.text === 'string' && out.text.includes('live-done FINAL ANSWER');
  } catch (error) {
    checks.liveResult = `threw: ${error?.message ?? String(error)}`;
  }
  try {
    const out = await callTool(liveNoMsg.id);
    checks.noAssistantKind = out?.kind === 'no-assistant-message' && typeof out?.capturedThroughSeq === 'number';
  } catch (error) {
    checks.noAssistantKind = `threw: ${error?.message ?? String(error)}`;
  }
  checks.foreignRejected = await callExpectError(foreign.id, 'not a direct child');
  checks.unknownMapped = await callExpectError(SessionId('session-probe-does-not-exist'), 'no session');
  try {
    const out = await callTool(coldId);
    checks.coldResult = out?.kind === 'result' && out.text.includes('cold FINAL ANSWER');
  } catch (error) {
    checks.coldResult = `threw: ${error?.message ?? String(error)}`;
  }

  process.stdout.write(`${JSON.stringify({ facts, checks }, null, 2)}\n`);
  const pass = checks.toolRegistered === true && checks.executeCallable === true
    && checks.liveResult === true && checks.noAssistantKind === true
    && checks.foreignRejected === true && checks.unknownMapped === true
    && checks.coldResult === true;
  process.stdout.write(`PROBE_VERDICT: ${pass ? 'PASS' : 'FAIL'}\n`);
  return pass ? 0 : 1;
}

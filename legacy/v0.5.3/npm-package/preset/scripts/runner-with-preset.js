// runner-with-preset — one-shot direct Agent driver that mounts the agent
// preset before running the task. Copies the stock headless runner
// (dsh-headless) and adds `agentPresets.mount(agentCtx)` in the agent setup
// hook, which the stock headless runner never calls — so headless sessions
// otherwise run WITHOUT any preset (no role tools, persona, toolFilter, or
// effort plugin). This makes preset behavior testable from the CLI.
import { randomUUID } from 'node:crypto';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';

export const name = 'runner-with-preset';
export const inject = ['agentDefaultModel', 'agents', 'sessions'];

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(events, firstSeq) {
  let started = false;
  let text = '';
  let reason;
  for (const event of events) {
    if (event.seq < firstSeq) continue;
    if (event.type === 'turn/start') { started = true; continue; }
    if (!started) continue;
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (joined !== '') text = joined;
    }
    if (event.type === 'turn/end') reason = event.data.reason;
  }
  return { text, reason };
}

export function apply(ctx, config) {
  const exit = ctx.get('appExit');
  if (exit === void 0) throw new Error('runner-with-preset: the launcher must provide ctx.appExit before the tree mounts');
  const io = { stdout: process.stdout, stderr: process.stderr, exit };
  const task = config?.task ?? parseTask(process.argv);
  if (!task) throw new Error('runner-with-preset: no task (pass a task positional)');
  run(ctx, task, io).catch((error) => {
    io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
    io.exit(1);
  });
}

/** Reconstruct the task positional from argv, mirroring headless-startup's join. */
function parseTask(argv) {
  const args = argv.slice(2);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--profile' || a === '--patch') { i++; continue; }
    if (a.startsWith('--')) continue;
    out.push(a);
  }
  return out.join(' ');
}

async function run(ctx, task, io) {
  await ctx.get('loader')?.await();
  const agents = ctx.get('agents');
  const defaultModel = ctx.get('agentDefaultModel');
  const sessions = ctx.get('sessions');
  if (agents === void 0 || defaultModel === void 0 || sessions === void 0) return;
  const selection = defaultModel.currentSelection();
  const presets = ctx.get('agentPresets');
  if (presets === void 0) io.stderr.write('dsh: WARNING agentPresets service absent; preset will NOT be mounted\n');
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: {
      provider: selection.provider,
      model: selection.model
    },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: void 0 });
      if (presets !== void 0) await presets.mount(agentCtx);
    }
  });
  await agent.whenIdle();
  const firstSeq = agent.session.seq;
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: task }],
    source: { kind: 'user' }
  }));
  await agent.whenIdle();
  await sessions.flush(agent.session);
  // 0.1.2-alpha.4 replaced the `session.events` property with snapshotEvents().
  const outcome = summarize(agent.session.snapshotEvents(), firstSeq);
  io.stdout.write(outcome.text + '\n');
  if (outcome.reason?.kind === 'error') io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`);
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1);
}

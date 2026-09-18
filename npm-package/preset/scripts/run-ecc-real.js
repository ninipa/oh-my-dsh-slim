// run-ecc-real — real-model driver for the early-close-context settlement
// ordering probe (PLAN-DELEGATION-LIFECYCLE §4.5, real-headless form).
// Replaces the stock headless runner. Mounts the preset on a freshly created
// agent (real composition incl. early-close-context), then drives one real
// delegation: turn 1 delegates a subagent_explorer and waits; the child really
// runs (model calls), really relays/settles, and its settle notice really
// steers the parent. The plugin logs each prompt assembly's rendered running
// block to stderr when ECC_DEBUG=1; ordering vs the real inbox events is
// judged by scripts/analyze-ecc-real.mjs.
//
// The probe itself only verifies the run completed the delegation + settle
// cycle; the ledger-timing verdict lives in the analyzer (render-before-settle
// contains the child; every render after the settle notice does not).
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
  if (!root) throw new Error('run-ecc-real: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return join(root, '@deepseek-ai/dsh/package.json');
}

const require = createRequire(resolveDshPackage());

export const name = 'run-ecc-real';
export const inject = ['agentDefaultModel', 'agents', 'sessions'];

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (message) => (Array.isArray(message?.content)
  ? message.content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('')
  : '');

export function apply(ctx) {
  const exit = ctx.get('appExit');
  if (exit === void 0) throw new Error('run-ecc-real: the launcher must provide ctx.appExit');
  run(ctx).then(
    (code) => exit(code),
    (error) => {
      process.stderr.write(`run-ecc-real failed: ${error?.stack ?? String(error)}\n`);
      exit(1);
    },
  );
}

async function run(ctx) {
  const { installModelSelection } = await import(require.resolve('@deepseek-ai/dsh-agent'));
  const { createUserMessage } = await import(require.resolve('@deepseek-ai/dsh-llm'));
  const { SessionId } = await import(require.resolve('@deepseek-ai/dsh-session'));
  await ctx.get('loader')?.await();

  const agents = ctx.get('agents');
  const sessions = ctx.get('sessions');
  const defaultModel = ctx.get('agentDefaultModel');
  const presets = ctx.get('agentPresets');
  if (agents === void 0 || sessions === void 0 || defaultModel === void 0 || presets === void 0) {
    process.stderr.write('run-ecc-real: agents/sessions/agentDefaultModel/agentPresets all required\n');
    return 1;
  }
  let selection;
  try {
    selection = defaultModel.currentSelection();
  } catch {
    // Fallback for a scratch home without settings: the dedicated V4.1 Flash
    // route (same provider/model the preset roles use in real runs).
    selection = { provider: 'opencode-ds-v41-flash', model: 'deepseek-flash' };
  }

  const report = {
    provider: selection?.provider,
    model: selection?.model,
    delegationChild: null,
    settleSeen: false,
    relaySeen: false,
    eccDebugActive: process.env.ECC_DEBUG === '1',
    phase: {},
  };
  const inboxLog = [];

  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection?.provider, model: selection?.model },
    setup: async (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: void 0 });
      await presets.mount(agentCtx);
      agentCtx.on('agent/inbox/inserted', ({ message }) => {
        const source = message?.source;
        const kind = typeof source?.kind === 'string' ? source.kind : '?';
        const text = textOf(message);
        const child = text.match(UUID_RE)?.[0] ?? (typeof source?.senderSessionId === 'string' ? source.senderSessionId : '');
        inboxLog.push({ at: Date.now(), kind, child, plugin: source?.plugin, text: text.slice(0, 120) });
        if (kind === 'plugin' && source?.plugin === 'early-close-context' && child) {
          report.delegationChild = child;
          console.error(`[ecc-real] delegation reminder child=${child}`);
        } else if (kind === 'agent-message' || kind === 'subagent-report') {
          report.relaySeen = true;
          console.error(`[ecc-real] inbox relay kind=${kind} child=${child}`);
        } else if (kind === 'subagent-settled') {
          report.settleSeen = true;
          console.error(`[ecc-real] inbox settle child=${child}`);
        }
      });
    },
  });
  report.parentId = agent.session.id;

  async function waitIdle(timeoutMs, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (agent.status === 'idle') return true;
      await sleep(300);
    }
    report.phase[label] = `timeout after ${timeoutMs}ms (status=${agent.status})`;
    return false;
  }

  const task = createUserMessage({
    content: [{ type: 'text', text:
      '做一个受控实验,分两步完成,严格按顺序执行:\n'
      + '1) 立即派发一个后台 subagent_explorer,description 写:「列出当前工作目录下任意 3 个文件名」。派发后继续等待,直到收到它的正式完成通知(settle 通知)。\n'
      + '2) 收到正式完成通知后,用一两句话转述它报告的三个文件名,然后结束。\n'
      + '整个过程只做这一件事,不要做任何其它调查或操作。' }],
    source: { kind: 'user' },
  });

  report.phase.turn1 = 'started';
  agent.followup(task);
  const idle1 = await waitIdle(240000, 'turn1+settle');

  let settleIdle = report.settleSeen;
  if (!report.settleSeen) {
    const t0 = Date.now();
    while (!report.settleSeen && Date.now() - t0 < 180000) await sleep(300);
    settleIdle = report.settleSeen;
  }
  report.phase.settleWait = settleIdle ? 'seen' : 'timeout';

  if (settleIdle && report.delegationChild !== null) {
    // Guarantee at least one prompt assembly AFTER the settle notice, so the
    // analyzer can check the running block is empty there.
    await sleep(1500);
    const nudge = createUserMessage({
      content: [{ type: 'text', text:
        '子代理已正式完成。请用一两句话转述它报告的三个文件名,然后结束,不要再做其它事。' }],
      source: { kind: 'user' },
    });
    agent.followup(nudge);
    await waitIdle(150000, 'nudge');
  }

  try {
    await sessions.flush(agent.session);
  } catch {}

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const pass = report.delegationChild !== null && report.settleSeen;
  process.stdout.write(`RUN_VERDICT: ${pass ? 'PASS' : 'FAIL'}\n`);
  return pass ? 0 : 1;
}

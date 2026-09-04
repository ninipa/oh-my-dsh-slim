// probe-spawn-child — zero-cost child-join probe. Reproduces the exact
// materialize path of dsh-subagent: creates a PARENT agent that mounts the
// preset, then creates a CHILD agent whose setup calls presets.composeFrom
// (the same call applyChildComposition makes), then enumerates the child's
// visible tool registry. Answers whether the child joined the standing
// composition at all. No model request is ever sent.
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
    // zsh -lic sources the user's login+interactive shell config, which can hang
    // (reported on Linux); every probe is bounded and silent on stderr.
    try {
      roots.push(execSync(command, probeOptions).trim());
      break; // first reachable npm root wins; the zsh fallback only runs when plain sh lacks npm
    } catch {}
  }
  try {
    const dshBin = realpathSync(execSync('command -v dsh', probeOptions).trim());
    roots.push(dirname(dirname(dirname(dirname(dshBin)))));
  } catch {}
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const root = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!root) throw new Error('probe-spawn-child: cannot locate the DSH node_modules');
  return join(root, '@deepseek-ai/dsh/package.json');
}

const require = createRequire(resolveDshPackage());

export const name = 'probe-spawn-child';
export const inject = ['agentDefaultModel', 'agents', 'sessions'];

export function apply(ctx) {
  run(ctx).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`probe-spawn-child failed: ${error?.stack ?? String(error)}\n`);
      process.exit(1);
    },
  );
}

async function run(ctx) {
  const { installModelSelection } = await import(require.resolve('@deepseek-ai/dsh-agent'));
  const { SessionId } = await import(require.resolve('@deepseek-ai/dsh-session'));

  await ctx.get('loader')?.await();
  const report = {};

  const agents = ctx.get('agents');
  const defaultModel = ctx.get('agentDefaultModel');
  const sessions = ctx.get('sessions');
  const presets = ctx.get('agentPresets');
  report.presetServiceMounted = presets !== void 0;
  if (agents === void 0 || defaultModel === void 0 || sessions === void 0) {
    process.stderr.write('probe-spawn-child: agents/defaultModel/sessions required\n');
    return 1;
  }

  const selection = defaultModel.currentSelection();
  const common = { cwd: process.cwd() };
  const setupMount = async (agentCtx) => {
    installModelSelection(agentCtx, { current: selection, assembled: void 0 });
    if (presets !== void 0) await presets.mount(agentCtx);
  };

  const { agent: parent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: common,
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: setupMount,
  });
  report.parentPreset = presets?.composedPreset(parent.ctx);
  const parentSchemas = parent?.ctx?.tools?.schemas?.(parent);
  report.parentToolCount = Array.isArray(parentSchemas) ? parentSchemas.length : null;
  report.parentHasLibrarian = Array.isArray(parentSchemas) && parentSchemas.some((t) => t.name === 'subagent_librarian');

  const { agent: child } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { ...common, parentSession: parent.session.id, origin: 'subagent', delegationDepth: 1 },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (childCtx) => {
      installModelSelection(childCtx, { current: selection, assembled: void 0 });
      report.childJoined = presets?.composeFrom(childCtx, parent.ctx) ?? null;
    },
  });
  const childSchemas = child?.ctx?.tools?.schemas?.(child);
  const childNames = Array.isArray(childSchemas) ? childSchemas.map((t) => t.name).sort() : undefined;
  report.childToolCount = childNames?.length ?? null;
  report.childToolNames = childNames;

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const pass = report.childJoined !== null && report.childToolCount !== null;
  process.stdout.write(`PROBE_VERDICT: ${pass ? 'PASS' : 'FAIL'}\n`);
  return pass ? 0 : 1;
}
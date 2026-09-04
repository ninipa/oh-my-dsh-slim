// probe-effort-real — zero-cost REAL-event-chain probe for effort-by-role.js.
// Replaces the stock headless runner; NEVER sends a model request.
//
// effort-by-role hooks the host's `agent/request` waterfall, which the agent
// loop drives as dispatch.waterfall('agent/request', payload, () => seed).
// This probe mounts the REAL preset (effort plugin among the rows) on freshly
// created agents and drives that EXACT dispatch call, so the plugin's real
// listener code runs over the real event bus against a real config-loader:
//   phase default (OMDS_EFFORT_PHASE=default):
//     - top-level agent (no role marker): temperature defaults to 0.1,
//       reasoningEffort untouched; an explicit temperature is preserved;
//     - role child agent (options.dshRoleId=fixer, subagentDepth=1):
//       reasoningEffort/temperature land on the role's config values (loaded
//       from the INSTALLED preset's own config-loader, same module the
//       plugin uses);
//     - idempotence: a seed already carrying the role effort is unchanged;
//     - resumed child (no subagentDepth, delegationDepth header + descriptor
//       marker): same role override via the marker path (best-effort).
//   phase none (OMDS_EFFORT_PHASE=none, OH_MY_DSH_SLIM_CONFIG=<user file>):
//     - role child with effort 'none': reasoningEffort is NOT injected.
// Each phase runs in its own process (config-loader env/caching isolation).
// Verdict: one JSON document on stdout, PROBE_VERDICT line, exit code.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
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
  if (!root) throw new Error('probe-effort-real: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return root;
}

export const name = 'probe-effort-real';
export const inject = ['agents', 'agentDefaultModel'];

export function apply(ctx) {
  const exit = ctx.get('appExit');
  if (exit === void 0) throw new Error('probe-effort-real: the launcher must provide ctx.appExit');
  run(ctx).then(
    (code) => exit(code),
    (error) => {
      process.stderr.write(`probe-effort-real failed: ${error?.stack ?? String(error)}\n`);
      exit(1);
    },
  );
}

async function run(ctx) {
  const hostRoot = resolveHostRoot();
  const requireHost = createRequire(join(hostRoot, '@deepseek-ai/dsh/package.json'));
  const { SessionId } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-session')).href);
  const { installModelSelection } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-agent')).href);
  await ctx.get('loader')?.await();

  const agents = ctx.get('agents');
  const defaultModel = ctx.get('agentDefaultModel');
  const presets = ctx.get('agentPresets');
  if (agents === void 0 || defaultModel === void 0 || presets === void 0) {
    process.stderr.write('probe-effort-real: agents/agentDefaultModel/agentPresets all required\n');
    return 1;
  }
  const presetDir = join(process.env.DSH_HOME, '.agent-presets', 'oh-my-dsh-slim');
  const phase = process.env.OMDS_EFFORT_PHASE ?? 'default';
  const checks = {};
  const facts = { phase, presetDirPresent: existsSync(presetDir) };

  let selection;
  try {
    selection = defaultModel.currentSelection();
  } catch {
    selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' };
  }
  const seed = { provider: selection?.provider, model: selection?.model };

  // The plugin and this probe must agree on expectations: load the INSTALLED
  // copy's own config-loader (same file the plugin's module imports). Env for
  // the 'none' phase is set before the first loadConfig so the module cache
  // (if any) is primed consistently for plugin and probe alike.
  let expectedFixer;
  try {
    const { loadConfig } = await import(pathToFileURL(join(presetDir, 'config-loader.js')).href);
    expectedFixer = loadConfig(undefined)?.roles?.fixer;
  } catch (error) {
    facts.configLoaderError = error instanceof Error ? error.message : String(error);
  }
  facts.fixerConfig = expectedFixer;

  async function createAgent(options = {}, extra = {}) {
    return agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd(), ...(extra.meta ?? {}) },
      agentOptions: { provider: seed.provider, model: seed.model, ...options },
      setup: async (agentCtx) => {
        installModelSelection(agentCtx, { current: selection, assembled: void 0 });
        await presets.mount(agentCtx);
      },
    });
  }

  async function requestConfig(handle, base) {
    return handle.agent.dispatch.waterfall(
      'agent/request',
      { turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ ...base }),
    );
  }

  if (phase === 'default') {
    // Top level: temperature default 0.1, reasoningEffort untouched.
    const top = await createAgent();
    const plain = await requestConfig(top, { ...seed });
    checks.topTempDefault = plain.temperature === 0.1;
    checks.topNoEffortInjected = !('reasoningEffort' in plain);
    const warm = await requestConfig(top, { ...seed, temperature: 0.3 });
    checks.topTempPreserved = warm.temperature === 0.3;

    // Role child (live shape): dshRoleId + subagentDepth.
    const fixer = await createAgent({ dshRoleId: 'fixer', subagentDepth: 1 });
    const asFixer = await requestConfig(fixer, { ...seed });
    checks.fixerEffortApplied = expectedFixer !== undefined && asFixer.reasoningEffort === expectedFixer.effort;
    checks.fixerTempApplied = expectedFixer !== undefined && asFixer.temperature === expectedFixer.temperature;
    // Idempotence: seed already at role effort is not double-mutated.
    if (expectedFixer !== undefined) {
      const idem = await requestConfig(fixer, { ...seed, reasoningEffort: expectedFixer.effort });
      checks.effortIdempotent = idem.reasoningEffort === expectedFixer.effort;
    } else checks.effortIdempotent = 'skipped (no fixer config)';

    // Resumed child (best-effort): no subagentDepth; delegationDepth header +
    // descriptor persona marker drive roleFromPayload.
    const resumed = await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd(), parentSession: 'session-omds-probe-parent', delegationDepth: 1, origin: 'subagent' },
      agentOptions: { provider: seed.provider, model: seed.model },
      setup: async (agentCtx) => {
        installModelSelection(agentCtx, { current: selection, assembled: void 0 });
        await presets.mount(agentCtx);
        try {
          agentCtx.agent.session.append('subagent/descriptor', { persona: 'oh-my-dsh-slim-role:fixer' });
        } catch (error) {
          facts.descriptorAppendFailed = error instanceof Error ? error.message : String(error);
        }
      },
    });
    facts.resumedHeaderDepth = resumed.agent.session?.header?.delegationDepth;
    if (facts.resumedHeaderDepth > 0 && facts.descriptorAppendFailed === undefined) {
      const asResumed = await requestConfig(resumed, { ...seed });
      checks.resumedEffortApplied = expectedFixer !== undefined && asResumed.reasoningEffort === expectedFixer.effort;
    } else {
      checks.resumedEffortApplied = 'skipped (header/marker unavailable in probe context)';
    }
  } else if (phase === 'none') {
    const userHome = mkdtempSync(join(tmpdir(), 'omds-effort-none-'));
    const userPath = join(userHome, 'oh-my-dsh-slim.json');
    writeFileSync(userPath, JSON.stringify({
      preset: 'probe-none',
      presets: { 'probe-none': { fixer: { effort: 'none' } } },
    }));
    process.env.OH_MY_DSH_SLIM_CONFIG = userPath;
    let cfg;
    try {
      const { loadConfig } = await import(pathToFileURL(join(presetDir, 'config-loader.js')).href);
      cfg = loadConfig(undefined)?.roles?.fixer;
    } catch (error) {
      facts.configLoaderError = error instanceof Error ? error.message : String(error);
    }
    facts.fixerConfigNone = cfg;
    const fixer = await createAgent({ dshRoleId: 'fixer', subagentDepth: 1 });
    const asFixer = await requestConfig(fixer, { ...seed });
    checks.noneNoEffortInjected = !('reasoningEffort' in asFixer) || asFixer.reasoningEffort === undefined;
    checks.noneEffortConfigRead = cfg?.effort === 'none';
  } else {
    checks.phaseUnknown = `unknown phase ${phase}`;
  }

  process.stdout.write(`${JSON.stringify({ facts, checks }, null, 2)}\n`);
  const pass = phase === 'default'
    ? checks.topTempDefault === true && checks.topNoEffortInjected === true
      && checks.topTempPreserved === true && checks.fixerEffortApplied === true
      && checks.fixerTempApplied === true && checks.effortIdempotent === true
    : phase === 'none'
      ? checks.noneEffortConfigRead === true && checks.noneNoEffortInjected === true
      : false;
  process.stdout.write(`PROBE_VERDICT: ${pass ? 'PASS' : 'FAIL'}\n`);
  return pass ? 0 : 1;
}

// probe-sandbox-parity — zero-cost host-parity probe for sandbox-strip.js.
// Replaces the stock headless runner; NEVER sends a model request. On a REAL
// host + REAL preset composition it pins the runtime facts the plugin depends
// on, so host upgrades that silently break the plugin surface as FAILs:
//   1. the host sandbox policy service is mounted and resolves a mode for the
//      probe agent's session (plugin's fail-safe is: unknown mode -> no strip);
//   2. @deepseek-ai/dsh-sandbox still exports WIDER_MODES and the table covers
//      the resolved mode with the workspace-write -> danger-full-access edge
//      (plugin's fail-safe is: unknown table -> no strip, silently);
//   3. the INSTALLED plugin copy still resolves that same dsh-sandbox package
//      (the plugin's runtime loadWiderModes() is unexported; its resolution is
//      mirrored and the installed source is asserted to use that import);
//   4. escalationArgsAreDoomed (real code from the installed copy, real table,
//      real mode) classifies the four shapes: empty justification doomed,
//      missing justification doomed, non-widening doomed, legitimate widening
//      + non-empty justification NOT doomed;
//   5. FACT (informational, not a verdict failure): whether the real bash tool
//      definition still exposes sandbox_permissions/justification — if a host
//      upgrade removes them the plugin becomes dead code and this probe's
//      precondition flips to "gone" so the change is noticed.
// Verdict: one JSON document on stdout, PROBE_VERDICT line, exit code.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync, readFileSync } from 'node:fs';
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
  if (!root) throw new Error('probe-sandbox-parity: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return root;
}

export const name = 'probe-sandbox-parity';
export const inject = ['agents', 'agentDefaultModel'];

export function apply(ctx) {
  const exit = ctx.get('appExit');
  if (exit === void 0) throw new Error('probe-sandbox-parity: the launcher must provide ctx.appExit');
  run(ctx).then(
    (code) => exit(code),
    (error) => {
      process.stderr.write(`probe-sandbox-parity failed: ${error?.stack ?? String(error)}\n`);
      exit(1);
    },
  );
}

async function run(ctx) {
  const hostRoot = resolveHostRoot();
  const requireHost = createRequire(join(hostRoot, '@deepseek-ai/dsh/package.json'));
  const { SessionId } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-session')).href);
  await ctx.get('loader')?.await();

  const agents = ctx.get('agents');
  const defaultModel = ctx.get('agentDefaultModel');
  const presets = ctx.get('agentPresets');
  if (agents === void 0 || defaultModel === void 0 || presets === void 0) {
    process.stderr.write('probe-sandbox-parity: agents/agentDefaultModel/agentPresets all required\n');
    return 1;
  }
  const presetDir = join(process.env.DSH_HOME, '.agent-presets', 'oh-my-dsh-slim');
  const checks = {};
  const facts = { presetDirPresent: existsSync(presetDir) };

  let sandboxPkg;
  try {
    sandboxPkg = requireHost.resolve('@deepseek-ai/dsh-sandbox');
  } catch {
    sandboxPkg = void 0;
  }
  facts.dshSandboxResolvable = sandboxPkg !== void 0;
  let widerModes;
  if (sandboxPkg !== void 0) {
    const mod = await import(pathToFileURL(sandboxPkg).href).catch((error) => ({ error: String(error) }));
    if (!('error' in mod)) widerModes = mod.WIDER_MODES;
  }
  facts.widerModes = widerModes;
  checks.hostTableLoaded = typeof widerModes === 'object' && widerModes !== null;

  let installedResolvesSame = false;
  if (facts.presetDirPresent) {
    const src = readFileSync(join(presetDir, 'sandbox-strip.js'), 'utf8');
    installedResolvesSame = src.includes("require.resolve('@deepseek-ai/dsh-sandbox')")
      && src.includes('WIDER_MODES') && sandboxPkg !== void 0;
  }
  checks.installedPluginResolvesSamePackage = installedResolvesSame;

  let selection;
  try {
    selection = defaultModel.currentSelection();
  } catch {
    selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' };
  }

  const captured = {};
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection?.provider, model: selection?.model },
    setup: async (agentCtx) => {
      await presets.mount(agentCtx);
      const policy = agentCtx.get('sandboxPolicy');
      const session = agentCtx.agent?.session;
      const bashDef = agentCtx.tools?.get?.('bash');
      captured.policyMounted = policy !== void 0 && typeof policy?.resolve === 'function';
      captured.mode = policy?.resolve?.({ session })?.mode;
      captured.bashSchemaExposesFields = bashDef !== void 0
        && JSON.stringify(bashDef).includes('sandbox_permissions');
    },
  });
  void agent;

  const mode = captured.mode;
  facts.mode = mode;
  facts.bashSchemaExposesFields = captured.bashSchemaExposesFields === true;
  checks.policyMountedAndModeResolved = captured.policyMounted === true && typeof mode === 'string';
  checks.modeCoveredByTable = checks.hostTableLoaded && Array.isArray(widerModes?.[mode]);
  checks.wideningEdge = checks.hostTableLoaded
    && Array.isArray(widerModes?.['workspace-write'])
    && widerModes['workspace-write'].includes('danger-full-access');

  let helper;
  if (facts.presetDirPresent) {
    helper = await import(pathToFileURL(join(presetDir, 'sandbox-strip.js')).href)
      .catch((error) => ({ error: String(error) }));
  }
  checks.pluginModuleLoaded = helper !== void 0 && !('error' in helper)
    && typeof helper.escalationArgsAreDoomed === 'function';
  const WM = widerModes ?? {};
  if (checks.pluginModuleLoaded && typeof mode === 'string' && Array.isArray(WM[mode])) {
    const doomed = helper.escalationArgsAreDoomed;
    checks.emptyJustificationDoomed = doomed('danger-full-access', '', mode, WM) === true;
    checks.missingJustificationDoomed = doomed('danger-full-access', void 0, mode, WM) === true;
    checks.nonWideningDoomed = doomed('workspace-write', 'reason', mode, WM) === true;
    checks.legitKept = doomed('danger-full-access', 'legitimate reason', mode, WM) === false;
  } else {
    for (const k of ['emptyJustificationDoomed', 'missingJustificationDoomed', 'nonWideningDoomed', 'legitKept']) {
      checks[k] = 'skipped (table/mode/plugin unavailable)';
    }
  }

  process.stdout.write(`${JSON.stringify({ facts, checks }, null, 2)}\n`);
  const pass = checks.policyMountedAndModeResolved === true
    && checks.hostTableLoaded === true
    && checks.modeCoveredByTable === true
    && checks.wideningEdge === true
    && checks.installedPluginResolvesSamePackage === true
    && checks.pluginModuleLoaded === true
    && checks.emptyJustificationDoomed === true
    && checks.missingJustificationDoomed === true
    && checks.nonWideningDoomed === true
    && checks.legitKept === true;
  process.stdout.write(`PROBE_VERDICT: ${pass ? 'PASS' : 'FAIL'}\n`);
  return pass ? 0 : 1;
}

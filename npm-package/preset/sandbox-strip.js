// sandbox-strip.js — strip host-managed escalation fields from delegated
// child tool calls, and strip DOOMED escalation shapes from top-level calls.
//
// DSH fixes a delegated child's file policy and approval state at startup
// (approval/policy source: "delegation"), but the bash/edit/write tool
// schemas still expose `sandbox_permissions` / `justification` as optional
// fields. Some models fill those fields unprompted; a child cannot escalate
// anyway, so the extra arguments only trigger parameter-validation errors
// ("invalid justification", "not strictly wider") and burn turns.
//
// Child handling (role-subagent-spawned, `agent.options.dshRoleId`): remove
// BOTH fields at the `tools/pre-execute` waterfall and append a correction
// note to the tool result (diagnosable, not hidden).
//
// Top-level handling (this preset's own sessions — the plugin only exists in
// the preset composition, so non-preset sessions never reach it): remove only
// the shapes DSH would ALWAYS reject before any approval prompt:
//   - empty justification,
//   - `sandbox_permissions` without `justification` or vice versa,
//   - a mode that is not strictly wider than the call's effective mode
//     (checked with the same WIDER_MODES table the sandbox service uses).
// A legitimate escalation (strictly wider mode + non-empty justification)
// is left untouched and still prompts for approval. If the effective mode
// cannot be resolved, nothing is stripped (fail-safe: not stripping is safer
// than stripping a legitimate request).

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
    const packageDir = dirname(dirname(dshBin));
    roots.push(dirname(dirname(packageDir)));
  } catch {}
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const root = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!root) throw new Error('sandbox-strip: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return join(root, '@deepseek-ai/dsh/package.json');
}

const require = createRequire(resolveDshPackage());

export const name = 'sandbox-strip';
export const inject = ['sandboxPolicy'];

export const STRIP_NOTE = '[sandbox: stripped sandbox_permissions/justification from this call - delegated child permission scope is fixed]';
export const TOP_STRIP_NOTE = '[sandbox: stripped invalid escalation arguments (empty justification or non-widening sandbox_permissions); a legitimate escalation request (strictly wider mode + non-empty justification) still prompts for approval]';

// dsh-sandbox is ESM; load once and cache (same pattern as web-fetch-gate).
let widerModesPromise = undefined;
async function loadWiderModes() {
  widerModesPromise ??= import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sandbox')).href)
    .then((mod) => mod.WIDER_MODES)
    .catch(() => undefined);
  return widerModesPromise;
}

/** Whether a call belongs to a role-subagent-spawned delegated child. */
export function isDelegatedChild(agent) {
  return agent !== void 0 && agent !== null && typeof agent === 'object'
    && agent.options !== void 0 && agent.options !== null
    && typeof agent.options === 'object'
    && typeof agent.options.dshRoleId === 'string';
}

/** Copy of args without the escalation fields; same reference when absent. */
export function stripEscalationArgs(args) {
  if (typeof args !== 'object' || args === null) return args;
  if (!('sandbox_permissions' in args) && !('justification' in args)) return args;
  const { sandbox_permissions, justification, ...rest } = args;
  return rest;
}

/**
* Whether the escalation shape would ALWAYS be rejected before any approval
* prompt, given the effective sandbox mode and the host's widening table
* (WIDER_MODES). Purely deterministic; mirrors validateEscalationArgs plus
* the "not strictly wider" check.
*/
export function escalationArgsAreDoomed(sandboxPermissions, justification, effectiveMode, widerModes) {
  if (sandboxPermissions === void 0 && justification === void 0) return false;
  if (justification !== void 0 && justification.trim().length === 0) return true;
  if (sandboxPermissions === void 0 || justification === void 0) return true;
  const wider = widerModes[effectiveMode] ?? [];
  if (!wider.includes(sandboxPermissions)) return true;
  return false;
}

/** Marker per stripped execution, consumed by the post-execute note. */
const STRIPPED = new WeakMap();

export function apply(ctx) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    const args = exec.arguments;
    if (typeof args !== 'object' || args === null) return next();
    if (isDelegatedChild(exec?.agent)) {
      const stripped = stripEscalationArgs(args);
      if (stripped !== args) {
        exec.arguments = stripped;
        STRIPPED.set(exec, STRIP_NOTE);
      }
      return next();
    }
    // Top level: strip only doomed shapes; leave legitimate escalations alone.
    if (!('sandbox_permissions' in args) && !('justification' in args)) return next();
    const widerModes = await loadWiderModes();
    if (widerModes === void 0) return next(); // fail-safe: unknown table -> untouched
    const policy = ctx.get('sandboxPolicy');
    const mode = policy?.resolve?.({ session: exec.agent?.session })?.mode;
    if (mode === void 0) return next(); // fail-safe: unknown mode -> untouched
    if (!escalationArgsAreDoomed(args.sandbox_permissions, args.justification, mode, widerModes)) return next();
    const stripped = stripEscalationArgs(args);
    exec.arguments = stripped;
    STRIPPED.set(exec, TOP_STRIP_NOTE);
    return next();
  });
  ctx.on('tools/post-execute', (exec, result, next) => {
    if (!STRIPPED.has(exec)) return next();
    const note = STRIPPED.get(exec);
    STRIPPED.delete(exec);
    if (result.isError || !Array.isArray(result.content)) return next();
    // Waterfall decision: return it directly (next() drops arguments in the
    // cordis waterfall), replacing the result content with the note appended.
    return {
      kind: 'accept',
      content: [...result.content, { type: 'text', text: `\n${note}` }],
    };
  });
}

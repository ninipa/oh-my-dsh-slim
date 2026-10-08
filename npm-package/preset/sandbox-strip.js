// sandbox-strip.js — strip host-managed escalation fields from delegated
// child tool calls, and strip DOOMED escalation shapes from top-level calls.
//
// DSH fixes a delegated child's file policy and approval state at startup
// (captureDelegatedPolicyOverrides pins approval to "never"), but the
// bash/edit/write tool schemas still expose `sandbox_permissions` /
// `justification` as optional fields. Some models fill those fields
// unprompted; a child cannot escalate anyway, so the extra arguments only
// trigger parameter-validation errors ("invalid justification", "not strictly
// wider") and burn turns.
//
// Child handling (a delegated session — `header.origin === 'subagent'` or a
// non-zero `delegationDepth`; DSH 0.2.0 dropped the 0.1.x
// `agent.options.dshRoleId` field this plugin used to key on): remove BOTH
// fields at the `tools/pre-execute` waterfall and append a correction note to
// the tool result (diagnosable, not hidden).
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

import { hostImport } from './bridge.js';

export const name = 'sandbox-strip';
// `loader` reaches the host's own @deepseek-ai/dsh-sandbox module instance, so
// the WIDER_MODES table compared against is the live one, not a copy.
export const inject = ['sandboxPolicy', 'loader'];

export const STRIP_NOTE = '[sandbox: stripped sandbox_permissions/justification from this call - delegated child permission scope is fixed]';
export const TOP_STRIP_NOTE = '[sandbox: stripped invalid escalation arguments (empty justification or non-widening sandbox_permissions); a legitimate escalation request (strictly wider mode + non-empty justification) still prompts for approval]';

/** Cached host WIDER_MODES; undefined until (or unless) it resolves. */
let widerModesPromise;

function loadWiderModes(ctx) {
  widerModesPromise ??= hostImport(ctx, '@deepseek-ai/dsh-sandbox')
    .then((mod) => mod.WIDER_MODES)
    .catch((error) => {
      ctx.logger?.warn?.('sandbox-strip: cannot load WIDER_MODES from the host sandbox; escalation stripping disabled: ' + String(error));
      return undefined;
    });
  return widerModesPromise;
}

/**
 * Whether a call belongs to a delegated child session. Keyed on the session
 * header DSH stamps at child creation, not on any plugin-private option field.
 */
export function isDelegatedChild(agent) {
  if (agent === void 0 || agent === null || typeof agent !== 'object') return false;
  const header = agent.session?.header;
  if (header !== void 0 && header !== null) {
    if (header.origin === 'subagent') return true;
    if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return true;
  }
  const options = agent.options;
  if (options !== void 0 && options !== null && typeof options === 'object') {
    if (typeof options.dshRoleId === 'string') return true;
    if (typeof options.subagentDepth === 'number' && options.subagentDepth > 0) return true;
  }
  return false;
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
    const widerModes = await loadWiderModes(ctx);
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
      content: [...result.content, { type: 'text', text: '\n' + note }],
    };
  });
}

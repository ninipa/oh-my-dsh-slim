// sandbox-strip.js — strip host-managed escalation fields from delegated
// child tool calls.
//
// DSH fixes a delegated child's file policy and approval state at startup
// (approval/policy source: "delegation"), but the bash/edit/write tool
// schemas still expose `sandbox_permissions` / `justification` as optional
// fields. Some models fill those fields unprompted; a child cannot escalate
// anyway, so the extra arguments only trigger parameter-validation errors
// ("invalid justification", "not strictly wider") and burn turns.
//
// This plugin removes the two fields from child tool calls at the
// `tools/pre-execute` waterfall — before the tool body validates them — and
// appends a correction note to the tool result so the model sees the strip
// (diagnosable, not hidden). Top-level sessions are untouched: they may
// legitimately request escalation when their approval policy allows it.
//
// Scope guard: only agents spawned by this preset's role-subagent rows,
// identified by the stable `dshRoleId` agent option. If a future DSH version
// lets delegated children request escalation, this guard must be revisited
// (fail-safe direction: not stripping is safer than stripping a legitimate
// request).

export const name = 'sandbox-strip';

export const STRIP_NOTE = '[sandbox: stripped sandbox_permissions/justification from this call - delegated child permission scope is fixed]';

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

/** Marker per stripped execution, consumed by the post-execute note. */
const STRIPPED = new WeakMap();

export function apply(ctx) {
  ctx.on('tools/pre-execute', (exec, next) => {
    if (!isDelegatedChild(exec?.agent)) return next();
    const stripped = stripEscalationArgs(exec.arguments);
    if (stripped !== exec.arguments) {
      exec.arguments = stripped;
      STRIPPED.set(exec, true);
    }
    return next();
  });
  ctx.on('tools/post-execute', (exec, result, next) => {
    if (!STRIPPED.has(exec)) return next();
    STRIPPED.delete(exec);
    if (result.isError || !Array.isArray(result.content)) return next();
    // Waterfall decision: return it directly (next() drops arguments in the
    // cordis waterfall), replacing the result content with the note appended.
    return {
      kind: 'accept',
      content: [...result.content, { type: 'text', text: `\n${STRIP_NOTE}` }],
    };
  });
}

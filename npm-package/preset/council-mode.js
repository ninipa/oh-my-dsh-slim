// council-mode.js — the dynamic "Council Mode" system-prompt section.
//
// The seats and the synthesizer are ordinary role tools; what turns them into
// a council is this section, injected only for the top-level agent when the
// council is actually usable (>= 2 seats configured AND their tools mounted AND
// the synthesizer tool mounted). A child session never sees it, and a 0- or
// 1-seat configuration advertises nothing.
//
// The text adapts omo-s 2.2.18's orchestrator Council Mode block to DSH:
// natural-language trigger instead of `@council`, role tools + same-message
// parallel dispatch instead of `task()`, settlement notices instead of an
// implicit wait. It deliberately contains no `{{variable}}` so no host line has
// to interpolate it.

import { loadConfig, bindProfileContext, councilSeats, MIN_COUNCIL_SEATS } from './config.js';
import { ROLE_TABLE, isSubagent } from './roles.js';

export const name = 'omds-council-mode';
export const inject = ['systemPrompt', 'tools'];

/** The synthesizer tool every council dispatch targets. */
export const COUNCIL_TOOL_NAME = 'subagent_council';

/**
 * The dynamic section text for a set of usable seats.
 * @param seats - role ids of the seats whose tools are actually mounted.
 */
export function councilModeText(seats) {
  const list = seats.map((roleId) => {
    const row = ROLE_TABLE[roleId];
    return row.seatName + ' (' + row.toolName + ')';
  }).join(', ');
  return `## Council Mode
Enabled council seats: ${list}
The council has a synthesis-only agent: ${COUNCIL_TOOL_NAME}

Use this procedure ONLY when the user explicitly asks for a council, a multi-model review, or multiple independent opinions (e.g. "用 council", "议会", "多模型评审", "让几个模型分别看"). Do not use it for ordinary questions, single-fact lookups, or when the user says not to use it. When the user names specific seats, dispatch only those.

Procedure:
1. For codebase questions, let the councillors read the code themselves. Do not dispatch separate exploration lanes first unless the material is external (PR, URL, issue, external docs) or otherwise unavailable to the seats; in that case fetch and summarize it yourself and put it in their prompts. Councillors are read-only over the codebase and have no network access.
2. Dispatch the same complete question and context to every selected councillor in ONE assistant message, in parallel. Do not split the dispatches across steps. Give each a self-contained prompt; optionally add seat-specific focus.
3. Wait until every councillor has settled. Do not call ${COUNCIL_TOOL_NAME} before that. If a seat fails or returns no closing message, retry that seat once with the same prompt; if it still fails, carry its failure status into the synthesis.
4. Call ${COUNCIL_TOOL_NAME} with the original question, the expected seat list, and every seat's raw closing message (or failure status), labeled by seat name. Do not paraphrase or filter the replies.
5. Present the council report from ${COUNCIL_TOOL_NAME} as the final answer, verbatim: keep the Council Response / Per-Councillor Details / Council Summary sections and the consensus level intact; do not summarize, reorder, or drop the per-councillor details. Use seat names; optionally add one line mapping seats to models.

If fewer than two seats return usable answers, present the result as a single view, not a consensus.`;
}

/**
 * The seats whose tools are visible in one assembly context, in roster order.
 * A configured seat whose tool failed to mount is not advertised.
 */
function visibleSeats(ctx, context, seats) {
  return seats.filter((roleId) => {
    const row = ROLE_TABLE[roleId];
    if (row === undefined) return false;
    try {
      return ctx.tools.get(row.toolName, context.scope) !== undefined;
    } catch {
      return false;
    }
  });
}

/** Cordis entry point: one section registration per preset composition. */
export async function apply(ctx, config = {}) {
  bindProfileContext(ctx, config.profileId);
  // One line per reason: a council that is configured active but unusable must
  // be visible in the host log, not look identical to "not enabled".
  const warned = new Set();
  const warnOnce = (key, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    ctx.logger?.warn?.('oh-my-dsh-slim: ' + message);
  };
  ctx.systemPrompt.section({
    name: 'council-mode',
    order: 116.46,
    // The text is assembled from role ids only and carries no variables; keep
    // it literal so a host-side interpolation change can never abort a turn.
    interpolate: false,
    text: (context) => {
      // The section lives in the shared composition; only the top-level agent
      // is told to orchestrate a council.
      if (context?.agent === undefined || isSubagent(context.agent)) return '';
      let config;
      try {
        config = loadConfig(ctx);
      } catch {
        warnOnce('config', 'the council configuration is invalid; the Council Mode section is hidden (see the role-row error above)');
        return '';
      }
      const configured = councilSeats(config.roles);
      if (configured.length < MIN_COUNCIL_SEATS) return '';
      const seats = visibleSeats(ctx, context, configured);
      if (seats.length < MIN_COUNCIL_SEATS) {
        warnOnce('seats', 'council is configured active but only ' + String(seats.length) + ' of ' + String(configured.length) + ' seat tools are mounted; the Council Mode section is hidden');
        return '';
      }
      if (ctx.tools.get(COUNCIL_TOOL_NAME, context.scope) === undefined) {
        warnOnce('synth', 'council is configured active but the synthesizer tool is not mounted; the Council Mode section is hidden');
        return '';
      }
      return councilModeText(seats);
    },
  });
}

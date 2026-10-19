// role-composition.js — apply a role's persona and tool surface to its child.
//
// DSH 0.2.1 removed `persona`/`toolFilter` from the subagent tool config and
// rejected both outright: a child's composition is a preset now, and the tool
// may only name one. This module replays the two calls the host itself used to
// make for us (0.2.0 `applyChildComposition`, 0.2.1 `applyChildOverrides`), on
// the child's own scope, at `agent/created`:
//
//   agent.ctx.systemPrompt.section({ name: 'deployment:persona-prefix',
//                                     order: getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') })
//   agent.ctx.tools.restrict(filter)
//
// Identity comes from `subagent/descriptor.label` (written inside the host's
// setup(), before `agent/created`). The role tool wrapper prefixes the label
// with "<roleId> · ", so the same read works for a live child and for a cold
// resume after a restart. A 0.6.3-created child carries the persona marker
// instead; roleIdFromEvents() keeps that as a fallback.
//
// Failure policy (review G2): a missing/duplicate persona section is cosmetic
// and fails open; a failed `restrict` is a permission boundary and fails
// closed — the host's creation announcement rejects, so the delegation fails
// instead of leaving an unconstrained oracle/explorer running.

import { hostImport } from './bridge.js';
import { loadConfig, bindProfileContext } from './config.js';
import { ROLE_PERSONAS } from './preset.js';
import {
  ROLE_TABLE, composeRolePersona, effectiveRoleFilter, fitFilterToKnown, isSubagent, roleIdForAgent,
} from './roles.js';

export const name = 'omds-role-composition';
export const inject = ['loader'];

/** Roles whose composition has already been installed on this exact agent. */
const applied = new WeakSet();

/**
 * The section/tool-filter a role's child should receive, derived from the same
 * user configuration `resolveRole()` uses. Kept as a thin wrapper around
 * `effectiveRoleFilter` so both paths can never disagree on the boundary.
 * @param roleId - the role id whose child is being composed.
 * @param roleConfig - one role entry from the merged configuration.
 * @param definition - the row's `definition` block, when available.
 * @returns a tool filter, or undefined when the role is unrestricted.
 */
export function roleFilter(roleId, roleConfig = {}, definition = {}) {
  return effectiveRoleFilter(roleId, roleConfig, definition);
}

/**
 * Install a role composition on one child. Exported for the smoke harness.
 * @param agent - the child agent (a non-subagent is ignored).
 * @param ctx - a context in the preset composition (for configuration/logging).
 * @param scopeOf - the host's scope helper.
 * @returns 'ok', 'skipped', or throws when `restrict` is unavailable/fails.
 */
export async function composeChild(agent, ctx, scopeOf) {
  if (!isSubagent(agent) || applied.has(agent)) return 'skipped';
  const roleId = roleIdForAgent(agent);
  if (roleId === undefined || ROLE_TABLE[roleId] === undefined) return 'skipped';
  const preset = loadConfig(ctx);
  const roleConfig = preset.roles[roleId] ?? {};
  // `enabled` gates whether the delegation TOOL is mounted, not what an
  // already-mounted tool may create. A session that still holds a tool from an
  // older generation (the user disabled the role mid-session) must not produce
  // an unconstrained child: skipping here was a fail-open permission hole.
  applied.add(agent);

  const section = composeRolePersona(roleId, ROLE_PERSONAS[roleId], roleConfig.personaAppend, undefined);
  try {
    agent.ctx.systemPrompt.section({
      name: 'deployment:persona-prefix',
      order: agent.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      // The composed persona is literal text (user personaAppend included);
      // interpolating it would make an unknown {{var}} abort the child turn on
      // a strict-interpolation host.
      interpolate: false,
      text: section,
    });
  } catch (error) {
    // Cosmetic: the child keeps the inherited prompt but stays functional.
    ctx.logger?.warn?.('oh-my-dsh-slim: role "%s": persona section failed: %s', roleId, String(error?.message ?? error));
  }

  const filter = roleFilter(roleId, roleConfig);
  if (filter === undefined) return 'ok';
  const tools = agent.ctx.get?.('tools') ?? agent.ctx.tools;
  const known = tools?.view?.(scopeOf(agent.ctx))?.restrictableNames;
  // No catch: this is the role's permission boundary. A host that cannot
  // enforce it must fail the delegation, not run the child unconstrained.
  tools.restrict(fitFilterToKnown(filter, known));
  return 'ok';
}

/** Cordis entry point: one listener per preset composition. */
export async function apply(ctx, config = {}) {
  bindProfileContext(ctx, config.profileId);
  const scope = await hostImport(ctx, '@deepseek-ai/dsh-scope');
  // Return the promise: the host announces `agent/created` through a serial
  // dispatch, and a rejected restrict must reject that announcement so the
  // delegation fails (fail closed). Only the persona section fails open, and
  // that catch lives inside composeChild().
  ctx.effect(() => ctx.on('agent/created', ({ agent }) => composeChild(agent, ctx, scope.scopeOf)),
    'oh-my-dsh-slim: role composition');
}

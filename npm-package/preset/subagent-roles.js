// preset/subagent-roles.js — per-role model parameters for delegated children.
//
// DSH 0.2.0 dropped the 0.1.x mechanism this preset used to steer a role's
// request (an agent option field carried through the delegation request). What
// survives is the persona the child session persists in its
// `subagent/descriptor` event, which is written BEFORE the first
// `agent/request` of that child — so the waterfall can still tell which role
// is asking and rewrite the resolved route.
//
// This row is the 0.2.0 successor of the 0.1.x `effort-by-role.js`: one
// standing listener for all six roles, reading the same configuration file, so
// role temperature and reasoning effort keep working without a per-role tool
// fork. Invalid configuration fails visibly, matching the upstream loader;
// an unidentified child receives the upstream high/0.1 fallback.

import { loadConfig, bindProfileContext, ROLE_IDS } from './config.js';
import { isSubagent, roleIdForAgent } from './roles.js';
import { hostImport } from './bridge.js';

/** Cordis plugin name. */
export const name = 'omds-subagent-roles';
/** `llm` is optional on purpose: without it the row still applies temperature
 * and keeps each role's configured effort, it just cannot verify the effort
 * against the model's declared list before the host does. */
export const inject = ['llm', 'loader'];

/** The orchestrator's own temperature, applied when the host resolved none. */
const ORCHESTRATOR_TEMPERATURE = 0.1;


/** Effective role facts per (role, provider, model, effort) — model metadata is
 * stable for the life of a registration, and a verdict that could not be
 * determined is deliberately not cached. */
const effortCache = new Map();

function text(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * The configured facts for one role, or undefined for the orchestrator or an
 * unknown role.
 * @param agent - a live agent from the agent/request payload.
 */
function roleFacts(ctx, agent) {
  const roleId = roleIdForAgent(agent);
  if (!ROLE_IDS.includes(roleId)) return undefined;
  const config = loadConfig(ctx);
  return { roleId, configured: config.roles[roleId], source: config.source };
}

/**
 * Validate one effort against the model's declared reasoning efforts.
 *
 * The host rejects an undeclared effort at dispatch time with
 * `provider "..." model "..." does not support reasoning effort "..."`; failing
 * here instead names the role and the fix, and keeps the misconfiguration out
 * of the child's first request.
 * @throws when the model declares its efforts and the configured one is absent.
 */
async function verifyEffort(ctx, provider, model, effort, source) {
  if (!text(provider) || !text(model)) return;
  let llm;
  try { llm = ctx.get('llm'); } catch { return; }
  if (llm === undefined || typeof llm.resolveModelInfo !== 'function') return;
  const key = provider + '|' + model + '|' + effort;
  const cached = effortCache.get(key);
  if (cached !== undefined) return;
  let info;
  try {
    info = await llm.resolveModelInfo(provider, model, undefined);
  } catch (error) {
    // Upstream metadata lookup fails open; dispatch owns provider failures.
    return;
  }
  const declared = info?.reasoning;
  if (declared === undefined || !Array.isArray(declared.efforts) || declared.efforts.length === 0) return;
  const ids = declared.efforts.map((entry) => String(entry?.id));
  if (ids.includes(effort)) {
    effortCache.set(key, true);
    return;
  }
  const withDefault = text(declared.defaultEffort) ? [...ids, 'default: ' + declared.defaultEffort] : ids;
  throw new Error(
    'oh-my-dsh-slim: reasoning effort "' + effort + '" is not offered by "' + provider + '/' + model + '".' +
    ' Declared efforts: ' + withDefault.join(', ') + '.' +
    " Fix the role's effort in the preset configuration (" +
    (text(source) ? source : 'the oh-my-dsh-slim configuration file') + ').',
  );
}

/**
 * The config patch this role's request needs. As upstream, role temperature
 * overrides inherited temperature, configured effort overrides inherited
 * effort, and `none` leaves the resolved effort untouched.
 * @returns the patch, or undefined when the request needs no change.
 */
async function requestPatch(ctx, payload, resolved) {
  const child = isSubagent(payload?.agent);
  if (!child) {
    if (resolved?.temperature === undefined) return { temperature: ORCHESTRATOR_TEMPERATURE };
    return undefined;
  }
  const facts = roleFacts(ctx, payload.agent);
  const configured = facts?.configured;
  const patch = {};
  if (configured === undefined) {
    if (resolved?.reasoningEffort === undefined) patch.reasoningEffort = 'high';
    if (resolved?.temperature === undefined) patch.temperature = 0.1;
    return Object.keys(patch).length === 0 ? undefined : patch;
  }
  // rc.2 supplies the effective route on the resolved request, replacing the
  // upstream options route. Validate only when actually injecting an effort.
  if (configured.effort !== undefined && configured.effort !== 'none' && configured.effort !== resolved?.reasoningEffort) {
    await verifyEffort(ctx, resolved?.provider, resolved?.model, configured.effort, facts?.source);
    patch.reasoningEffort = configured.effort;
  }
  if (configured.temperature !== undefined && configured.temperature !== resolved?.temperature) {
    patch.temperature = configured.temperature;
  }
  return Object.keys(patch).length === 0 ? undefined : patch;
}

/** Apply the row: one standing listener for every role in this preset. */
export function apply(ctx, config = {}) {
  bindProfileContext(ctx, config.profileId);
  const scopeModule = ctx.loader !== undefined ? hostImport(ctx, '@deepseek-ai/dsh-scope') : undefined;
  ctx.effect(() => ctx.on('agent/request', async (payload, next) => {
    if (scopeModule) {
      const scope = await scopeModule;
      const owner = scope.scopeOf(ctx);
      if (owner === undefined || !payload?.agent?.ctx || !scope.scopeChainOf(scope.scopeOf(payload.agent.ctx)).includes(owner)) return next();
    }
    const resolved = await next();
    const patch = await requestPatch(ctx, payload, resolved);
    return patch === undefined ? resolved : { ...resolved, ...patch };
  }, { global: true }), 'omds-subagent-roles: agent/request');
}

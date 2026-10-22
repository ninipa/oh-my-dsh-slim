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
//
// The route is also resolved per request: when the saved role model differs
// from the one the child inherited at mount, this listener reroutes the
// child's next request. That is what makes a card edit apply to an existing
// conversation instead of only to sessions created afterwards.

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

/** Effort fallbacks already reported, so a live model switch warns once per
 * (role, route, effort) instead of on every child request. */
const effortWarnings = new Set();

/** Unavailable-route warnings already reported, one per (role, route). */
const routeWarnings = new Set();

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

/** Resolve the route this request should use: the role's configured model when
 * present, otherwise whatever the host already resolved. */
function targetRoute(configured, resolved) {
  return {
    provider: text(configured?.provider) ? configured.provider : resolved?.provider,
    model: text(configured?.model) ? configured.model : resolved?.model,
  };
}

/** A route change is only meaningful when the host resolved both halves; a
 * fixture without them keeps the historical behaviour. */
function routeChanged(target, resolved) {
  if (!text(resolved?.provider) || !text(resolved?.model)) return false;
  return target.provider !== resolved.provider || target.model !== resolved.model;
}

/** Model metadata for the route a role is configured to use. Metadata lookup is
 * advisory (as upstream): a transient or unknown failure must not break a
 * request that could still run on the route the host already resolved, so the
 * failure is reported and the caller keeps the current route. */
async function resolveRoute(ctx, target, facts) {
  let llm;
  try { llm = ctx.get('llm'); } catch { return undefined; }
  if (llm === undefined || typeof llm.resolveModelInfo !== 'function') return undefined;
  try {
    return await llm.resolveModelInfo(target.provider, target.model, undefined);
  } catch (error) {
    const key = facts.roleId + '|' + target.provider + '|' + target.model;
    if (!routeWarnings.has(key)) {
      routeWarnings.add(key);
      ctx.logger?.warn?.(
        'oh-my-dsh-slim: role "' + facts.roleId + '" is configured for "' + target.provider + '/' + target.model +
        '", but its metadata is unavailable; keeping the current route.' +
        (text(error?.message) ? ' (' + error.message + ')' : ''),
      );
    }
    return undefined;
  }
}

/** The effort ids a model declares, or undefined when it declares none. */
function declaredEfforts(info) {
  const efforts = info?.reasoning?.efforts;
  if (!Array.isArray(efforts) || efforts.length === 0) return undefined;
  return efforts.map((entry) => String(entry?.id));
}

/**
 * The config this role's request needs. Role temperature overrides inherited
 * temperature, configured effort overrides inherited effort, and `none` leaves
 * the resolved effort untouched on an unchanged route (it is dropped when the
 * model is rerouted, because the effort belonged to the old model).
 *
 * The model is read from the live configuration on every request. A role whose
 * configured route differs from the one resolved at mount (because the user
 * changed the card after the session started) is rerouted here, so saving the
 * card takes effect on the current conversation instead of only the next one.
 * @returns the next config, or undefined when the request needs no change.
 */
async function requestConfig(ctx, payload, resolved) {
  const child = isSubagent(payload?.agent);
  if (!child) {
    if (resolved?.temperature === undefined) return { ...resolved, temperature: ORCHESTRATOR_TEMPERATURE };
    return undefined;
  }
  const facts = roleFacts(ctx, payload.agent);
  const configured = facts?.configured;
  if (configured === undefined) {
    const patch = {};
    if (resolved?.reasoningEffort === undefined) patch.reasoningEffort = 'high';
    if (resolved?.temperature === undefined) patch.temperature = 0.1;
    return Object.keys(patch).length === 0 ? undefined : { ...resolved, ...patch };
  }

  const target = targetRoute(configured, resolved);
  const changed = routeChanged(target, resolved);
  const info = changed ? await resolveRoute(ctx, target, facts) : undefined;
  // A route whose metadata cannot be read is not rerouted: metadata lookup is
  // advisory, and breaking a request that still has a working route is worse
  // than leaving the live configuration unapplied for this request.
  const reroute = changed && info !== undefined;
  const patch = {};
  let dropEffort = false;

  if (reroute) {
    patch.provider = target.provider;
    patch.model = target.model;

    const declared = declaredEfforts(info);
    const effort = configured.effort;
    if (effort !== undefined && effort !== 'none' && declared !== undefined && !declared.includes(effort)) {
      // The new route does not offer the old effort. Falling back to the model
      // default keeps the rescue switch valid instead of failing the request.
      dropEffort = true;
      const key = facts.roleId + '|' + target.provider + '|' + target.model + '|' + effort;
      if (!effortWarnings.has(key)) {
        effortWarnings.add(key);
        ctx.logger?.warn?.(
          'oh-my-dsh-slim: role "' + facts.roleId + '" effort "' + effort + '" is not offered by "' +
          target.provider + '/' + target.model + '"; using the model default. Declared: ' + declared.join(', ') + '.',
        );
      }
    } else if (effort !== undefined && effort !== 'none') {
      patch.reasoningEffort = effort;
    } else {
      // The inherited effort belonged to the old route; keeping it is what
      // breaks a switch to a model with a different effort vocabulary.
      dropEffort = true;
    }

    if (typeof info?.defaultMaxTokens === 'number' && typeof resolved?.maxTokens === 'number' && info.defaultMaxTokens < resolved.maxTokens) {
      patch.maxTokens = info.defaultMaxTokens;
    }
  } else if (configured.effort !== undefined && configured.effort !== 'none' && configured.effort !== resolved?.reasoningEffort) {
    // Same route (or metadata unavailable): keep the pre-existing strict check,
    // because an effort the configured model does not offer is a configuration
    // error, and a failed lookup is not evidence that the route is wrong.
    await verifyEffort(ctx, resolved?.provider, resolved?.model, configured.effort, facts?.source);
    patch.reasoningEffort = configured.effort;
  }

  if (configured.temperature !== undefined && configured.temperature !== resolved?.temperature) {
    patch.temperature = configured.temperature;
  }

  if (Object.keys(patch).length === 0 && !dropEffort) return undefined;
  const next = { ...resolved, ...patch };
  if (dropEffort) delete next.reasoningEffort;
  return next;
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
    const nextConfig = await requestConfig(ctx, payload, resolved);
    return nextConfig === undefined ? resolved : nextConfig;
  }, { global: true }), 'omds-subagent-roles: agent/request');
}

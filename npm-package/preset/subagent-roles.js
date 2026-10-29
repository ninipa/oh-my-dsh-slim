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
// An effort the mounted model does not offer is the one exception: it degrades
// (dropped, model default used) with a warning instead of failing the request.
// The settings card blocks such a value on save, so this path only serves
// configuration written outside the card — an older profile, a hand-edited
// document, or a model whose declaration changed. Failing there would turn an
// upgrade into "the subagent stopped working" with no way to run it.
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
 * Report a configured effort the target model does not offer, once per
 * (role, route, effort, fallback).
 *
 * This is a degradation, not a failure: the request runs on the session's own
 * effort when that model declares it, and on the model default otherwise,
 * instead of being rejected at dispatch. It fires for configuration the card
 * could not gate — an inherited route whose session model changed, an old
 * profile saved before the model-scoped dropdown existed, a hand-edited
 * document, or a model whose declaration changed — so the warning is the only
 * trace outside the settings card.
 */
function warnEffortFallback(ctx, facts, target, effort, declared, fallback) {
  const key = facts.roleId + '|' + target.provider + '|' + target.model + '|' + effort + '|' + (fallback ?? '');
  if (effortWarnings.has(key)) return;
  effortWarnings.add(key);
  ctx.logger?.warn?.(
    'oh-my-dsh-slim: role "' + facts.roleId + '" effort "' + effort + '" is not offered by "' +
    target.provider + '/' + target.model + '"; ' +
    (fallback === undefined
      ? 'using the model default.'
      : 'using the session effort "' + fallback + '".') +
    (declared.length > 0 ? ' Declared: ' + declared.join(', ') + '.' : ' The model declares no reasoning efforts.'),
  );
}

/**
 * The route the delegating session is running right now, or undefined.
 *
 * A child session persists its `parentSession` in the header, and the parent
 * agent keeps its latest request header — the same source the host reads when
 * it resolves a child at spawn (`parentAgentOptionsForDelegation`). Re-reading
 * it per request is what makes "follow the session model" survive a main-model
 * switch inside a running conversation: the child's spawn options keep the
 * route that was current when the role tool was mounted, which is exactly the
 * value this function replaces.
 */
function parentRoute(ctx, agent) {
  const parentId = agent?.session?.header?.parentSession;
  if (!text(parentId)) return undefined;
  let agents;
  try { agents = ctx.get('agents'); } catch { return undefined; }
  try {
    const parent = typeof agents?.get === 'function' ? agents.get(parentId) : undefined;
    const config = parent?.session?.requestHeader?.()?.config;
    if (!text(config?.provider) || !text(config?.model)) return undefined;
    return config;
  } catch {
    // A disposed or half-torn-down parent must not break the child's request:
    // falling back to the resolved route is the pre-existing behaviour.
    return undefined;
  }
}

/** Resolve the route this request should use: the role's configured provider
 * AND model when both are present, otherwise the delegating session's current
 * route, otherwise whatever the host already resolved.
 * Half a route (only one of the two) is treated as "no route" for the same
 * reason roles.js omits it: pairing one provider id with another provider's
 * model id would produce a target nobody asked for. Roles ship without a route
 * (issue #11), so following the session is the default path: the parent's live
 * header is what the child would have inherited had it been created now. */
function targetRoute(configured, resolved, parent) {
  if (text(configured?.provider) && text(configured?.model)) {
    return { provider: configured.provider, model: configured.model };
  }
  if (text(parent?.provider) && text(parent?.model)) {
    return { provider: parent.provider, model: parent.model };
  }
  return { provider: resolved?.provider, model: resolved?.model };
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
async function resolveRoute(ctx, target, facts, silent = false) {
  // A fixture without a resolved provider/model has nothing to look up; the
  // caller keeps the route it already has instead of issuing a dead request.
  if (!text(target?.provider) || !text(target?.model)) return undefined;
  let llm;
  try { llm = ctx.get('llm'); } catch { return undefined; }
  if (llm === undefined || typeof llm.resolveModelInfo !== 'function') return undefined;
  try {
    return await llm.resolveModelInfo(target.provider, target.model, undefined);
  } catch (error) {
    const key = facts.roleId + '|' + target.provider + '|' + target.model;
    if (!silent && !routeWarnings.has(key)) {
      routeWarnings.add(key);
      ctx.logger?.warn?.(
        'oh-my-dsh-slim: role "' + facts.roleId + '": metadata is unavailable; keeping the current route (' +
        target.provider + '/' + target.model + ').' +
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
 *
 * A role WITHOUT a route follows the delegating session, and that route is
 * re-read from the parent's live request header on every request as well. The
 * spawn options alone cannot express "follow": they carry the route that was
 * current when this role tool mounted, so a main-model switch inside a running
 * conversation would silently leave the child on the old model — the same
 * class of staleness the pinned-route reroute above already fixes.
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

  // A role without its own route follows the delegating session. The parent's
  // header is the route this child would inherit if it were created now; the
  // spawn options are only the mount-time snapshot of the same source.
  const following = !(text(configured.provider) && text(configured.model));
  // Read the session route for BOTH cases: a pinned role still needs it to
  // tell the session's output cap apart from a cap that belongs to this model.
  const parent = parentRoute(ctx, payload.agent);
  const target = targetRoute(configured, resolved, parent);
  const changed = routeChanged(target, resolved);
  // A pinned route that names a different model than the session must not
  // inherit the session's output cap: the host copies it unconditionally, and
  // the target model may have a smaller limit. A cap the role names explicitly
  // still wins; without one the target model's own default applies.
  const foreignCap = !following && parent !== undefined
    && (parent.provider !== target.provider || parent.model !== target.model)
    && typeof configured.maxTokens !== 'number';
  const effort = configured.effort;
  const effortRequested = text(effort) && effort !== 'none';
  // Metadata answers two questions: whether the saved route differs from the
  // one the host resolved (reroute), and whether the saved effort is one that
  // route offers. A failed lookup is advisory for both — it must not break a
  // request that can still run.
  const info = changed || effortRequested ? await resolveRoute(ctx, target, facts) : undefined;
  // A route whose metadata cannot be read is not rerouted: breaking a request
  // that still has a working route is worse than leaving the live
  // configuration unapplied for this request.
  const reroute = changed && info !== undefined;
  // The session values may only travel with the session route. When the target
  // lookup fails, the request stays on the route the host resolved, and copying
  // the parent's level or cap onto another model is exactly the kind of
  // mismatch this row exists to prevent.
  const onSessionRoute = parent !== undefined && (!changed || reroute);
  // An explicit cap on an already-mounted pinned route still has to respect the
  // model's declared default; the first request of a session never takes the
  // reroute branch, so it needs its own (silent, fail-open) lookup.
  const capInfo = !following && !changed && typeof configured.maxTokens === 'number' && info === undefined
    ? await resolveRoute(ctx, target, facts, true)
    : info;
  const patch = {};
  let dropEffort = false;
  let dropMaxTokens = foreignCap && resolved?.maxTokens !== undefined;

  if (reroute) {
    patch.provider = target.provider;
    patch.model = target.model;
    if (!foreignCap) {
      // A pinned role's own cap is authoritative; anything larger than the
      // target model's declared default is clamped.
      const modelCap = typeof capInfo?.defaultMaxTokens === 'number' ? capInfo.defaultMaxTokens : undefined;
      const roleCap = typeof configured.maxTokens === 'number' ? configured.maxTokens : undefined;
      const cap = roleCap === undefined
        ? (typeof resolved?.maxTokens === 'number' && modelCap !== undefined ? Math.min(resolved.maxTokens, modelCap) : undefined)
        : (modelCap === undefined ? roleCap : Math.min(roleCap, modelCap));
      if (cap !== undefined && cap !== resolved?.maxTokens) patch.maxTokens = cap;
    }
  } else if (!following && typeof configured.maxTokens === 'number') {
    // First request of a pinned role: the cap came from the role itself at
    // mount, so nothing would ever clamp it. Honour the model's declared
    // default here too (fail-open when the lookup is unavailable).
    const modelCap = typeof capInfo?.defaultMaxTokens === 'number' ? capInfo.defaultMaxTokens : undefined;
    if (modelCap !== undefined && configured.maxTokens > modelCap) patch.maxTokens = modelCap;
  }

  // The effort lands on the route the request will actually run on: the
  // rerouted target when the reroute is possible, otherwise the route the host
  // already resolved (a failed target lookup leaves the request where it was).
  // The second lookup is silent — the first one already reported the outage.
  const effortRoute = !effortRequested
    ? undefined
    : reroute || !changed
      ? target
      : { provider: resolved?.provider, model: resolved?.model };
  const effortInfo = effortRoute === undefined || effortRoute === target
    ? info
    : await resolveRoute(ctx, effortRoute, facts, true);

  if (effortRequested) {
    // `effortInfo === undefined` means the lookup failed: keep the saved level
    // and let the host judge it (fail-open, matching the reroute decision
    // above). Metadata without declared efforts means the model has no effort
    // control, so no explicit level is supported.
    const declared = declaredEfforts(effortInfo);
    const supported = effortInfo === undefined ? undefined : (declared ?? []).includes(effort);
    if (supported === false) {
      // The saved level belongs to a model this route replaced, or it was
      // written outside the card (an old profile, a hand-edited document, a
      // model whose declaration changed). Prefer the level the child inherited
      // from the session: on an inherited route that is the main model's own
      // effort, so "follow the model" lands on what the session actually runs
      // with instead of an arbitrary model default. A pinned route (where the
      // inherited value IS the unsupported saved level) or a level the session
      // model also cannot use falls back to the model default. Either way the
      // request stays runnable; the card remains the visible fix point.
      const inherited = resolved?.reasoningEffort;
      const fallback = text(inherited) && inherited !== effort && (declared ?? []).includes(inherited)
        ? inherited
        : undefined;
      if (fallback === undefined) dropEffort = true;
      warnEffortFallback(ctx, facts, effortRoute, effort, declared ?? [], fallback);
    } else if (effort !== resolved?.reasoningEffort) {
      patch.reasoningEffort = effort;
    }
  } else if (following && onSessionRoute) {
    // No role level: inherit the session's level verbatim. The parent header
    // is what the main model actually sends, so the value is supported by
    // construction — unlike the spawn snapshot, which can belong to a model
    // the session has since replaced.
    if (text(parent.reasoningEffort)) {
      if (parent.reasoningEffort !== resolved?.reasoningEffort) patch.reasoningEffort = parent.reasoningEffort;
    } else if (resolved?.reasoningEffort !== undefined) {
      dropEffort = true;
    }
  } else if (reroute) {
    // The inherited effort belonged to the old route; keeping it is what
    // breaks a switch to a model with a different effort vocabulary.
    dropEffort = true;
  }

  // The output cap follows the same rule: a followed session carries the
  // session's own cap (valid for the model that owns it), while a pinned route
  // keeps the role budget clamped to the target model above.
  if (following && onSessionRoute) {
    if (typeof parent.maxTokens === 'number') {
      if (parent.maxTokens !== resolved?.maxTokens) patch.maxTokens = parent.maxTokens;
    } else if (resolved?.maxTokens !== undefined) {
      dropMaxTokens = true;
    }
  }

  if (configured.temperature !== undefined && configured.temperature !== resolved?.temperature) {
    patch.temperature = configured.temperature;
  }

  if (Object.keys(patch).length === 0 && !dropEffort && !dropMaxTokens) return undefined;
  const next = { ...resolved, ...patch };
  if (dropEffort) delete next.reasoningEffort;
  if (dropMaxTokens) delete next.maxTokens;
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

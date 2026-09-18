// oh-my-dsh-slim runtime model settings.
//
// Role identity is carried explicitly by role-subagent.js and persisted in the
// child persona marker. Model names and token budgets are user-tunable values;
// they must never be used to infer which role is running.

import { loadConfig } from './config-loader.js';
import { assertHostCompatible } from './host-version.js';

function roleFromPayload(payload) {
  const options = payload.agent?.options;
  if (typeof options?.dshRoleId === 'string') return options.dshRoleId;
  const events = payload.agent?.session?.events ?? [];
  const marker = events.find((event) => event.type === 'subagent/descriptor')?.data?.persona;
  if (typeof marker !== 'string') return undefined;
  const match = marker.match(/oh-my-dsh-slim-role:([a-z]+)/);
  return match?.[1];
}

// A live child carries runtime `subagentDepth`, but a COLD-RESUMED child does
// not: the host omits it and trusts the durable header's delegationDepth
// (dsh-subagent resolveChildAgentOptions). Classifying resumed children as
// top-level here stamped orchestrator-default temperature over the role value
// (found 2026-08-21: a send_message-resumed fixer ran at 0.1 instead of 0.2).
function isSubagent(payload) {
  if (payload.agent?.options?.subagentDepth !== undefined) return true;
  return (payload.agent?.session?.header?.delegationDepth ?? 0) > 0;
}

// settings: per-request role configuration comes from the host settings
// namespace (registered by the npm seeder); cordis blocks undeclared service
// access. On hosts without the service the accessor is undefined and
// config-loader falls back to the legacy JSON file.
const inject = ['settings'];

// Whether a model accepts a configured effort is a MODEL fact, not a preset
// fact: effort ids are adapter-owned and open-ended, so the configuration
// writers check shape only. This waterfall is the one place that knows the
// configured level and the exact route it will be sent to, so a level the
// model does not declare fails the delegation with a readable error instead of
// dying inside the adapter.
//
// Only a verdict we could actually derive is cached (accepted, or rejected
// with an Error). "Could not judge" — no llm service yet, unregistered
// provider, unknown model — is NOT cached, so a host that is still coming up,
// or a provider the user imports later, gets a real answer on the next
// request. Unjudgeable also fails OPEN, matching the host's own rule that
// catalog absence is not rejection ("consumers must not turn absence into
// request rejection", dsh-llm).
const effortVerdicts = new Map();

function llmService(ctx) {
  try {
    const llm = ctx.get('llm');
    return llm !== undefined && typeof llm.resolveModel === 'function' ? llm : undefined;
  } catch {
    return undefined;
  }
}

/** Resolves to `{ error: Error | null }` when judged, `undefined` when not. */
function effortVerdict(ctx, provider, model, effort) {
  const key = `${provider}\u0000${model}\u0000${effort}`;
  const cached = effortVerdicts.get(key);
  if (cached !== undefined) return cached;
  const llm = llmService(ctx);
  if (llm === undefined) return Promise.resolve(undefined);
  return (async () => {
    try {
      const info = await llm.resolveModel(provider, model);
      const declared = info?.reasoning?.efforts;
      if (!Array.isArray(declared)) return undefined;
      const ids = declared.map((entry) => entry?.id).filter((id) => typeof id === 'string');
      if (ids.length === 0 || ids.includes(effort)) return { error: null };
      const fallback = typeof info?.reasoning?.defaultEffort === 'string'
        ? `; adapter default: "${info.reasoning.defaultEffort}"`
        : '';
      return {
        error: new Error(
          `reasoning effort "${effort}" is not offered by "${provider}/${model}".`
          + ` Declared efforts: ${ids.join(', ')}${fallback}.`
          + ` Fix the role's effort in the preset configuration (Settings → Plugins → oh-my-dsh-slim).`,
        ),
      };
    } catch {
      return undefined;
    }
  })().then((verdict) => {
    if (verdict !== undefined) effortVerdicts.set(key, Promise.resolve(verdict));
    return verdict;
  });
}

async function assertEffortDeclared(ctx, provider, model, effort) {
  // A route we cannot name here is not a level we can judge: pass through.
  if (typeof provider !== 'string' || typeof model !== 'string') return;
  const verdict = await effortVerdict(ctx, provider, model, effort);
  if (verdict?.error instanceof Error) throw verdict.error;
}

export function apply(ctx) {
  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next();
    const options = payload.agent?.options;
    if (!options || !isSubagent(payload)) {
      return resolved.temperature === undefined
        ? { ...resolved, temperature: 0.1 }
        : resolved;
    }
    const roleId = roleFromPayload(payload);
    const role = roleId ? loadConfig(ctx).roles[roleId] : undefined;
    if (role === undefined) {
      return resolved.reasoningEffort === 'high' && resolved.temperature !== undefined
        ? resolved
        : { ...resolved, reasoningEffort: resolved.reasoningEffort ?? 'high', temperature: resolved.temperature ?? 0.1 };
    }
    // Only a CONFIGURED level is checked: the unidentified-child fallback above
    // stamps the preset's own default, which the adapter may legitimately clamp.
    const injectsEffort = role.effort !== undefined && role.effort !== 'none' && role.effort !== resolved.reasoningEffort;
    if (injectsEffort) await assertEffortDeclared(ctx, options.provider, options.model, role.effort);
    return {
      ...resolved,
      ...(injectsEffort ? { reasoningEffort: role.effort } : {}),
      ...(role.temperature === undefined || role.temperature === resolved.temperature ? {} : { temperature: role.temperature }),
    };
  });
}


// Host compatibility gate: one throw here aborts the whole preset mount (fail-fast).
assertHostCompatible();
export const name = 'effort-by-role';
export { inject };

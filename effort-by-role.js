// oh-my-dsh-slim runtime model settings.
//
// Role identity is carried explicitly by role-subagent.js and persisted in the
// child persona marker. Model names and token budgets are user-tunable values;
// they must never be used to infer which role is running.

import { loadConfig } from './config-loader.js';

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
    return {
      ...resolved,
      ...(role.effort === undefined || role.effort === resolved.reasoningEffort ? {} : { reasoningEffort: role.effort }),
      ...(role.temperature === undefined || role.temperature === resolved.temperature ? {} : { temperature: role.temperature }),
    };
  });
}

export const name = 'effort-by-role';
export { inject };

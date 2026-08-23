// Configuration loader for the shareable oh-my-dsh-slim preset.
//
// The preset remains usable without a user file: defaults.json is bundled next
// to this module. A user override is read from OH_MY_DSH_SLIM_CONFIG or
// $DSH_HOME/oh-my-dsh-slim.json and merged by stable role id.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_NAME = 'oh-my-dsh-slim.json';
const ROLE_IDS = ['oracle', 'designer', 'fixer', 'explorer', 'librarian', 'observer'];
const RUNTIME_DEFAULTS = {
  oracle: { temperature: 0.1, maxTokens: 128000 },
  designer: { temperature: 0.7, maxTokens: 64000 },
  fixer: { temperature: 0.2, maxTokens: 96000 },
  explorer: { temperature: 0.1, maxTokens: 32000 },
  librarian: { temperature: 0.1, maxTokens: 48000 },
  observer: { temperature: 0.1, maxTokens: 24000 },
};
const TOOL_NAMES = new Set([
  'read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash',
  'web_search', 'web_fetch', 'skill', 'job_kill', 'job_list', 'job_output',
  'todo_write', 'ask_user_question',
]);
// Roles force-disabled in this preset version. observer stays closed until the
// harness can forward message attachments into delegated subagent contexts:
// pasted images are gated on the MAIN model's vision capability at send time,
// so a pasted image can neither reach a non-vision main model nor be handed to
// observer (delegation prompts are text-only). Re-enable via user JSON is
// therefore locked too — flipping it back is a preset-version decision, not a
// per-user setting.
const FORCE_DISABLED_ROLES = new Set(['observer']);

let cached;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`oh-my-dsh-slim: invalid JSON configuration at ${path}: ${error.message}`);
  }
}

function userConfigPath() {
  if (process.env.OH_MY_DSH_SLIM_CONFIG) return process.env.OH_MY_DSH_SLIM_CONFIG;
  if (process.env.DSH_HOME) return join(process.env.DSH_HOME, USER_CONFIG_NAME);
  return undefined;
}

function mergeRole(roleId, base, override, advanced) {
  const deny = [...new Set([
    ...(base?.deny ?? []),
    ...(override?.deny ?? []),
    ...(advanced?.deny ?? []),
  ])];
  const merged = {
    ...RUNTIME_DEFAULTS[roleId],
    ...base,
    ...(override ?? {}),
    ...(advanced ?? {}),
    ...(override?.mcps === undefined && advanced?.mcps === undefined ? { mcps: [...(base.mcps ?? [])] } : {}),
    ...(deny.length > 0 ? { deny } : {}),
  };
  if (merged.enabled === undefined) merged.enabled = true;
  if (FORCE_DISABLED_ROLES.has(roleId)) {
    if (merged.enabled === true) {
      process.stderr.write(
        `oh-my-dsh-slim: role "${roleId}" is force-disabled in this preset version (message attachments cannot be forwarded to subagents yet); ignoring enabled:true\n`,
      );
    }
    merged.enabled = false;
  }
  return merged;
}

function validateServer(name, server) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) throw new Error(`oh-my-dsh-slim: invalid MCP server name "${name}"`);
  if (!server || typeof server !== 'object' || !['stdio', 'streamable-http'].includes(server.transport)) {
    throw new Error(`oh-my-dsh-slim: MCP server "${name}" must declare transport stdio or streamable-http`);
  }
  if (server.transport === 'streamable-http' && typeof server.url !== 'string') {
    throw new Error(`oh-my-dsh-slim: MCP server "${name}" requires a string url`);
  }
  if (server.transport === 'stdio' && (typeof server.command !== 'string' || !Array.isArray(server.args ?? []))) {
    throw new Error(`oh-my-dsh-slim: stdio MCP server "${name}" requires command and args`);
  }
}

function validateRole(roleId, role, servers) {
  if (!role || typeof role !== 'object') throw new Error(`oh-my-dsh-slim: role "${roleId}" must be an object`);
  if (role.enabled !== undefined && typeof role.enabled !== 'boolean') throw new Error(`oh-my-dsh-slim: ${roleId}.enabled must be a boolean`);
  if (role.provider !== undefined && typeof role.provider !== 'string') throw new Error(`oh-my-dsh-slim: ${roleId}.provider must be a string`);
  if (role.model !== undefined && typeof role.model !== 'string') throw new Error(`oh-my-dsh-slim: ${roleId}.model must be a string`);
  if (role.effort !== undefined && !['off', 'low', 'medium', 'high', 'max'].includes(role.effort)) throw new Error(`oh-my-dsh-slim: ${roleId}.effort is invalid`);
  if (role.temperature !== undefined && (typeof role.temperature !== 'number' || role.temperature < 0 || role.temperature > 2)) {
    throw new Error(`oh-my-dsh-slim: ${roleId}.temperature must be between 0 and 2`);
  }
  if (role.maxTokens !== undefined && (!Number.isSafeInteger(role.maxTokens) || role.maxTokens < 1)) {
    throw new Error(`oh-my-dsh-slim: ${roleId}.maxTokens must be a positive integer`);
  }
  if (role.tools !== undefined && (!Array.isArray(role.tools) || role.tools.some((name) => !TOOL_NAMES.has(name)))) {
    throw new Error(`oh-my-dsh-slim: ${roleId}.tools contains an unknown global tool`);
  }
  if (role.deny !== undefined && (!Array.isArray(role.deny) || role.deny.some((name) => !TOOL_NAMES.has(name)))) {
    throw new Error(`oh-my-dsh-slim: ${roleId}.deny contains an unknown global tool`);
  }
  if (role.tools?.includes('web_fetch')) throw new Error(`oh-my-dsh-slim: ${roleId}.tools must not include web_fetch`);
  if (role.mcps !== undefined && (!Array.isArray(role.mcps) || role.mcps.some((name) => typeof name !== 'string' || !servers[name]))) {
    throw new Error(`oh-my-dsh-slim: ${roleId}.mcps references an unknown MCP server`);
  }
}

function load() {
  const defaults = readJson(join(ROOT, 'defaults.json'));
  const path = userConfigPath();
  const user = path && existsSync(path) ? readJson(path) : {};
  const presetName = user.preset ?? defaults.preset;
  if (user.preset !== undefined && defaults.presets?.[presetName] === undefined && user.presets?.[presetName] === undefined) {
    throw new Error(`oh-my-dsh-slim: unknown preset "${presetName}"`);
  }
  const defaultPreset = defaults.presets?.[presetName] ?? defaults.presets?.[defaults.preset];
  const userPreset = user.presets?.[presetName] ?? {};
  const servers = { ...(defaults.mcpServers ?? {}), ...(user.mcpServers ?? {}) };
  for (const [name, server] of Object.entries(servers)) validateServer(name, server);
  const advancedRoles = user.advanced?.roles ?? {};
  const roles = {};
  for (const roleId of ROLE_IDS) {
    roles[roleId] = mergeRole(roleId, defaultPreset?.[roleId], userPreset[roleId], advancedRoles[roleId]);
    validateRole(roleId, roles[roleId], servers);
  }
  return freeze({
    source: path ?? 'bundled defaults.json',
    preset: presetName,
    servers: clone(servers),
    roles,
    orchestrator: { ...(defaultPreset?.orchestrator ?? {}), ...(userPreset.orchestrator ?? {}) },
  });
}

export function loadConfig() {
  cached ??= load();
  return cached;
}

export function resetConfigForTests() {
  cached = undefined;
}

export { ROLE_IDS, RUNTIME_DEFAULTS, TOOL_NAMES };

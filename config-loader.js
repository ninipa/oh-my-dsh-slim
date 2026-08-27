// Configuration loader for the shareable oh-my-dsh-slim preset.
//
// The preset remains usable without any user configuration: defaults.json is
// bundled next to this module. User intent is read from, in descending
// priority: the OH_MY_DSH_SLIM_CONFIG test channel, the host settings
// namespace "oh-my-dsh-slim" (registered by the npm seeder; hot-updated), or
// the legacy $DSH_HOME/oh-my-dsh-slim.json file for hosts without a settings
// service. All sources share one shape and one merge.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_NAME = 'oh-my-dsh-slim.json';
// The settings namespace registered (and imported from the legacy file) by the
// npm seeder. Defined here so both the loader and the schema share one string
// without an import cycle (settings-schema.js imports the constants below).
export const SETTINGS_NS = 'oh-my-dsh-slim';
const ROLE_IDS = ['oracle', 'designer', 'fixer', 'explorer', 'librarian', 'observer'];
// Reasoning-effort vocabulary accepted for every role and the orchestrator.
export const EFFORT_LEVELS = ['off', 'low', 'medium', 'high', 'max'];
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

let cachedDefaults;

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
  if (role.effort !== undefined && !EFFORT_LEVELS.includes(role.effort)) throw new Error(`oh-my-dsh-slim: ${roleId}.effort is invalid`);
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

function readSettingsSection(ctx) {
  // The settings service is host-global on any DSH whose base bundle mounts
  // dsh-settings (rc.7+). Where it is absent — mock contexts, exotic
  // compositions — the cordis accessor is undefined and the legacy JSON
  // channel below stays authoritative. get() returns undefined while our
  // namespace is unregistered, which is the same signal.
  const settings = ctx?.settings;
  return typeof settings?.get === 'function' ? settings.get(SETTINGS_NS) : undefined;
}

function load(ctx) {
  const defaults = readDefaults();
  const envPath = process.env.OH_MY_DSH_SLIM_CONFIG;
  let user;
  let source;
  if (envPath !== undefined) {
    // Explicit test/CI channel: always a file, always wins.
    user = existsSync(envPath) ? readJson(envPath) : {};
    source = envPath;
  } else {
    const section = readSettingsSection(ctx);
    if (section !== undefined) {
      // Resolved settings section: schema-validated at registration/write
      // time and deep-frozen by the host; every call re-reads the latest
      // snapshot, so GUI edits apply without a restart.
      user = section;
      source = `settings:${SETTINGS_NS}`;
    } else {
      const path = userConfigPath();
      user = path && existsSync(path) ? readJson(path) : {};
      source = path ?? 'bundled defaults.json';
    }
  }
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
    source,
    preset: presetName,
    servers: clone(servers),
    roles,
    orchestrator: { ...(defaultPreset?.orchestrator ?? {}), ...(userPreset.orchestrator ?? {}) },
  });
}

function readDefaults() {
  cachedDefaults ??= readJson(join(ROOT, 'defaults.json'));
  return cachedDefaults;
}

// No user-layer caching: the settings path re-reads the host's latest resolved
// snapshot per call (cheap, in-memory) and the legacy file paths re-stat a
// tiny document, so configuration edits apply without a process restart.
export function loadConfig(ctx) {
  return load(ctx);
}

export function resetConfigForTests() {
  cachedDefaults = undefined;
}

export { ROLE_IDS, RUNTIME_DEFAULTS, TOOL_NAMES };

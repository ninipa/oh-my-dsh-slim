// Configuration loader for the shareable oh-my-dsh-slim preset.
//
// The preset remains usable without any user configuration: defaults.json is
// bundled next to this module. User intent is read from, in descending
// priority: the OH_MY_DSH_SLIM_CONFIG test channel, the per-preset profile
// snapshot (profile.json beside this module), the host settings namespace
// "oh-my-dsh-slim" (registered by the npm seeder; hot-updated), or the legacy
// $DSH_HOME/oh-my-dsh-slim.json file for hosts without a settings service.
// All sources share one shape and one merge.
//
// Profile snapshots are how a multi-preset deployment keeps configurations
// isolated: a custom agent preset (created by the seeder's /omds profile RPCs)
// is a full directory copy that carries its own plugins AND its own
// profile.json. A standing composition resolves config-loader relative to its
// own directory, so two profiles never read each other's document and the
// bundled preset (which ships no profile.json) keeps its original channels —
// the settings namespace and the legacy file — untouched.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_NAME = 'oh-my-dsh-slim.json';
// The per-preset configuration snapshot written by the /omds profile RPCs.
// Absent = this preset runs on the bundled defaults (and the bundled preset
// additionally consults the settings namespace / legacy JSON channels).
const PROFILE_SNAPSHOT_NAME = 'profile.json';
// Test channel honoring the multi-preset layout without touching the real
// preset directory: points at the directory whose profile.json (when present)
// is the snapshot. Unset in production, where ROOT is the preset directory.
const PROFILE_DIR_TEST_ENV = 'OH_MY_DSH_SLIM_PROFILE_DIR';
// The settings namespace registered (and imported from the legacy file) by the
// npm seeder. Defined here so both the loader and the schema share one string
// without an import cycle (settings-schema.js imports the constants below).
export const SETTINGS_NS = 'oh-my-dsh-slim';
const ROLE_IDS = ['oracle', 'designer', 'fixer', 'explorer', 'librarian', 'observer'];
// Reasoning-effort vocabulary accepted for every role and the orchestrator.
export const EFFORT_LEVELS = ['none', 'off', 'low', 'medium', 'high', 'max'];
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

/**
 * The profile snapshot directory this copy of the loader serves.
 *
 * Production resolves to this module's own directory — the preset directory a
 * standing composition was mounted from, which is how profiles stay isolated.
 * The test channel overrides it so tests never write into the workspace root.
 */
function profileSnapshotDir() {
  return process.env[PROFILE_DIR_TEST_ENV] !== undefined && process.env[PROFILE_DIR_TEST_ENV].trim() !== ''
    ? process.env[PROFILE_DIR_TEST_ENV]
    : ROOT;
}

/**
 * Read this preset's own profile snapshot, if it has one.
 * Returns undefined for the bundled preset and for directories that ship no
 * profile.json (they simply run on the bundled defaults).
 */
function readProfileSnapshot() {
  const dir = profileSnapshotDir();
  const path = join(dir, PROFILE_SNAPSHOT_NAME);
  if (!existsSync(path)) return undefined;
  return readJson(path);
}

/**
 * Select the inner preset name and its role overrides from one user document.
 *
 * Accepts both shapes: the legacy document (role overrides under
 * `presets[<preset>]`, the name in `preset`) and the compact profile document
 * (role overrides directly under `roles`, state under `advanced`/
 * `mcpServers` at the top level). The compact keys win over the legacy map so
 * a document that carries both stays unambiguous.
 */
function selectUserPreset(defaults, user) {
  const presetName = user.preset ?? defaults.preset;
  if (user.preset !== undefined && defaults.presets?.[presetName] === undefined && user.presets?.[presetName] === undefined) {
    throw new Error(`oh-my-dsh-slim: unknown preset "${presetName}"`);
  }
  const inherited = user.presets?.[presetName] ?? {};
  const compact = user.roles ?? {};
  const userPreset = { ...inherited, ...compact };
  if (userPreset.orchestrator === undefined && user.orchestrator !== undefined) {
    userPreset.orchestrator = user.orchestrator;
  }
  return { presetName, userPreset };
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
  // Host settings (dsh-settings) resolve user documents through schemastery,
  // whose array fields default to [] when the user layer omits them. An
  // empty tools list is the same intent as "not configured" (deny-only), but
  // role-subagent turns it into `allow: []`, and DSH tools.restrict() treats
  // an existing allow list as exhaustive — every inherited tool would be
  // rejected. Normalize empty lists back to unset.
  if (Array.isArray(merged.tools) && merged.tools.length === 0) delete merged.tools;
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
  if (typeof settings?.get === 'function') {
    const resolved = settings.get(SETTINGS_NS);
    if (resolved !== undefined) return resolved;
    // Preset-scope plugins (role-subagent, effort-by-role)
    // resolve a settings instance from the standing scope whose registrations
    // live on the host plane — get() sees no namespace there, but the raw
    // published document is reachable. It is schema-validated at write time
    // by the host and lacks the bundled base layer, which config-loader's own
    // defaults merge already supplies (idempotent over resolved values).
    const raw = settings.document?.[SETTINGS_NS];
    if (raw !== undefined && typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
  }
  return undefined;
}

function load(ctx) {
  const defaults = readDefaults();
  const envPath = process.env.OH_MY_DSH_SLIM_CONFIG;
  // A preset that carries its own profile snapshot has one channel only: the
  // snapshot document (plus the bundled defaults it merges over). The global
  // settings namespace and the legacy file belong to the bundled preset —
  // letting a custom profile read them would leak the bundled profile's
  // overrides into every profile and break per-profile isolation.
  const snapshot = readProfileSnapshot();
  let user;
  let source;
  if (envPath !== undefined) {
    // Explicit test/CI channel: always a file, always wins.
    user = existsSync(envPath) ? readJson(envPath) : {};
    source = envPath;
  } else if (snapshot !== undefined) {
    user = snapshot;
    source = `profile snapshot: ${join(profileSnapshotDir(), PROFILE_SNAPSHOT_NAME)}`;
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
  const { presetName, userPreset } = selectUserPreset(defaults, user);
  const defaultPreset = defaults.presets?.[presetName] ?? defaults.presets?.[defaults.preset];
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
    // The native preset id this snapshot belongs to; undefined for the
    // bundled preset (its identity is the legacy channel, not a dir-local
    // document). Present for custom profile snapshots.
    profileId: snapshot === undefined ? undefined : basename(profileSnapshotDir()),
    servers: clone(servers),
    roles,
    orchestrator: { ...(defaultPreset?.orchestrator ?? {}), ...(userPreset.orchestrator ?? {}) },
  });
}

/**
 * Validate a profile configuration document (the payload the /omds profile
 * RPCs persist as a preset's profile.json) BEFORE it is written, so a bad
 * save fails loudly instead of breaking the profile's sessions later.
 * Accepts both the legacy and the compact document shapes, exactly like
 * load() — the same validator the settings namespace applies to its channel.
 * Throws a TypeError-compatible Error naming the offending field.
 */
export function validateConfigDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new TypeError('profile config must be a JSON object');
  }
  const defaults = readDefaults();
  const servers = { ...(defaults.mcpServers ?? {}), ...(doc.mcpServers ?? {}) };
  for (const [name, server] of Object.entries(servers)) validateServer(name, server);
  const { userPreset } = selectUserPreset(defaults, doc);
  for (const roleId of ROLE_IDS) {
    const candidate = {
      ...(defaults.presets?.[defaults.preset]?.[roleId] ?? {}),
      ...(userPreset?.[roleId] ?? {}),
      ...(doc.advanced?.roles?.[roleId] ?? {}),
    };
    validateRole(roleId, candidate, servers);
  }
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

export { PROFILE_SNAPSHOT_NAME, ROLE_IDS, RUNTIME_DEFAULTS, TOOL_NAMES };

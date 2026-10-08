// preset/config.js — the preset's user configuration.
//
// Channels, in descending priority:
//   1. $OH_MY_DSH_SLIM_CONFIG                      (explicit file, tests/CI)
//   2. profile.json beside the mounted preset copy  (per-profile snapshot)
//   3. $DSH_HOME/oh-my-dsh-slim.json                (the documented user file)
//   4. defaults.json bundled with the preset
//
// DSH 0.2.0 removed the 0.1.x host settings namespace API (dsh-settings now
// renders plugin-declared `.volatile()` fields through the profile's Cordis
// patch), so the file channel is the user-facing one. Every channel shares one
// shape and one merge: user values win key by key, arrays replace whole.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHostConfig } from '../lib/config-settings.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_NAME = 'oh-my-dsh-slim.json';
const PROFILE_SNAPSHOT_NAME = 'profile.json';
const PROFILE_DIR_TEST_ENV = 'OH_MY_DSH_SLIM_PROFILE_DIR';

/** The documentation namespace name, kept for 0.1.x compatibility. */
export const SETTINGS_NS = 'oh-my-dsh-slim';
/** Roles this preset knows about, in presentation order. */
export const ROLE_IDS = ['oracle', 'designer', 'fixer', 'explorer', 'librarian', 'observer'];

/**
 * The preset's FACTORY effort vocabulary: what defaults.json ships and what the
 * documentation uses. Deliberately not a validation gate — effort ids are
 * adapter-owned, so gating on a fixed list is what rejected a valid `xhigh`
 * in the 0.1.x line. Writers check shape; whether a model accepts a level is
 * checked at runtime against that model's declared efforts.
 */
export const EFFORT_LEVELS = ['none', 'off', 'low', 'medium', 'high', 'max'];
/** Shape rule for an effort token: a short identifier, not a vocabulary claim. */
export const EFFORT_TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
export function isEffortToken(value) {
  return typeof value === 'string' && EFFORT_TOKEN_PATTERN.test(value);
}

const RUNTIME_DEFAULTS = {
  oracle: { temperature: 0.1, maxTokens: 128000 },
  designer: { temperature: 0.7, maxTokens: 64000 },
  fixer: { temperature: 0.2, maxTokens: 96000 },
  explorer: { temperature: 0.1, maxTokens: 32000 },
  librarian: { temperature: 0.1, maxTokens: 48000 },
  observer: { temperature: 0.1, maxTokens: 24000 },
};

const TOOL_NAMES = new Set([
  'read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh',
  'web_search', 'web_fetch', 'skill', 'job_kill', 'job_list', 'job_output',
  'todo_write', 'ask_user_question', 'present',
]);

// Roles force-disabled in this preset version. observer stays closed until the
// harness can forward message attachments into delegated subagent contexts:
// pasted images are gated on the MAIN model's vision capability at send time,
// so a pasted image can neither reach a non-vision main model nor be handed to
// observer (delegation prompts are text-only).
const FORCE_DISABLED_ROLES = new Set(['observer']);

let cachedDefaults;
const profileContexts = new WeakMap();
export function bindProfileContext(ctx, profileId) {
  if (profileId !== undefined) profileContexts.set(ctx, profileId);
}


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
    throw new Error('oh-my-dsh-slim: invalid JSON configuration at ' + path + ': ' + error.message);
  }
}

function readDefaults() {
  // defaults.json ships beside this module (preset/), not at the package root.
  cachedDefaults ??= readJson(join(ROOT, 'defaults.json'));
  return cachedDefaults;
}

/**
 * The directory whose profile.json (when present) is this copy's snapshot.
 * Production resolves to the mounted preset directory; the test channel
 * overrides it so tests never write into the workspace root.
 */
function profileSnapshotDir() {
  const override = process.env[PROFILE_DIR_TEST_ENV];
  return override !== undefined && override.trim() !== '' ? override : ROOT;
}

function readProfileSnapshot() {
  const dir = profileSnapshotDir();
  const path = join(dir, PROFILE_SNAPSHOT_NAME);
  if (!existsSync(path)) return undefined;
  return readJson(path);
}

function userConfigPath() {
  if (process.env.OH_MY_DSH_SLIM_CONFIG) return process.env.OH_MY_DSH_SLIM_CONFIG;
  if (process.env.DSH_HOME) return join(process.env.DSH_HOME, USER_CONFIG_NAME);
  return undefined;
}

/**
 * Select the role overrides from one user document. Both document shapes are
 * accepted: role overrides under `presets[<name>]` (the 0.1.x layout) and the
 * compact `roles` map (the profile-snapshot layout). Compact keys win.
 */
function selectUserRoles(defaults, user) {
  const presetName = user.preset ?? defaults.preset;
  if (user.preset !== undefined && defaults.presets?.[presetName] === undefined && user.presets?.[presetName] === undefined) {
    throw new Error('oh-my-dsh-slim: unknown preset "' + presetName + '"');
  }
  // Upstream compact entries replace legacy entries as a whole; only the
  // selected user entry then merges with the bundled role defaults.
  const roles = { ...(user.presets?.[presetName] ?? {}), ...(user.roles ?? {}) };
  if (roles.orchestrator === undefined && user.orchestrator !== undefined) roles.orchestrator = user.orchestrator;
  return { presetName, ...roles };
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
    ...(override?.mcps === undefined && advanced?.mcps === undefined ? { mcps: [...(base?.mcps ?? [])] } : {}),
    ...(deny.length > 0 ? { deny } : {}),
  };
  // An empty tools list means the same as "not configured" (deny-only), but an
  // allow list is exhaustive once present — DSH's tools.restrict() rejects
  // everything outside it, so an accidental [] must not become "allow nothing".
  if (Array.isArray(merged.tools) && merged.tools.length === 0) delete merged.tools;
  if (merged.enabled === undefined) merged.enabled = true;
  if (FORCE_DISABLED_ROLES.has(roleId)) {
    if (merged.enabled === true) {
      process.stderr.write(
        'oh-my-dsh-slim: role "' + roleId + '" is force-disabled in this preset version (message attachments cannot be forwarded to subagents yet); ignoring enabled:true' + String.fromCharCode(10),
      );
    }
    merged.enabled = false;
  }
  return merged;
}

function validateServer(name, server) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) throw new Error('oh-my-dsh-slim: invalid MCP server name "' + name + '"');
  if (!server || typeof server !== 'object' || !['stdio', 'streamable-http'].includes(server.transport)) {
    throw new Error('oh-my-dsh-slim: MCP server "' + name + '" must declare transport stdio or streamable-http');
  }
  if (server.transport === 'streamable-http' && typeof server.url !== 'string') {
    throw new Error('oh-my-dsh-slim: MCP server "' + name + '" requires a string url');
  }
  if (server.transport === 'stdio' && (typeof server.command !== 'string' || !Array.isArray(server.args ?? []))) {
    throw new Error('oh-my-dsh-slim: stdio MCP server "' + name + '" requires command and args');
  }
}

function validateRole(roleId, role, servers) {
  if (!role || typeof role !== 'object') throw new Error('oh-my-dsh-slim: role "' + roleId + '" must be an object');
  if (role.enabled !== undefined && typeof role.enabled !== 'boolean') throw new Error('oh-my-dsh-slim: ' + roleId + '.enabled must be a boolean');
  if (role.provider !== undefined && typeof role.provider !== 'string') throw new Error('oh-my-dsh-slim: ' + roleId + '.provider must be a string');
  if (role.model !== undefined && typeof role.model !== 'string') throw new Error('oh-my-dsh-slim: ' + roleId + '.model must be a string');
  if (role.effort !== undefined && !isEffortToken(role.effort)) throw new Error('oh-my-dsh-slim: ' + roleId + '.effort must be a short token of letters, digits, "-" or "_"');
  if (role.temperature !== undefined && (typeof role.temperature !== 'number' || role.temperature < 0 || role.temperature > 2)) {
    throw new Error('oh-my-dsh-slim: ' + roleId + '.temperature must be between 0 and 2');
  }
  if (role.maxTokens !== undefined && (!Number.isSafeInteger(role.maxTokens) || role.maxTokens < 1)) {
    throw new Error('oh-my-dsh-slim: ' + roleId + '.maxTokens must be a positive integer');
  }
  if (role.tools !== undefined && (!Array.isArray(role.tools) || role.tools.some((name) => !TOOL_NAMES.has(name)))) {
    throw new Error('oh-my-dsh-slim: ' + roleId + '.tools contains an unknown global tool');
  }
  if (role.deny !== undefined && (!Array.isArray(role.deny) || role.deny.some((name) => !TOOL_NAMES.has(name)))) {
    throw new Error('oh-my-dsh-slim: ' + roleId + '.deny contains an unknown global tool');
  }
  if (role.mcps !== undefined && (!Array.isArray(role.mcps) || role.mcps.some((name) => typeof name !== 'string' || !servers[name]))) {
    throw new Error('oh-my-dsh-slim: ' + roleId + '.mcps references an unknown MCP server');
  }
}

/**
 * Load and validate the effective configuration.
 * @returns a frozen document: { source, preset, servers, roles, orchestrator }.
 */
export function loadConfig(ctx) {
  const defaults = readDefaults();
  const envPath = process.env.OH_MY_DSH_SLIM_CONFIG;
  const namedId = ctx && profileContexts.get(ctx);
  const named = envPath === undefined && namedId !== undefined ? ctx.get('omdsProfiles')?.read(namedId) : undefined;
  if (envPath === undefined && namedId !== undefined && named === undefined) throw new Error('oh-my-dsh-slim: named profile unavailable: ' + namedId);
  const snapshot = envPath === undefined ? (named ?? readProfileSnapshot()) : undefined;
  const nativeSettings = envPath === undefined && snapshot === undefined ? readHostConfig(ctx) : undefined;
  let user;
  let source;
  if (envPath !== undefined) {
    user = existsSync(envPath) ? readJson(envPath) : {};
    source = envPath;
  } else if (snapshot !== undefined) {
    user = snapshot;
    source = namedId !== undefined ? 'named profile: ' + namedId : 'profile snapshot: ' + join(profileSnapshotDir(), PROFILE_SNAPSHOT_NAME);
  } else if (nativeSettings !== undefined) {
    user = nativeSettings;
    source = 'DSH plugin settings: ' + SETTINGS_NS;
  } else {
    const path = userConfigPath();
    user = path && existsSync(path) ? readJson(path) : {};
    source = path ?? 'bundled defaults.json';
  }
  const userRoles = selectUserRoles(defaults, user);
  const defaultPreset = defaults.presets?.[userRoles.presetName] ?? defaults.presets?.[defaults.preset];
  const servers = { ...(defaults.mcpServers ?? {}), ...(user.mcpServers ?? {}) };
  for (const [name, server] of Object.entries(servers)) validateServer(name, server);
  const advancedRoles = user.advanced?.roles ?? {};
  const roles = {};
  for (const roleId of ROLE_IDS) {
    roles[roleId] = mergeRole(roleId, defaultPreset?.[roleId], userRoles[roleId], advancedRoles[roleId]);
    validateRole(roleId, roles[roleId], servers);
  }
  return freeze({
    source,
    preset: user.preset ?? defaults.preset,
    profileId: snapshot === undefined ? undefined : (namedId ?? basename(profileSnapshotDir())),
    servers: clone(servers),
    roles,
    orchestrator: { ...(defaultPreset?.orchestrator ?? {}), ...(userRoles.orchestrator ?? {}) },
  });
}

/** Validate one configuration document before it is written (used by tests). */
export function validateConfigDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError('profile config must be a JSON object');
  const defaults = readDefaults();
  const servers = { ...(defaults.mcpServers ?? {}), ...(doc.mcpServers ?? {}) };
  for (const [name, server] of Object.entries(servers)) validateServer(name, server);
  const userRoles = selectUserRoles(defaults, doc);
  for (const roleId of ROLE_IDS) {
    validateRole(roleId, {
      ...(defaults.presets?.[defaults.preset]?.[roleId] ?? {}),
      ...(userRoles[roleId] ?? {}),
      ...(doc.advanced?.roles?.[roleId] ?? {}),
    }, servers);
  }
}

export function resetConfigForTests() {
  cachedDefaults = undefined;
}

export { PROFILE_SNAPSHOT_NAME, RUNTIME_DEFAULTS, TOOL_NAMES };

/**
 * The effective defaults for one role in the effective preset: the shipped
 * role entry merged with the runtime temperature/maxTokens floor and with any
 * user override. Row wrappers use it to fill what the configuration omitted.
 * @param roleId - one of ROLE_IDS.
 * @returns the merged role document, or undefined for an unknown role.
 */
export function roleDefaults(roleId) {
  if (!ROLE_IDS.includes(roleId)) return undefined;
  return loadConfig().roles[roleId];
}

/** One-line summary used by the seeder's startup notice. */
export function describeConfig(config) {
  const enabled = ROLE_IDS.filter((roleId) => config.roles[roleId]?.enabled !== false);
  return 'preset=' + config.preset + ' roles=' + enabled.join(',') + ' source=' + config.source;
}

// oh-my-dsh-slim preset seeder (host half, zero dependencies).
//
// Ships a full copy of the oh-my-dsh-slim agent preset under `preset/` and
// materializes it into `<DSH_HOME>/.agent-presets/oh-my-dsh-slim` on mount:
//
//   target absent                      → seed bundled preset + write marker
//   target has .git                    → untouched (user manages updates via git)
//   target without a seed marker       → untouched (manually installed; never
//                                        overwrite directories of unknown origin)
//   marker older than bundled version  → backup old dir to <name>.bak-<stamp>,
//                                        re-seed, refresh marker
//   marker same/newer                  → nothing to do
//
// The preset directory is MANAGED CONTENT. The sanctioned customization
// channel is the user configuration, read by the preset's config-loader from
// the host settings namespace "oh-my-dsh-slim" (registered here when the
// optional @deepseek-ai/schemastery peer resolves) or, on hosts without a
// settings service, from <DSH_HOME>/oh-my-dsh-slim.json. On first boot with a
// settings service a legacy JSON file is imported into the namespace and
// archived as oh-my-dsh-slim.json.imported-<stamp>; hand edits inside the
// preset directory survive only through the timestamped backup.
//
// Multi-preset profiles: the /omds RPC (registered here, called by the
// browser half of this package) implements profile-list / profile-create /
// profile-save / profile-set-default against DSH's native agent-presets
// authoring API. A profile IS a native preset directory: create copies the
// bundled preset under a generated stable id with a user-given display name,
// then writes the profile's configuration snapshot (profile.json) beside the
// copy. The preset's own config-loader reads that snapshot from its own
// directory, which is what keeps per-preset configurations isolated — no
// global profile map, no cross-session leakage. The native "default for new
// sessions" is DSH's own agent-presets settings document, so this card and
// DSH's preset picker always agree.
//
// Uninstalling this npm package does NOT remove seeded preset directories.

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SETTINGS_NS, buildSettingsSchema } from '../preset/settings-schema.js';
import { validateConfigDocument } from '../preset/config-loader.js';

export const name = 'omds-preset-seeder';

const PRESET_DIR_NAME = 'oh-my-dsh-slim';
const MARKER_FILE = '.omds-seed.json';
const PROFILE_CONFIG_NAME = 'profile.json';
const PROFILE_ID_PREFIX = 'profile-';
const PROFILE_ID_HASH_LENGTH = 12;
const MAX_DISPLAY_NAME_LENGTH = 64;
// The settings namespace DSH itself registers for the chosen default preset
// ($DSH_HOME/settings.yaml, section "agent-presets").
const NATIVE_DEFAULT_NS = 'agent-presets';
const bundledDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'preset');
const bundledVersion = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
).version;
const bundledDefaults = JSON.parse(readFileSync(join(bundledDir, 'defaults.json'), 'utf8'));

/** Validate and normalize the one field accepted by the new-profile flow. */
export function normalizeDisplayName(value) {
  if (typeof value !== 'string') throw new TypeError('profile display name must be a string');
  const name = value.trim();
  if (name.length === 0) throw new TypeError('profile display name must not be empty');
  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new RangeError(`profile display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`);
  }
  return name;
}

/**
 * Generate a stable native preset id from UTF-8 display text without a new
 * dependency. The readable ASCII portion is only a hint; the hash is the
 * identity and prevents collisions between non-ASCII names.
 */
export function profileIdForDisplayName(value) {
  const name = normalizeDisplayName(value);
  const prefix = name.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 24) || 'profile';
  const hash = createHash('sha256').update(name, 'utf8').digest('hex').slice(0, PROFILE_ID_HASH_LENGTH);
  return `${PROFILE_ID_PREFIX}${prefix}-${hash}`;
}

/** Preset ids this package owns: the bundled preset plus its copies. */
export function isOursPresetId(id) {
  return typeof id === 'string' && (id === PRESET_DIR_NAME || id.startsWith(PROFILE_ID_PREFIX));
}

/** Whether the preset id is a custom profile (a managed copy, not bundled). */
export function isCustomProfileId(id) {
  return isOursPresetId(id) && id !== PRESET_DIR_NAME;
}

function presetDirOf(preset) {
  return dirname(preset.path);
}

/** Per-profile snapshot path inside a preset directory. */
function profileConfigPath(presetDir) {
  return join(presetDir, PROFILE_CONFIG_NAME);
}

function rpcError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Content revision of a profile snapshot: hash of the file, or 'none'. */
function revisionFor(path) {
  if (!existsSync(path)) return 'none';
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

/** Atomic replace of the profile snapshot (temp file + rename). */
function writeProfileSnapshot(presetDir, config) {
  const target = profileConfigPath(presetDir);
  const tmp = join(presetDir, `.${PROFILE_CONFIG_NAME}.tmp-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(tmp, `${JSON.stringify(config ?? {}, null, 2)}\n`);
    renameSync(tmp, target);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

/** Render a YAML `name:` line (double-quoted scalar; JSON escaping is valid YAML). */
function yamlNameLine(value) {
  return `name: ${JSON.stringify(String(value))}`;
}

/**
 * Rename a profile's display metadata in its preset.yml, preserving every
 * other line (description/order and any hand edits) verbatim. The id — the
 * directory name — never changes, which is the point of the rename.
 */
function renamePresetMetadata(presetDir, displayName) {
  const metaPath = join(presetDir, 'preset.yml');
  const current = existsSync(metaPath) ? readFileSync(metaPath, 'utf8') : '';
  const lines = current.split('\n');
  const index = lines.findIndex((text) => /^name:/.test(text));
  if (index === -1) {
    const body = `${yamlNameLine(displayName)}\n${current}`;
    writeFileSync(metaPath, body.replace(/\n{2,}/, '\n'));
    return;
  }
  lines[index] = yamlNameLine(displayName);
  writeFileSync(metaPath, lines.join('\n'));
}

/** Current display name from preset.yml (native metadata), or undefined. */
function displayNameOf(preset) {
  return typeof preset.name === 'string' && preset.name.trim() !== '' ? preset.name : undefined;
}

/**
 * The four profile RPC endpoints, as an injectable object over the native
 * authoring API. Exposed separately from the RPC wiring so the logic can be
 * driven directly by unit tests with a mock roster. Every endpoint throws a
 * coded error (`.code`) that the /omds handler maps to the RPC error
 * envelope; the browser adapter turns those into user-facing messages.
 */
export function makeProfileEndpoints({ agentPresets, getSettings, log }) {
  if (!agentPresets || typeof agentPresets.list !== 'function' || typeof agentPresets.resolve !== 'function') {
    throw new Error('agent-presets service is unavailable; profile management cannot run');
  }
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    ...(log ?? {}),
  };

  const allOurs = async () => (await agentPresets.list()).filter((preset) => isOursPresetId(preset.id));

  async function assertNameFree(displayName, exceptId) {
    const name = displayName.toLowerCase();
    for (const preset of await allOurs()) {
      if (preset.id === exceptId) continue;
      const existing = displayNameOf(preset) ?? preset.id;
      if (existing.toLowerCase() === name) {
        throw rpcError('PROFILE_NAME_CONFLICT', `a profile named "${displayName}" already exists`);
      }
    }
  }

  return {
    /** The full roster of profiles this package owns. */
    async list() {
      const defaultId = agentPresets.defaultId;
      const profiles = [];
      for (const preset of await allOurs()) {
        const custom = isCustomProfileId(preset.id);
        const dir = presetDirOf(preset);
        const configPath = profileConfigPath(dir);
        const entry = {
          id: preset.id,
          displayName: displayNameOf(preset) ?? preset.id,
          kind: custom ? 'custom' : 'bundled',
          isDefaultForNewSessions: preset.id === defaultId,
          revision: custom ? revisionFor(configPath) : undefined,
        };
        if (custom) {
          entry.config = existsSync(configPath)
            ? JSON.parse(readFileSync(configPath, 'utf8'))
            : {};
        }
        profiles.push(entry);
      }
      return {
        profiles,
        defaultProfileId: typeof defaultId === 'string' ? defaultId : PRESET_DIR_NAME,
      };
    },

    /**
     * Create a profile: native whole-directory copy (atomic; a failed copy
     * removes its destination and the copy refuses occupied ids), then the
     * config snapshot. A validation or write failure removes the copy again —
     * the roster must never see a half-authored profile.
     */
    async create({ displayName, config }) {
      const name = normalizeDisplayName(displayName);
      await assertNameFree(name);
      const id = profileIdForDisplayName(name);
      let dir;
      try {
        await agentPresets.copy(PRESET_DIR_NAME, id, name);
        dir = presetDirOf(await agentPresets.resolve(id));
      } catch (error) {
        if (error?.code !== undefined) throw error;
        throw rpcError('PROFILE_CREATE_FAILED', `cannot create profile preset: ${error?.message ?? String(error)}`);
      }
      try {
        try {
          validateConfigDocument(config);
        } catch (error) {
          throw rpcError('PROFILE_INVALID_CONFIG', `profile configuration rejected: ${error?.message ?? String(error)}`);
        }
        writeProfileSnapshot(dir, config ?? {});
      } catch (error) {
        try { await agentPresets.remove(id); } catch { /* rollback is best effort */ }
        if (error?.code !== undefined) throw error;
        throw rpcError('PROFILE_WRITE_FAILED', `profile configuration could not be written: ${error?.message ?? String(error)}`);
      }
      logger.info(`omds-preset-seeder: created native profile preset ${id} ("${name}")`);
      return {
        id,
        displayName: name,
        revision: revisionFor(profileConfigPath(dir)),
      };
    },

    /**
     * Persist a profile's configuration snapshot (and, when given, rename its
     * display metadata — the id never changes). expectedRevision must match
     * the current snapshot, so two concurrent writers cannot silently
     * overwrite each other ("none" is the revision of an untouched copy).
     */
    async save({ id, config, expectedRevision, displayName }) {
      if (typeof expectedRevision !== 'string') {
        throw rpcError('PROFILE_CONFLICT', 'expectedRevision is required to save a profile');
      }
      if (!isCustomProfileId(id)) {
        throw rpcError('PROFILE_UNSUPPORTED', 'only custom profiles persist through /omds; the bundled profile saves through the settings namespace');
      }
      let preset;
      try {
        preset = await agentPresets.resolve(id);
      } catch {
        throw rpcError('PROFILE_NOT_FOUND', `profile "${id}" does not exist`);
      }
      if (preset.trust !== 'user') {
        throw rpcError('PROFILE_UNSUPPORTED', `profile "${id}" is not locally authored`);
      }
      const dir = presetDirOf(preset);
      const configPath = profileConfigPath(dir);
      const current = revisionFor(configPath);
      if (current !== expectedRevision) {
        throw rpcError('PROFILE_CONFLICT', `profile "${id}" changed since it was loaded (expected "${expectedRevision}", found "${current}")`);
      }
      try {
        validateConfigDocument(config);
      } catch (error) {
        throw rpcError('PROFILE_INVALID_CONFIG', `profile configuration rejected: ${error?.message ?? String(error)}`);
      }
      let finalName = displayNameOf(preset);
      if (displayName !== undefined) {
        const name = normalizeDisplayName(displayName);
        if (name !== finalName) {
          await assertNameFree(name, id);
          renamePresetMetadata(dir, name);
          finalName = name;
        }
      }
      try {
        writeProfileSnapshot(dir, config ?? {});
      } catch (error) {
        throw rpcError('PROFILE_WRITE_FAILED', `profile configuration could not be written: ${error?.message ?? String(error)}`);
      }
      logger.info(`omds-preset-seeder: saved profile ${id} (revision ${revisionFor(configPath)})`);
      return {
        id,
        displayName: finalName ?? id,
        revision: revisionFor(configPath),
      };
    },

    /**
     * Mark a profile as the default for NEW sessions. Writes DSH's own
     * agent-presets default document, so the native preset picker and this
     * card always agree; running sessions are untouched by design.
     */
    async setDefault({ profileId }) {
      if (!isOursPresetId(profileId)) {
        throw rpcError('PROFILE_UNSUPPORTED', `"${profileId}" is not an oh-my-dsh-slim profile`);
      }
      try {
        await agentPresets.resolve(profileId);
      } catch {
        throw rpcError('PROFILE_NOT_FOUND', `profile "${profileId}" does not exist`);
      }
      const settings = typeof getSettings === 'function' ? getSettings() : undefined;
      if (!settings || typeof settings.mutate !== 'function') {
        throw rpcError('PROFILE_SETTINGS_UNAVAILABLE', 'the settings service is unavailable; cannot change the new-session default');
      }
      await settings.mutate(NATIVE_DEFAULT_NS, [{ op: 'set', path: ['default'], value: profileId }]);
      logger.info(`omds-preset-seeder: new-session default preset is now ${profileId}`);
      return { profileId, isDefaultForNewSessions: true };
    },
  };
}

function resolveHome() {
  const env = process.env.DSH_HOME;
  return env !== undefined && env.trim() !== '' ? env : join(homedir(), '.dsh');
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function seedFresh(target, log) {
  cpSync(bundledDir, target, { recursive: true });
  writeFileSync(join(target, MARKER_FILE), JSON.stringify({ seededVersion: bundledVersion }, null, 2));
  log.info(`omds-preset-seeder: preset seeded at ${target} (v${bundledVersion})`);
}

function legacyJsonPath() {
  return join(resolveHome(), `${PRESET_DIR_NAME}.json`);
}

// One-time migration: a legacy oh-my-dsh-slim.json becomes the namespace's
// user section and the file is archived. Every failure mode keeps the file in
// place and explains why — an import must never lose user intent.
function importLegacyJson(sctx, scope, schema, log) {
  const path = legacyJsonPath();
  if (!existsSync(path)) return;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    log.warn(`omds-preset-seeder: legacy ${path} is not valid JSON; leaving it untouched (${error.message})`);
    return;
  }
  const descriptor = sctx.settings.describe().find((entry) => entry.ns === SETTINGS_NS);
  if (descriptor?.user !== undefined && Object.keys(descriptor.user).length > 0) {
    log.warn(`omds-preset-seeder: settings.yaml already carries a "${SETTINGS_NS}" section; legacy ${path} is ignored — archive or delete the file to silence this warning`);
    return;
  }
  try {
    schema(doc);
  } catch (error) {
    log.warn(`omds-preset-seeder: legacy ${path} failed schema validation; leaving it untouched (${error.message})`);
    return;
  }
  scope.replace(doc);
  const archive = `${path}.imported-${stamp()}`;
  renameSync(path, archive);
  log.info(`omds-preset-seeder: imported ${path} into settings "${SETTINGS_NS}" and archived it at ${archive}`);
}

// Register the settings namespace so the preset's config-loader (and, from
// v2, the GUI card) has a sanctioned write channel. The only peer,
// @deepseek-ai/schemastery, is provided by the host; when it cannot be
// resolved the namespace is skipped and the legacy JSON channel stays
// authoritative. Registration rides ctx.inject, so a host without a settings
// service simply never runs it. Nothing here may break the DSH boot.
async function wireSettings(ctx, log) {
  let z;
  try {
    z = (await import('@deepseek-ai/schemastery')).default;
  } catch (error) {
    log.info(`omds-preset-seeder: @deepseek-ai/schemastery unavailable (${error?.message ?? error}); settings namespace skipped, legacy JSON channel stays active`);
    return;
  }
  const schema = buildSettingsSchema(z);
  ctx.inject(['settings'], (sctx) => {
    try {
      const scope = sctx.settings.register(SETTINGS_NS, schema, { base: bundledDefaults });
      importLegacyJson(sctx, scope, schema, log);
      scope.watch(() => log.info(`omds-preset-seeder: settings "${SETTINGS_NS}" updated`));
      log.info(`omds-preset-seeder: settings namespace "${SETTINGS_NS}" registered`);
    } catch (error) {
      log.error(`omds-preset-seeder: settings namespace registration failed; legacy JSON channel stays active: ${error?.stack ?? String(error)}`);
    }
  });
}

// The /omds RPC owns profile authoring because the browser must never write a
// native preset directory itself. A serialized queue closes the check/copy
// race for two simultaneous first-save requests with the same display name.
// The settings service is resolved via a nested inject and is used by
// profile-set-default only: hosts without one must keep provider-status and
// profile create/list/save working.
function wireOmdsRpc(ctx, log) {
  ctx.inject(['connection', 'web', 'agentPresets'], (cctx) => {
    let createQueue = Promise.resolve();
    let settings;
    ctx.inject(['settings'], (sctx) => { settings = sctx.settings; });
    const endpoints = makeProfileEndpoints({
      agentPresets: cctx.agentPresets,
      getSettings: () => settings,
      log,
    });
    const runCreate = (task) => {
      const turn = createQueue.then(task);
      createQueue = turn.catch(() => undefined);
      return turn;
    };
    try {
      cctx.connection.rpc.handle('/omds', async (endpoint, payload = {}, _signal) => {
        try {
          if (endpoint === 'provider-status') {
            const providers = cctx.web?.fetchProviders;
            const providerIds = providers === undefined ? [] : [...providers.keys()];
            return { ok: true, value: { installed: providerIds.length > 0, providerIds } };
          }
          if (endpoint === 'profile-list') {
            return { ok: true, value: await endpoints.list() };
          }
          if (endpoint === 'profile-create') {
            return { ok: true, value: await runCreate(() => endpoints.create(payload)) };
          }
          if (endpoint === 'profile-save') {
            return { ok: true, value: await endpoints.save(payload) };
          }
          if (endpoint === 'profile-set-default') {
            return { ok: true, value: await endpoints.setDefault(payload) };
          }
          throw rpcError('NOT_FOUND', `unknown endpoint ${endpoint}`);
        } catch (error) {
          return { ok: false, error: { code: error?.code ?? 'INTERNAL', message: error?.message ?? String(error) } };
        }
      }, { authority: 'loopback' });
      log.info('omds-preset-seeder: /omds RPC registered');
    } catch (error) {
      log.warn(`omds-preset-seeder: /omds RPC registration failed (${error?.message ?? error}); card falls back to bundled-only`);
    }
  });
}

export function apply(ctx) {
  const log = {
    info: (message) => ctx.logger?.info?.(message),
    warn: (message) => ctx.logger?.warn?.(message),
    error: (message) => ctx.logger?.error?.(message),
  };
  try {
    const target = join(resolveHome(), '.agent-presets', PRESET_DIR_NAME);

    if (!existsSync(target)) {
      seedFresh(target, log);
      return;
    }
    if (existsSync(join(target, '.git'))) {
      log.info('omds-preset-seeder: preset directory is git-managed; leaving it untouched');
      return;
    }
    let marker;
    try {
      marker = JSON.parse(readFileSync(join(target, MARKER_FILE), 'utf8'));
    } catch {
      marker = undefined;
    }
    if (marker === undefined || typeof marker.seededVersion !== 'string') {
      log.warn(`omds-preset-seeder: "${target}" exists without a seed marker (installed manually?); leaving it untouched`);
      return;
    }
    if (compareVersions(bundledVersion, marker.seededVersion) <= 0) {
      log.info(`omds-preset-seeder: preset v${marker.seededVersion} is up to date (bundled v${bundledVersion})`);
      return;
    }
    // Upgrade: bundled is newer. The old directory is backed up wholesale, so
    // hand edits inside it survive in the backup; the sanctioned customization
    // channel (the user JSON outside this directory) is never touched.
    const backup = join(resolveHome(), '.agent-presets', `${PRESET_DIR_NAME}.bak-${stamp()}`);
    cpSync(target, backup, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    seedFresh(target, log);
    log.warn(`omds-preset-seeder: preset upgraded v${marker.seededVersion} → v${bundledVersion}; previous copy backed up at ${backup}`);
  } catch (error) {
    // The seeder must never break the DSH boot. Worst case: the preset is not
    // seeded this run and the error explains why.
    log.error?.(`omds-preset-seeder failed: ${error?.stack ?? String(error)}`);
  } finally {
    // finally, not fall-through: every seeding branch above exits apply with
    // an early return, and the settings namespace must register on ALL of
    // them (found by the seeder unit test's fresh-install scenario).
    wireSettings(ctx, log).catch((error) => {
      log.warn(`omds-preset-seeder: settings namespace unavailable (${error?.message ?? error}); legacy JSON channel stays active`);
    });
    wireOmdsRpc(ctx, log);
  }
}

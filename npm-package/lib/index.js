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
// Uninstalling this npm package does NOT remove the seeded preset directory.

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

export const name = 'omds-preset-seeder';

const PRESET_DIR_NAME = 'oh-my-dsh-slim';
const MARKER_FILE = '.omds-seed.json';
const bundledDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'preset');
const bundledVersion = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
).version;
// Registered as the namespace's BASE layer: resolved values = defaults ⊕ user
// overrides, so the settings card can distinguish "inherited default" from
// "explicit override" and reset falls back to exactly the shipped defaults.
// config-loader's own defaults merge stays idempotent over the resolved value.
const bundledDefaults = JSON.parse(readFileSync(join(bundledDir, 'defaults.json'), 'utf8'));

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
  }
}

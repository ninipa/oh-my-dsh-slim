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
// channel is the user JSON at <DSH_HOME>/oh-my-dsh-slim.json, which lives
// outside this directory and is never touched by upgrades. Hand edits inside
// the directory survive only through the timestamped backup.
//
// Uninstalling this npm package does NOT remove the seeded preset directory.

import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'omds-preset-seeder';

const PRESET_DIR_NAME = 'oh-my-dsh-slim';
const MARKER_FILE = '.omds-seed.json';
const bundledDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'preset');
const bundledVersion = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
).version;

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
  }
}

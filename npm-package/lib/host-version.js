// host-version.js — which DSH hosts this preset line supports, and how to tell.
//
// 0.6.0 (DSH 0.2.0-rc.2): the preset is no longer a directory under
// $DSH_HOME/.agent-presets/. DSH 0.2.0 made agent presets declarative: a plugin
// bundle ships a loader patch that inserts an
// '@deepseek-ai/dsh-agent-preset' row, whose config.plugins is the agent plane.
// The registry "neither scans directories nor accepts preset paths"
// (@deepseek-ai/dsh-agent-preset-registry/README), so a directory preset can
// never appear on that host again — which is exactly why 0.5.x refused to run.
//
// This module is therefore advisory, not a gate. The preset rows do not call
// assertHostCompatible(): an uncaught throw inside a preset row fails the whole
// mount, and a version probe is not worth that. Only the seeder plugin (which
// runs in the profile plane) reports a verdict, and it warns instead of
// throwing.

import { createRequire } from 'node:module';

/** Oldest DSH line this preset supports (0.1.2-rc.1 shipped the subagent API it uses). */
export const MIN_HOST_VERSION = '0.1.2-rc.1';

/**
 * First core version that removed directory agent presets. 0.2.0-rc.2 is below
 * it in semver order (a prerelease sorts before its release), so the whole
 * 0.2.0-rc line has to be allowed explicitly instead of by range endpoint.
 */
export const DECLARATIVE_PRESET_VERSION = '0.2.0';

/** Core versions this preset is known to work on, newest first. */
export const VERIFIED_HOST_VERSIONS = ['0.2.0-rc.2'];

/** Highest 0.1.x core version verified with the directory-preset model. */
export const LAST_DIRECTORY_PRESET_VERSION = '0.1.5-rc.2';

const SEMVER = /^([0-9]+)[.]([0-9]+)[.]([0-9]+)(?:-([0-9A-Za-z.-]+))?(?:[+][0-9A-Za-z.-]+)?$/;

/**
 * Parse the subset of semver this project compares: numeric core plus an
 * optional prerelease. Build metadata is ignored (semver precedence ignores it).
 * @param value - candidate version string.
 * @returns parsed parts, or undefined when the input is not a version.
 */
export function parseSemver(value) {
  if (typeof value !== 'string') return void 0;
  const match = SEMVER.exec(value.trim());
  if (!match) return void 0;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === void 0 ? [] : match[4].split('.'),
  };
}

/**
 * Compare two versions by semver precedence.
 * @param a - version string or parsed parts.
 * @param b - version string or parsed parts.
 * @returns negative when a < b, 0 when equal, positive when a > b, NaN when unparsable.
 */
export function compareSemver(a, b) {
  const left = typeof a === 'string' ? parseSemver(a) : a;
  const right = typeof b === 'string' ? parseSemver(b) : b;
  if (left === void 0 || right === void 0) return NaN;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  // A prerelease sorts before the associated release (semver section 11.3).
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === void 0) return -1;
    if (r === void 0) return 1;
    if (l === r) continue;
    const lNum = /^[0-9]+$/.test(l);
    const rNum = /^[0-9]+$/.test(r);
    if (lNum && rNum) return Number(l) < Number(r) ? -1 : 1;
    if (lNum) return -1;
    if (rNum) return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

/** Drop the prerelease suffix: '0.2.0-rc.2' -> '0.2.0'. */
export function coreVersion(version) {
  return typeof version === 'string' ? version.trim().split('-')[0] : '';
}

/**
 * Resolve the running DSH version from the host's own package manifest. The
 * preset shares a module graph with the host loader, so this resolves to the
 * host copy rather than any stale node_modules duplicate.
 * @returns the version string, or undefined when the host refuses to resolve.
 */
export function detectHostDshVersion() {
  const candidates = ['@deepseek-ai/dsh/package.json', '@deepseek-ai/dsh-app-boot/package.json'];
  const require = createRequire(import.meta.url);
  for (const specifier of candidates) {
    try {
      const manifest = require(specifier);
      if (typeof manifest?.version === 'string') return manifest.version;
    } catch {}
  }
  return void 0;
}

/**
 * Decide whether a host version is supported.
 * @param host - detected host version; undefined means "could not tell".
 * @returns { status, host, message } with status one of:
 *   'ok' (a verified host), 'older' (below MIN_HOST_VERSION),
 *   'legacy-preset-model' (>= 0.2.0 but not a verified prerelease),
 *   'directory' (0.1.6-0.1.x: declarative presets, unfitting seams),
 *   'unknown' (no version could be read).
 */
export function hostVerdict(host) {
  const parsed = parseSemver(host);
  if (parsed === void 0) {
    return {
      status: 'unknown',
      host,
      message:
        'oh-my-dsh-slim could not read the DSH version. The preset rows still mounted; '
        + 'if the role tools do not appear, check that DSH >= ' + MIN_HOST_VERSION + ' is running.',
    };
  }
  if (compareSemver(parsed, parseSemver(MIN_HOST_VERSION)) < 0) {
    return {
      status: 'older',
      host,
      message:
        'oh-my-dsh-slim requires DSH >= ' + MIN_HOST_VERSION + ' (this host: DSH ' + host + '). '
        + 'The role tools need the subagent composition seam that line introduced.',
    };
  }
  if (compareSemver(parsed, parseSemver(DECLARATIVE_PRESET_VERSION)) >= 0) {
    return {
      status: 'legacy-preset-model',
      host,
      message:
        'oh-my-dsh-slim was verified against DSH ' + VERIFIED_HOST_VERSIONS.join(', ')
        + ' (this host: DSH ' + host + '). The declarative preset seam is expected to be '
        + 'compatible; please report anything that is not.',
    };
  }
  if (compareSemver(parsed, parseSemver(LAST_DIRECTORY_PRESET_VERSION)) > 0) {
    return {
      status: 'directory',
      host,
      message:
        'oh-my-dsh-slim 0.6.x ships a declarative preset for DSH >= ' + DECLARATIVE_PRESET_VERSION
        + ' (this host: DSH ' + host + '). The 0.1.6-0.1.x line declares presets by bundle patch '
        + 'but predates the seams this preset uses. Use oh-my-dsh-slim 0.5.x on DSH <= '
        + LAST_DIRECTORY_PRESET_VERSION + ', or upgrade to DSH ' + VERIFIED_HOST_VERSIONS[0] + '.',
    };
  }
  return { status: 'ok', host, message: void 0 };
}

/**
 * Legacy advisory gate. Preset rows never call it (see the header); it exists
 * for the seeder and for callers that already handle a throw.
 * @param options - optional version override.
 * @returns the verdict when compatible.
 * @throws when the host is outside the supported range.
 */
export function assertHostCompatible(options = {}) {
  if (process.env.OMDS_ALLOW_OLD_HOST === '1' || process.env.OMDS_ALLOW_NEW_HOST === '1') {
    return { status: 'forced', host: options.version ?? detectHostDshVersion(), message: void 0 };
  }
  const verdict = hostVerdict(options.version ?? detectHostDshVersion());
  if (verdict.status === 'ok' || verdict.status === 'unknown') return verdict;
  throw new Error(verdict.message);
}

export default {
  MIN_HOST_VERSION,
  DECLARATIVE_PRESET_VERSION,
  VERIFIED_HOST_VERSIONS,
  LAST_DIRECTORY_PRESET_VERSION,
  parseSemver,
  compareSemver,
  coreVersion,
  detectHostDshVersion,
  hostVerdict,
  assertHostCompatible,
};

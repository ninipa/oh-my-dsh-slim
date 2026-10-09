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
// Known unsupported hosts are rejected before the companion accesses host
// services. An unreadable host version remains fail-open; version admission is
// an upgrade policy, not a guarantee that unverified hosts expose future APIs.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { hostBaseUrl } from '../preset/bridge.js';

/** Minimum host for this declarative preset line. */
export const MIN_HOST_VERSION = '0.2.0-rc.2';
export const MAX_HOST_VERSION_EXCLUSIVE = '0.3.0-0';

/**
 * Stable core version of the declarative preset line. Admission uses the
 * prerelease-aware minimum above, not this stable core marker.
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
export function detectHostDshVersion({ ctx, entry = process.argv[1], resolveManifest } = {}) {
  const candidates = ['@deepseek-ai/dsh/package.json', '@deepseek-ai/dsh-app-boot/package.json'];
  let loader;
  // A companion context may not inject loader; its running entry still anchors
  // the host. Do not turn an unavailable service into a version-probe failure.
  try { loader = ctx?.loader; } catch {}
  let require;
  try {
    const base = loader?.config?.bareModuleBaseUrl ?? hostBaseUrl()
      ?? loader?.ctx?.baseUrl ?? loader?.config?.baseUrl
      ?? (entry ? pathToFileURL(entry).href : undefined);
    if (!base) return undefined;
    require = resolveManifest ?? createRequire(base);
  } catch { return undefined; }
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
 *   'ok' (admitted by the package range, not necessarily verified),
 *   'older' (below MIN_HOST_VERSION), 'unsupported' (outside upgrade policy),
 *   'unknown' (no version could be read).
 */
export function hostVerdict(host = detectHostDshVersion()) {
  const parsed = parseSemver(host);
  if (parsed === void 0) {
    return {
      status: 'unknown',
      host,
      message:
        'oh-my-dsh-slim could not read the DSH version; version checking is fail-open. '
        + 'Check that DSH >= ' + MIN_HOST_VERSION + ' is running if native preset services are unavailable.',
    };
  }
  if (compareSemver(parsed, MIN_HOST_VERSION) < 0) {
    return {
      status: 'older',
      host,
      message:
        'oh-my-dsh-slim requires DSH >= ' + MIN_HOST_VERSION + ' (this host: DSH ' + host + '). '
        + 'For DSH <=0.1.5 use oh-my-dsh-slim@0.5.3; otherwise upgrade DSH to '
        + MIN_HOST_VERSION + ' or a host admitted by >= ' + MIN_HOST_VERSION + ' < ' + MAX_HOST_VERSION_EXCLUSIVE + '.',
    };
  }
  // Match npm's default prerelease admission: a comparator naming 0.2.0-rc.2
  // admits later 0.2.0 prereleases, not prereleases of later patch versions.
  if (compareSemver(parsed, MAX_HOST_VERSION_EXCLUSIVE) >= 0
      || (parsed.prerelease.length > 0 && (parsed.major !== 0 || parsed.minor !== 2 || parsed.patch !== 0))) {
    return {
      status: 'unsupported',
      host,
      message:
        'oh-my-dsh-slim admits DSH >= ' + MIN_HOST_VERSION + ' < ' + MAX_HOST_VERSION_EXCLUSIVE
        + ' (this host: DSH ' + host + '). Only DSH ' + VERIFIED_HOST_VERSIONS.join(', ')
        + ' is verified; use an admitted host or a plugin release that explicitly supports this host.',
    };
  }
  return { status: 'ok', host, message: void 0 };
}

/**
 * Reject known unsupported hosts before native service access. An unreadable
 * host remains fail-open, and the existing explicit environment overrides remain.
 * @param options - optional version override.
 * @returns the verdict when compatible.
 * @throws when the host is outside the supported range.
 */
export function assertHostCompatible(options = {}) {
  if (process.env.OMDS_ALLOW_OLD_HOST === '1' || process.env.OMDS_ALLOW_NEW_HOST === '1') {
    return { status: 'forced', host: options.version ?? detectHostDshVersion(options), message: void 0 };
  }
  const verdict = hostVerdict(options.version ?? detectHostDshVersion(options));
  if (verdict.status === 'ok' || verdict.status === 'unknown') return verdict;
  throw new Error(verdict.message);
}

/** Check the required native registry before any register() call. */
export function assertNativePresetRegistry(ctx) {
  const verdict = assertHostCompatible({ ctx });
  if (typeof ctx?.agentPresets?.register !== 'function') {
    throw new Error('oh-my-dsh-slim requires the native agent preset registry on DSH >= '
      + MIN_HOST_VERSION + '. For DSH <=0.1.5 use oh-my-dsh-slim@0.5.3; '
      + 'otherwise upgrade DSH and enable its native agent preset registry.');
  }
  return verdict;
}

export default {
  MIN_HOST_VERSION,
  MAX_HOST_VERSION_EXCLUSIVE,
  assertNativePresetRegistry,
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

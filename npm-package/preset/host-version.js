// host-version.js — shared host-DSH compatibility gate for the preset plugins.
//
// This preset targets DSH 0.1.2-rc.1+ (0.1.2 removed/changed APIs the preset
// depends on: registerContinuableSetup, the agent/inbox/inserted event
// vocabulary, the native agent-presets authoring API). On older hosts the
// preset must fail fast with a readable error instead of mounting
// half-working: every plugin row calls assertHostCompatible() at module load,
// and one throw aborts the whole preset mount (cordis fail-fast).
//
// Policy details:
// - Undetectable host version → fail-open. The bare-specifier resolution only
//   works when @deepseek-ai/dsh is a sibling package (the real profile
//   layout); unusual layouts are not proof of an old host, and guessing would
//   break valid setups.
// - Escape hatch for tests/CI on pinned old hosts: OMDS_ALLOW_OLD_HOST=1.

import { createRequire } from 'node:module';

export const MIN_HOST_VERSION = '0.1.2-rc.1';

/**
 * Full semver comparison with prerelease support (numeric-major/minor/patch,
 * then prerelease identifiers: release > prerelease, numeric identifiers
 * compare numerically, otherwise lexically). Returns <0 / 0 / >0.
 */
export function compareSemver(a, b) {
  const parse = (v) => {
    const [core, pre = ''] = String(v).split('-');
    const [maj, min, pat] = core.split('.').map((n) => parseInt(n, 10) || 0);
    return { maj, min, pat, ids: pre === '' ? [] : pre.split('.') };
  };
  const x = parse(a);
  const y = parse(b);
  for (const k of ['maj', 'min', 'pat']) {
    if (x[k] !== y[k]) return x[k] - y[k];
  }
  if (x.ids.length === 0 && y.ids.length === 0) return 0;
  if (x.ids.length === 0) return 1;
  if (y.ids.length === 0) return -1;
  for (let i = 0; i < Math.max(x.ids.length, y.ids.length); i++) {
    const xi = x.ids[i];
    const yi = y.ids[i];
    if (xi === undefined) return -1;
    if (yi === undefined) return 1;
    const xn = /^\d+$/.test(xi);
    const yn = /^\d+$/.test(yi);
    if (xn && yn) {
      const d = Number(xi) - Number(yi);
      if (d !== 0) return d;
    } else if (xn) {
      return -1;
    } else if (yn) {
      return 1;
    } else if (xi !== yi) {
      return xi < yi ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Best-effort host DSH version. Resolves @deepseek-ai/dsh/package.json as a
 * sibling of this package (the real profile layout). Returns undefined when
 * the host package cannot be resolved — callers treat that as "unknown" and
 * fail open.
 */
export function detectHostDshVersion() {
  try {
    return createRequire(import.meta.url)('@deepseek-ai/dsh/package.json').version;
  } catch {
    return undefined;
  }
}

/**
 * Throw when the host is older than the supported minimum. `options.version`
 * overrides detection (unit tests); `options.minVersion` overrides the floor.
 * Returns the host version when compatible, undefined when unknown.
 */
export function assertHostCompatible(options = {}) {
  if (process.env.OMDS_ALLOW_OLD_HOST === '1') return undefined;
  const minVersion = options.minVersion ?? MIN_HOST_VERSION;
  const host = options.version ?? detectHostDshVersion();
  if (host === undefined) return undefined;
  if (compareSemver(host, minVersion) < 0) {
    throw new Error(
      `oh-my-dsh-slim requires DSH >= ${minVersion} (this host: DSH ${host}). ` +
      'The preset will not mount half-working: upgrade DSH to 0.1.2-rc.1 or newer, ' +
      'or use oh-my-dsh-slim 0.4.0, the last release for older DSH lines.',
    );
  }
  return host;
}

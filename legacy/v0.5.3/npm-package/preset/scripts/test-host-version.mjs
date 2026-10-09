// Zero-cost unit test for the host-version compatibility gate
// (../host-version.js): semver comparison with prerelease semantics, the
// fail-fast/fail-open policy of assertHostCompatible, and detection shape.
import { readFileSync } from 'node:fs';
import {
  MIN_HOST_VERSION,
  MAX_HOST_VERSION_EXCLUSIVE,
  assertHostCompatible,
  compareSemver,
  detectHostDshVersion,
} from '../host-version.js';

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => console.log(`  FAIL  ${msg}`);
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const throwsWith = (fn, needles, msg) => {
  try {
    fn();
    fail(`${msg} (did not throw)`);
  } catch (error) {
    check(needles.every((n) => error.message.includes(n)), `${msg} (message mentions ${needles.join(' / ')})`);
  }
};

console.log('\n[compareSemver: core ordering]');
const coreCases = [
  ['0.1.1', '0.1.2-rc.1', -1],
  ['0.1.2-rc.1', '0.1.1', 1],
  ['0.1.2-rc.1', '0.1.2-rc.1', 0],
  ['0.1.2-rc.2', '0.1.2-rc.1', 1],
  ['0.1.2', '0.1.2-rc.1', 1],
  ['0.1.2', '0.1.2-rc.2', 1],
  ['0.1.2-alpha.1', '0.1.2-rc.1', -1],
  ['0.1.2-beta.1', '0.1.2-rc.1', -1],
  ['0.2.0', '0.1.2-rc.1', 1],
  ['0.1.10', '0.1.9', 1],
  ['0.1.2-rc.10', '0.1.2-rc.9', 1],
  ['0.1.2-rc.1.1', '0.1.2-rc.1', 1],
  ['0.10.0', '0.9.9', 1],
];
for (const [a, b, want] of coreCases) {
  const got = compareSemver(a, b);
  check(Math.sign(got) === want, `compareSemver(${a}, ${b}) = ${want}`);
}

console.log('\n[compareSemver: prerelease identifier typing]');
check(compareSemver('0.1.2-1', '0.1.2-alpha') < 0, 'numeric identifier sorts before alphanumeric');
check(compareSemver('0.1.2-rc.2.1', '0.1.2-rc.2') > 0, 'longer prerelease is newer when prefix equal');

console.log('\n[assertHostCompatible: fail-fast on old hosts]');
throwsWith(
  () => assertHostCompatible({ version: '0.1.1' }),
  ['>= 0.1.2-rc.1', '0.1.1', '0.4.0'],
  'old host throws with upgrade guidance',
);
throwsWith(
  () => assertHostCompatible({ version: '0.1.2-alpha.9' }),
  ['requires DSH'],
  'prerelease older than the floor throws',
);
throwsWith(
  () => assertHostCompatible({ version: '0.1.1', minVersion: '0.1.2-rc.2' }),
  ['>= 0.1.2-rc.2'],
  'custom floor is honored',
);

console.log('\n[assertHostCompatible: pass paths]');
check(assertHostCompatible({ version: '0.1.2-rc.1' }) === '0.1.2-rc.1', 'exact floor passes');
check(assertHostCompatible({ version: '0.1.2' }) === '0.1.2', 'release newer than prerelease floor passes');
check(assertHostCompatible({ version: '0.1.5-rc.2' }) === '0.1.5-rc.2', 'latest verified host passes');
check(assertHostCompatible({ version: '0.1.5' }) === '0.1.5', 'the last allowed line passes, prerelease or not');
check(assertHostCompatible({ version: '0.1.6-alpha.1', maxExclusiveVersion: '0.1.7' }) === '0.1.6-alpha.1',
  'custom ceiling is honored (0.1.6 allowed when the ceiling is 0.1.7)');
check(assertHostCompatible({ version: undefined }) === undefined, 'undetectable version fails open (no throw)');
throwsWith(
  () => assertHostCompatible({ version: '0.1.1' }),
  ['requires DSH'],
  'explicit version overrides an undetectable host (throws, proving the override path)',
);

console.log('\n[assertHostCompatible: fail-fast at and above the ceiling]');
// 2026-09-28: DSH 0.1.7 replaced directory agent presets with declarative ones
// declared by plugin bundles, so this preset line would install and then never
// appear. The ceiling turns that silent no-op into a readable refusal — and it
// is a LINE boundary: the whole 0.1.6 line is refused, prereleases included
// (the first cut compared with full semver, which let 0.1.6-alpha.1 through).
throwsWith(
  () => assertHostCompatible({ version: '0.1.7-rc.2' }),
  ['< 0.1.6', '0.1.7-rc.2', 'declarative', '0.1.5-rc.2'],
  'the declarative-preset host line is refused with the reason and the fix',
);
throwsWith(
  () => assertHostCompatible({ version: '0.1.6-alpha.1' }),
  ['< 0.1.6'],
  'a 0.1.6 prerelease is refused too (prerelease must not slip under the ceiling)',
);
throwsWith(
  () => assertHostCompatible({ version: '0.1.6-rc.1' }),
  ['< 0.1.6'],
  'any 0.1.6 prerelease is refused',
);
throwsWith(
  () => assertHostCompatible({ version: '0.1.6' }),
  ['< 0.1.6'],
  'the 0.1.6 release itself is refused',
);
throwsWith(
  () => assertHostCompatible({ version: '0.2.0-rc.1' }),
  ['< 0.1.6'],
  'later lines are refused (the ceiling is not a 0.1.x special case)',
);

console.log('\n[assertHostCompatible: escape hatch]');
process.env.OMDS_ALLOW_OLD_HOST = '1';
try {
  check(assertHostCompatible({ version: '0.1.1' }) === undefined, 'OMDS_ALLOW_OLD_HOST=1 disables the floor');
  let ceilingHeld = false;
  try { assertHostCompatible({ version: '0.1.7-rc.2' }); } catch { ceilingHeld = true; }
  check(ceilingHeld, 'the floor hatch does NOT waive the ceiling (one hatch per direction)');
} finally {
  delete process.env.OMDS_ALLOW_OLD_HOST;
}
process.env.OMDS_ALLOW_NEW_HOST = '1';
try {
  check(assertHostCompatible({ version: '0.1.7-rc.2' }) === undefined, 'OMDS_ALLOW_NEW_HOST=1 disables the ceiling (probe work)');
} finally {
  delete process.env.OMDS_ALLOW_NEW_HOST;
}
throwsWith(
  () => assertHostCompatible({ version: '0.1.1' }),
  ['requires DSH'],
  'gate re-armed after the escape hatch is removed',
);

console.log('\n[detectHostDshVersion: shape]');
const detected = detectHostDshVersion();
check(detected === undefined || typeof detected === 'string', 'detection returns a version string or undefined');
// In this dev workspace @deepseek-ai/dsh may or may not be resolvable from the
// preset root; both outcomes are legal. The seeder/probe suites cover the
// resolved-host behavior against a real install.
if (detected !== undefined) {
  check(compareSemver(detected, '0.0.1') > 0, `detected host version "${detected}" parses as a semver`);
}

console.log('\n[exported bounds match the release policy]');
check(MIN_HOST_VERSION === '0.1.2-rc.1', 'MIN_HOST_VERSION is 0.1.2-rc.1');
check(MAX_HOST_VERSION_EXCLUSIVE === '0.1.6', 'MAX_HOST_VERSION_EXCLUSIVE is 0.1.6 (the declarative-preset line starts at 0.1.7)');
const pkg = JSON.parse(readFileSync(new URL('../npm-package/package.json', import.meta.url), 'utf8'));
check(pkg.engines?.dsh === `>=${MIN_HOST_VERSION} <${MAX_HOST_VERSION_EXCLUSIVE}`, 'npm engines.dsh declares the same range');
for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
  const floor = name === '@deepseek-ai/schemastery' ? '>=0.1.0-rc.7' : `>=${MIN_HOST_VERSION} <${MAX_HOST_VERSION_EXCLUSIVE}`;
  check(range.includes(floor), `peer ${name} declares its compatibility range (${floor})`);
  check(pkg.peerDependenciesMeta?.[name]?.optional === true, `peer ${name} is optional (pnpm auto-install must never pull host packages)`);
}

console.log(failures === 0 ? '\nHOST-VERSION: ALL CHECKS PASSED' : `\nHOST-VERSION: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

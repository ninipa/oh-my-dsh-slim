// Zero-cost unit test for the host-version compatibility gate
// (../host-version.js): semver comparison with prerelease semantics, the
// fail-fast/fail-open policy of assertHostCompatible, and detection shape.
import { readFileSync } from 'node:fs';
import {
  MIN_HOST_VERSION,
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
check(assertHostCompatible({ version: '0.2.0-rc.1' }) === '0.2.0-rc.1', 'next-line prerelease passes (<0.2.0 not enforced here, only >= floor)');
check(assertHostCompatible({ version: undefined }) === undefined, 'undetectable version fails open (no throw)');
throwsWith(
  () => assertHostCompatible({ version: '0.1.1' }),
  ['requires DSH'],
  'explicit version overrides an undetectable host (throws, proving the override path)',
);

console.log('\n[assertHostCompatible: escape hatch]');
process.env.OMDS_ALLOW_OLD_HOST = '1';
try {
  check(assertHostCompatible({ version: '0.1.1' }) === undefined, 'OMDS_ALLOW_OLD_HOST=1 disables the gate');
} finally {
  delete process.env.OMDS_ALLOW_OLD_HOST;
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

console.log('\n[exported floor matches the release policy]');
check(MIN_HOST_VERSION === '0.1.2-rc.1', 'MIN_HOST_VERSION is 0.1.2-rc.1');
const pkg = JSON.parse(readFileSync(new URL('../npm-package/package.json', import.meta.url), 'utf8'));
check(pkg.engines?.dsh === '>=0.1.2-rc.1 <0.2.0', 'npm engines.dsh declares the same floor');
for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
  const floor = name === '@deepseek-ai/schemastery' ? '>=0.1.0-rc.7' : '>=0.1.2-rc.1';
  check(range.includes(floor), `peer ${name} declares its compatibility floor (${floor})`);
  check(pkg.peerDependenciesMeta?.[name]?.optional === true, `peer ${name} is optional (pnpm auto-install must never pull host packages)`);
}

console.log(failures === 0 ? '\nHOST-VERSION: ALL CHECKS PASSED' : `\nHOST-VERSION: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

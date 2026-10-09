import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import semver from 'semver';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  MIN_HOST_VERSION, MAX_HOST_VERSION_EXCLUSIVE, VERIFIED_HOST_VERSIONS,
  compareSemver, hostVerdict, assertHostCompatible, detectHostDshVersion,
  assertNativePresetRegistry,
} from '../npm-package/lib/host-version.js';

const range = '>=0.2.0-rc.2 <0.3.0-0';
const admitted = ['0.2.0-rc.2', '0.2.0-rc.3', '0.2.0-rc.10', '0.2.0', '0.2.1', '0.2.99'];
const rejected = ['0.1.2-rc.1', '0.1.5-rc.2', '0.1.5', '0.1.6', '0.2.0-alpha.9', '0.2.0-rc.1', '0.2.1-rc.1', '0.3.0-0', '0.3.0-rc.1', '0.3.0', '1.0.0'];

test('both manifests declare the bounded upgrade policy for engines and all eight peers', () => {
  assert.equal(MIN_HOST_VERSION, '0.2.0-rc.2');
  assert.equal(MAX_HOST_VERSION_EXCLUSIVE, '0.3.0-0');
  assert.deepEqual(VERIFIED_HOST_VERSIONS, ['0.2.0-rc.2']);
  for (const file of ['../package.json', '../npm-package/package.json']) {
    const manifest = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
    assert.equal(manifest.engines.dsh, range);
    if (manifest.peerDependencies) {
      assert.equal(Object.keys(manifest.peerDependencies).length, 8);
      for (const peerRange of Object.values(manifest.peerDependencies)) assert.equal(peerRange, range);
    }
  }
});

test('effective gate respects prerelease ordering and npm default prerelease admission', () => {
  assert.equal(compareSemver('0.2.0-rc.10', '0.2.0-rc.2'), 1);
  assert.equal(compareSemver('0.2.0-rc.2+build.1', '0.2.0-rc.2'), 0);
  for (const version of admitted) {
    assert.equal(hostVerdict(version).status, 'ok', version);
    assert.equal(assertHostCompatible({ version }).status, 'ok', version);
  }
  for (const version of rejected) {
    assert.notEqual(hostVerdict(version).status, 'ok', version);
    assert.throws(() => assertHostCompatible({ version }), /oh-my-dsh-slim/, version);
  }
  assert.equal(hostVerdict('not-a-version').status, 'unknown');
  assert.equal(assertHostCompatible({ version: 'not-a-version' }).status, 'unknown');
  assert.match(hostVerdict('0.1.5').message, /DSH <=0\.1\.5 use oh-my-dsh-slim@0\.5\.3/);
  assert.doesNotMatch(hostVerdict('0.3.0').message, /expected to be compatible/);
});

// Pinned development-only dependency: this check must run on clean checkouts.
test('actual npm semver admits rc.3 but not later-patch or 0.3 prereleases', () => {
  for (const version of [...admitted, ...rejected]) {
    assert.equal(semver.satisfies(version, range), hostVerdict(version).status === 'ok', version);
  }
});

function fixture(version) {
  const root = mkdtempSync(join(tmpdir(), 'omds-host-version-'));
  const packageDir = join(root, 'node_modules', '@deepseek-ai', 'dsh');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ version }));
  const entry = join(root, 'entry.js');
  const ctx = { loader: { config: { bareModuleBaseUrl: pathToFileURL(entry).href } } };
  return { root, entry, ctx };
}

test('detection anchors to the native loader or running entry, not plugin-local peers', () => {
  const host = fixture('0.2.0-rc.3');
  try {
    assert.equal(detectHostDshVersion({ ctx: host.ctx }), '0.2.0-rc.3');
    assert.equal(detectHostDshVersion({ entry: host.entry }), '0.2.0-rc.3');
    assert.equal(assertHostCompatible({ ctx: host.ctx }).status, 'ok');
    assert.equal(detectHostDshVersion({ ctx: { get loader() { throw Error('not injected'); } }, entry: host.entry }), '0.2.0-rc.3');
    assert.equal(detectHostDshVersion({ ctx: { loader: { config: { bareModuleBaseUrl: 'https://invalid/' } } } }), undefined);
    assert.equal(detectHostDshVersion({ entry: undefined, resolveManifest: () => { throw Error('missing'); } }), undefined);
  } finally { rmSync(host.root, { recursive: true, force: true }); }
});

test('all startup rows reject old hosts before effects, settings or registry access', async () => {
  const host = fixture('0.1.5');
  try {
    for (const file of ['../npm-package/preset/preset.js', '../npm-package/lib/profile-registry.js', '../npm-package/lib/index.js']) {
      const { apply } = await import(file);
      const ctx = { ...host.ctx,
        effect: () => assert.fail('effect accessed before version guidance'),
        inject: () => assert.fail('settings accessed before version guidance'),
        get agentPresets() { assert.fail('registry accessed before version guidance'); },
      };
      assert.throws(() => apply(ctx), /DSH <=0\.1\.5 use oh-my-dsh-slim@0\.5\.3/, file);
    }
  } finally { rmSync(host.root, { recursive: true, force: true }); }
});

test('unknown host without native register receives actionable guidance', () => {
  assert.throws(() => assertNativePresetRegistry({}), /native agent preset registry.*DSH >= 0\.2\.0-rc\.2.*oh-my-dsh-slim@0\.5\.3/);
});

test('explicit legacy environment overrides remain available', () => {
  for (const name of ['OMDS_ALLOW_OLD_HOST', 'OMDS_ALLOW_NEW_HOST']) {
    const previous = process.env[name];
    process.env[name] = '1';
    try { assert.equal(assertHostCompatible({ version: '0.1.5' }).status, 'forced'); }
    finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
  }
});

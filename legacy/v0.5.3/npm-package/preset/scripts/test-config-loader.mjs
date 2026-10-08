// Zero-cost configuration loader test. Verifies user overrides are merged by
// role id and that hidden runtime defaults remain available after model/token
// changes.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resetConfigForTests, validateConfigDocument } from '../config-loader.js';

// Expected values come from the bundled defaults (single source of truth), so
// the test stays valid across the private/public defaults forks.
const bundledDefaults = JSON.parse(readFileSync(new URL('../defaults.json', import.meta.url), 'utf8'));
const bundledOracleModel = bundledDefaults.presets[bundledDefaults.preset].oracle.model;

const home = mkdtempSync(join(tmpdir(), 'oh-my-dsh-slim-config-'));
const path = join(home, 'oh-my-dsh-slim.json');
writeFileSync(path, JSON.stringify({
  preset: 'custom',
  presets: {
    custom: {
      librarian: {
        model: 'user-model',
        effort: 'medium',
        mcps: ['context7'],
        tools: ['read', 'glob', 'grep', 'web_search']
      },
      observer: {
        enabled: true
      }
    }
  },
  advanced: { roles: { librarian: { maxTokens: 12345, temperature: 0.25 } } }
}));

const previous = process.env.OH_MY_DSH_SLIM_CONFIG;
process.env.OH_MY_DSH_SLIM_CONFIG = path;
resetConfigForTests();
try {
  const config = loadConfig();
  const librarian = config.roles.librarian;
  if (librarian.model !== 'user-model' || librarian.effort !== 'medium' || librarian.maxTokens !== 12345 || librarian.temperature !== 0.25) {
    throw new Error(`override did not merge by role id: ${JSON.stringify(librarian)}`);
  }
  if (config.roles.oracle.maxTokens !== 128000 || config.roles.oracle.temperature !== 0.1) {
    throw new Error('unmodified roles lost bundled runtime defaults');
  }
  // Soft-disable: observer is force-locked off even when a user flips it on.
  if (config.roles.observer.enabled !== false) {
    throw new Error(`observer force-disable broken: ${JSON.stringify(config.roles.observer.enabled)}`);
  }
  for (const roleId of ['oracle', 'designer', 'fixer', 'explorer', 'librarian']) {
    if (config.roles[roleId].enabled !== true) {
      throw new Error(`role "${roleId}" lost default enabled=true`);
    }
  }
  console.log('observer force-lock + enabled defaults verified');
  console.log('CONFIG LOADER: ALL CHECKS PASSED');
} finally {
  if (previous === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
  else process.env.OH_MY_DSH_SLIM_CONFIG = previous;
  resetConfigForTests();
  rmSync(home, { recursive: true, force: true });
}

// Error paths fail loud with actionable messages.
function expectLoadError(label, body, match) {
  const errHome = mkdtempSync(join(tmpdir(), 'oh-my-dsh-slim-err-'));
  const errPath = join(errHome, 'oh-my-dsh-slim.json');
  writeFileSync(errPath, body);
  const prevEnv = process.env.OH_MY_DSH_SLIM_CONFIG;
  process.env.OH_MY_DSH_SLIM_CONFIG = errPath;
  resetConfigForTests();
  try {
    loadConfig();
    throw new Error(`${label}: expected loadConfig to throw`);
  } catch (error) {
    if (!match.test(error.message)) throw new Error(`${label}: unexpected error: ${error.message}`);
    console.log(`  PASS  ${label}`);
  } finally {
    if (prevEnv === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
    else process.env.OH_MY_DSH_SLIM_CONFIG = prevEnv;
    resetConfigForTests();
    rmSync(errHome, { recursive: true, force: true });
  }
}
console.log('\n[error paths]');
try {
  expectLoadError('malformed user JSON', '{oops', /invalid JSON configuration/);
  expectLoadError('unknown preset name', JSON.stringify({ preset: 'nope' }), /unknown preset "nope"/);
  expectLoadError(
    'mcps references unknown server',
    JSON.stringify({ presets: { 'my-dsh-normal': { librarian: { mcps: ['ghost'] } } } }),
    /unknown MCP server/,
  );
} finally {
  resetConfigForTests();
}

// Settings-namespace path: the seeder registers "oh-my-dsh-slim" and the
// loader reads the host's resolved (deep-frozen) snapshot per call.
console.log('\n[settings namespace]');
const previousHome = process.env.DSH_HOME;
delete process.env.DSH_HOME;
delete process.env.OH_MY_DSH_SLIM_CONFIG;
try {
  const section = Object.freeze({
    presets: Object.freeze({
      'my-dsh-normal': Object.freeze({
        librarian: Object.freeze({ model: 'settings-model', effort: 'low' }),
      }),
    }),
    advanced: Object.freeze({ roles: Object.freeze({ librarian: Object.freeze({ maxTokens: 12345, temperature: 0.25 }) }) }),
  });
  let current = section;
  const ctx = { settings: { get: (ns) => (ns === 'oh-my-dsh-slim' ? current : undefined) } };

  const fromSettings = loadConfig(ctx);
  if (fromSettings.roles.librarian.model !== 'settings-model' || fromSettings.roles.librarian.effort !== 'low') {
    throw new Error(`settings section did not merge: ${JSON.stringify(fromSettings.roles.librarian)}`);
  }
  if (fromSettings.roles.librarian.maxTokens !== 12345 || fromSettings.roles.librarian.temperature !== 0.25) {
    throw new Error('settings path lost advanced.roles runtime overrides');
  }
  if (fromSettings.source !== 'settings:oh-my-dsh-slim') throw new Error(`wrong source: ${fromSettings.source}`);
  console.log('  PASS  frozen settings section merges by role id (host snapshot semantics)');

  if (loadConfig(ctx).roles.oracle.model !== bundledOracleModel) throw new Error('untouched roles lost bundled defaults on the settings path');
  console.log('  PASS  untouched roles keep bundled defaults on the settings path');

  // Hot re-read: no cache between calls.
  current = Object.freeze({ presets: { 'my-dsh-normal': { librarian: { model: 'updated-model' } } } });
  if (loadConfig(ctx).roles.librarian.model !== 'updated-model') throw new Error('settings section is cached; hot updates lost');
  console.log('  PASS  settings section is re-read per call (hot updates apply)');

  // Unregistered namespace (get → undefined) falls back to the legacy file.
  const legacyHome = mkdtempSync(join(tmpdir(), 'oh-my-dsh-slim-setcfg-'));
  writeFileSync(join(legacyHome, 'oh-my-dsh-slim.json'), JSON.stringify({
    presets: { 'my-dsh-normal': { fixer: { model: 'legacy-model' } } },
  }));
  process.env.DSH_HOME = legacyHome;
  const fallbackCtx = { settings: { get: () => undefined } };
  if (loadConfig(fallbackCtx).roles.fixer.model !== 'legacy-model') throw new Error('legacy fallback broken when namespace is unregistered');
  if (loadConfig({}).roles.fixer.model !== 'legacy-model') throw new Error('legacy fallback broken without any ctx');
  console.log('  PASS  unregistered namespace and ctx-less calls fall back to the legacy file');

  // Explicit env channel still wins over everything.
  const envPath = join(legacyHome, 'env-override.json');
  writeFileSync(envPath, JSON.stringify({ presets: { 'my-dsh-normal': { fixer: { model: 'env-model' } } } }));
  process.env.OH_MY_DSH_SLIM_CONFIG = envPath;
  resetConfigForTests();
  if (loadConfig(ctx).roles.fixer.model !== 'env-model') throw new Error('env test channel no longer wins over settings');
  console.log('  PASS  OH_MY_DSH_SLIM_CONFIG test channel wins over the settings namespace');

  // Schemastery resolves omitted array fields in the user document to [] —
  // the host fills them into the settings snapshot. An empty tools list must
  // normalize back to unset (deny-only), or role-subagent would hand the
  // child `allow: []` and tools.restrict() would reject every inherited tool
  // (the 2026-08-27 "unknown tool" regression).
  delete process.env.OH_MY_DSH_SLIM_CONFIG;
  current = Object.freeze({
    presets: Object.freeze({
      'my-dsh-normal': Object.freeze({
        librarian: Object.freeze({ model: 'x', tools: [], deny: [], mcps: [] }),
      }),
    }),
  });
  resetConfigForTests();
  const emptyTools = loadConfig(ctx).roles.librarian;
  if (emptyTools.tools !== undefined) throw new Error(`empty tools list must normalize to unset, got ${JSON.stringify(emptyTools.tools)}`);
  if (emptyTools.model !== 'x') throw new Error('schemastery-empty section lost its other fields');
  console.log('  PASS  empty tools list from the settings snapshot normalizes to unset');

  // Per-preset profile snapshots: a custom native preset directory carries its
  // own profile.json, and the loader must read ONLY that document — the global
  // settings namespace and legacy JSON belong to the bundled preset, and
  // leaking them into a profile would break per-profile isolation.
  delete process.env.OH_MY_DSH_SLIM_CONFIG;
  delete process.env.DSH_HOME;
  const snapshotHome = mkdtempSync(join(tmpdir(), 'oh-my-dsh-slim-snap-'));
  writeFileSync(join(snapshotHome, 'profile.json'), JSON.stringify({
    preset: 'my-dsh-normal',
    roles: { fixer: { model: 'snapshot-model', effort: 'max' } },
    webFetch: true,
    advanced: { roles: { fixer: { maxTokens: 98765 } } },
  }));
  const prevProfileDir = process.env.OH_MY_DSH_SLIM_PROFILE_DIR;
  process.env.OH_MY_DSH_SLIM_PROFILE_DIR = snapshotHome;
  resetConfigForTests();
  const snap = loadConfig({});
  if (snap.roles.fixer.model !== 'snapshot-model' || snap.roles.fixer.effort !== 'max' || snap.roles.fixer.maxTokens !== 98765) {
    throw new Error(`profile snapshot role overrides did not merge: ${JSON.stringify(snap.roles.fixer)}`);
  }
  if (snap.roles.oracle.model !== bundledOracleModel) throw new Error('untouched roles lost bundled defaults in a profile snapshot');
  if (snap.webFetch !== undefined) throw new Error('legacy webFetch key in a profile snapshot is ignored (follows host default)');
  if (snap.source !== `profile snapshot: ${join(snapshotHome, 'profile.json')}`) throw new Error(`wrong source: ${snap.source}`);
  if (!Object.isFrozen(snap) || !Object.isFrozen(snap.roles.fixer)) throw new Error('profile snapshot is not immutable');
  console.log('  PASS  profile.json snapshot merges by role id with frozen results');

  // Isolation: the global settings section (bundled channel) must NOT leak.
  current = Object.freeze({ presets: { 'my-dsh-normal': Object.freeze({ fixer: Object.freeze({ model: 'leaked-global' }) }) } });
  resetConfigForTests();
  if (loadConfig(ctx).roles.fixer.model !== 'snapshot-model') throw new Error('global settings leaked into a profile snapshot');
  console.log('  PASS  global settings namespace does not leak into profile snapshots');

  // Absent snapshot → the preset dir runs on bundled defaults (the bundled
  // preset itself: no profile.json → legacy channels; here: no section at all).
  const emptyHome = mkdtempSync(join(tmpdir(), 'oh-my-dsh-slim-nosnap-'));
  process.env.OH_MY_DSH_SLIM_PROFILE_DIR = emptyHome;
  resetConfigForTests();
  if (loadConfig({}).roles.fixer.model !== bundledDefaults.presets[bundledDefaults.preset].fixer.model) {
    throw new Error('absent snapshot must fall back to bundled defaults');
  }
  console.log('  PASS  absent profile snapshot falls back to bundled defaults');
  rmSync(emptyHome, { recursive: true, force: true });

  // Env test channel still wins over the snapshot; malformed snapshots fail loud.
  const envSnapPath = join(snapshotHome, 'env-override.json');
  writeFileSync(envSnapPath, JSON.stringify({ presets: { 'my-dsh-normal': { fixer: { model: 'env-wins' } } } }));
  process.env.OH_MY_DSH_SLIM_CONFIG = envSnapPath;
  resetConfigForTests();
  if (loadConfig({}).roles.fixer.model !== 'env-wins') throw new Error('env test channel no longer wins over profile snapshots');
  console.log('  PASS  OH_MY_DSH_SLIM_CONFIG test channel wins over the profile snapshot');
  delete process.env.OH_MY_DSH_SLIM_CONFIG;
  process.env.OH_MY_DSH_SLIM_PROFILE_DIR = snapshotHome;
  writeFileSync(join(snapshotHome, 'profile.json'), '{oops');
  resetConfigForTests();
  let snapped;
  try {
    loadConfig({});
  } catch (error) {
    snapped = error;
  }
  if (!snapped || !/invalid JSON configuration/.test(snapped.message)) throw new Error(`malformed snapshot must fail loud: ${snapped?.message}`);
  console.log('  PASS  malformed profile.json fails loud instead of falling back silently');
  writeFileSync(join(snapshotHome, 'profile.json'), JSON.stringify({ preset: 'my-dsh-normal' }));
  resetConfigForTests();
  if (loadConfig({}).roles.fixer.model !== bundledDefaults.presets[bundledDefaults.preset].fixer.model) {
    throw new Error('restored empty snapshot lost bundled defaults');
  }
  if (prevProfileDir === undefined) delete process.env.OH_MY_DSH_SLIM_PROFILE_DIR;
  else process.env.OH_MY_DSH_SLIM_PROFILE_DIR = prevProfileDir;
  rmSync(snapshotHome, { recursive: true, force: true });
  resetConfigForTests();

  current = Object.freeze({ webFetch: true, presets: Object.freeze({}) });
  resetConfigForTests();
  if (loadConfig(ctx).webFetch !== undefined) throw new Error('legacy webFetch key from settings is ignored (follows host default)');
  current = Object.freeze({ presets: Object.freeze({}) });
  resetConfigForTests();
  if (loadConfig(ctx).webFetch !== undefined) throw new Error('config output must not invent a webFetch field');
  writeFileSync(join(legacyHome, 'oh-my-dsh-slim.json'), JSON.stringify({ webFetch: true }));
  process.env.DSH_HOME = legacyHome;
  resetConfigForTests();
  if (loadConfig({}).webFetch !== undefined) throw new Error('legacy webFetch key from the JSON channel is ignored (follows host default)');
  console.log('  PASS  legacy webFetch keys are ignored; config no longer owns a fetch switch');

  // Preset-scope plugins resolve a settings instance whose get() sees no
  // namespace (registrations live on the host plane); the raw published
  // document must backstop the settings channel there.
  const rawCtx = {
    settings: {
      get: () => undefined,
      document: Object.freeze({ 'oh-my-dsh-slim': Object.freeze({ webFetch: true, presets: Object.freeze({ 'my-dsh-normal': Object.freeze({ librarian: Object.freeze({ model: 'raw-model' }) }) }) }) }),
    },
  };
  delete process.env.DSH_HOME;
  resetConfigForTests();
  const fromRaw = loadConfig(rawCtx);
  if (fromRaw.webFetch !== undefined) throw new Error('raw document backstop must ignore the legacy webFetch key');
  if (fromRaw.roles.librarian.model !== 'raw-model') throw new Error('raw document backstop did not surface role overrides');
  if (fromRaw.roles.librarian.deny === undefined) throw new Error('raw document backstop lost bundled defaults merge');
  console.log('  PASS  raw settings document backstops preset-scope reads');

  rmSync(legacyHome, { recursive: true, force: true });
} finally {
  delete process.env.OH_MY_DSH_SLIM_CONFIG;
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  resetConfigForTests();
}

// ── effort tokens: shape, not vocabulary (2026-09-18) ────────────────────────
// Effort ids are adapter-owned and open-ended (the host brands them as an opaque
// id), so a fixed list in the writer is a snapshot: gating on it rejected
// intelalloc's `xhigh` while the model catalog offered it. Whether a model
// accepts a level is decided at runtime against that model's declared efforts
// (effort-by-role.js); the writers only reject tokens that are not tokens.
{
  const doc = (effort) => ({ preset: 'p', presets: { p: { oracle: { effort } } } });
  for (const token of ['xhigh', 'minimal', 'UlTra-2', 'off']) {
    try {
      validateConfigDocument(doc(token));
      console.log(`  PASS  well-formed effort "${token}" passes the document validator`);
    } catch (error) {
      throw new Error(`well-formed effort "${token}" was rejected: ${error.message}`);
    }
  }
  for (const bad of ['', 'x high', 'high!', 'a'.repeat(33), 42, null]) {
    let threw = false;
    try { validateConfigDocument(doc(bad)); } catch { threw = true; }
    if (!threw) throw new Error(`malformed effort ${JSON.stringify(bad)} was accepted by the document validator`);
    console.log(`  PASS  malformed effort ${JSON.stringify(bad)} is rejected`);
  }

  const tokenHome = mkdtempSync(join(tmpdir(), 'omds-effort-token-'));
  const tokenPath = join(tokenHome, 'config.json');
  writeFileSync(tokenPath, JSON.stringify({ preset: 'p', presets: { p: { oracle: { effort: 'xhigh' } } } }));
  const previousEnv = process.env.OH_MY_DSH_SLIM_CONFIG;
  const previousHome2 = process.env.DSH_HOME;
  process.env.OH_MY_DSH_SLIM_CONFIG = tokenPath;
  process.env.DSH_HOME = tokenHome;
  resetConfigForTests();
  try {
    const merged = loadConfig({});
    if (merged.roles.oracle.effort !== 'xhigh') {
      throw new Error(`loader dropped the configured effort: ${JSON.stringify(merged.roles.oracle.effort)}`);
    }
    console.log('  PASS  a catalog-declared level (xhigh) merges through the loader');
  } finally {
    if (previousEnv === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
    else process.env.OH_MY_DSH_SLIM_CONFIG = previousEnv;
    if (previousHome2 === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome2;
    resetConfigForTests();
    rmSync(tokenHome, { recursive: true, force: true });
  }
}
console.log('\nCONFIG LOADER: ALL CHECKS PASSED');

// Zero-cost unit test for the npm package's preset seeder
// (../npm-package/lib/index.js). Exercises every branch of the seeding state
// machine against real temp directories. The bundled preset is the real
// npm-package/preset copy; only the target home is synthetic.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, profileIdForDisplayName } from '../npm-package/lib/index.js';

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

const BUNDLED_VERSION = JSON.parse(
  readFileSync(new URL('../npm-package/package.json', import.meta.url), 'utf8'),
).version;
const BUNDLED_MARKER = { seededVersion: BUNDLED_VERSION };

function makeHome(label) {
  const home = join(tmpdir(), `omds-seeder-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(home, { recursive: true });
  return home;
}

function runSeeder(home, options = {}) {
  const logs = { info: [], warn: [], error: [] };
  const ctx = {
    logger: { info: (m) => logs.info.push(m), warn: (m) => logs.warn.push(m), error: (m) => logs.error.push(m) },
    // Default: no settings service ever mounts, so the seeder's ctx.inject
    // callback never runs (the documented degradation path). With a service,
    // the callback receives a context whose `.settings` is the service — the
    // same shape the real host hands to ctx.inject(["settings"], …).
    inject: options.settings === undefined ? () => {} : (deps, cb) => {
      if (deps.includes('settings')) cb({ settings: options.settings });
    },
  };
  apply(ctx);
  return logs;
}

// Settle the seeder's async settings wiring: wait (bounded) until the
// namespace is registered — everything else the inject callback does (legacy
// import decision, logging) is synchronous inside that same callback.
async function waitForRegistration(service, ms = 2000) {
  const deadline = Date.now() + ms;
  while (service.registered['oh-my-dsh-slim'] === undefined) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return true;
}

// Minimal host-settings service mock over the REAL register contract:
// register(ns, schema, { base }) → { get, watch, update, replace }, plus
// describe() exposing the raw user layer per namespace.
function makeSettingsService(sections = {}) {
  const registered = {};
  const watchers = [];
  return {
    registered,
    watchers,
    sections,
    describe: () => Object.entries(registered).map(([ns, entry]) => ({
      ns,
      user: sections[ns],
      value: entry.schema(sections[ns] ?? {}),
    })),
    register(ns, schema) {
      if (registered[ns] !== undefined) throw new Error(`duplicate namespace "${ns}"`);
      registered[ns] = { schema };
      return {
        get: () => schema(sections[ns] ?? {}),
        watch: (cb) => watchers.push(cb),
        update: async (patch) => { sections[ns] = { ...(sections[ns] ?? {}), ...patch }; },
        replace: async (section) => { sections[ns] = section; },
      };
    },
  };
}

function legacyJson(home, doc) {
  const path = join(home, 'oh-my-dsh-slim.json');
  if (doc !== undefined) writeFileSync(path, JSON.stringify(doc));
  return path;
}

function presetDir(home) { return join(home, '.agent-presets', 'oh-my-dsh-slim'); }
function markerOf(home) {
  try { return JSON.parse(readFileSync(join(presetDir(home), '.omds-seed.json'), 'utf8')); }
  catch { return undefined; }
}

const prevHome = process.env.DSH_HOME;

console.log('\n[stable profile ids]');
{
  const id = profileIdForDisplayName('我的开发配置');
  check(/^[a-z0-9][a-z0-9-]*$/.test(id), `generated id is a valid native preset id: ${id}`);
  check(id === profileIdForDisplayName('我的开发配置'), 'same display name gets a stable id');
  check(id !== profileIdForDisplayName('我的开发配置 2'), 'different display names do not reuse the id');
  check(id.includes('-'), 'generated id contains a readable prefix and hash');
}

console.log('\n[fresh install]');
{
  const home = makeHome('fresh');
  process.env.DSH_HOME = home;
  const logs = runSeeder(home);
  check(existsSync(join(presetDir(home), 'agent.cordis.yml')), 'preset files materialized');
  const marker = markerOf(home);
  check(marker?.seededVersion === BUNDLED_VERSION, `marker records seeded version (got ${JSON.stringify(marker)})`);
  check(logs.info.some((m) => m.includes('seeded')), 'logs the seeding');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[git-managed directory untouched]');
{
  const home = makeHome('git');
  const dir = presetDir(home);
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, 'sentinel.txt'), 'keep me');
  process.env.DSH_HOME = home;
  const logs = runSeeder(home);
  check(readFileSync(join(dir, 'sentinel.txt'), 'utf8') === 'keep me', 'directory untouched');
  check(markerOf(home) === undefined, 'no marker written');
  check(logs.info.some((m) => m.includes('git-managed')), 'explains why it skipped');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[manual install without marker untouched]');
{
  const home = makeHome('manual');
  const dir = presetDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.cordis.yml'), 'my custom yaml');
  process.env.DSH_HOME = home;
  const logs = runSeeder(home);
  check(readFileSync(join(dir, 'agent.cordis.yml'), 'utf8') === 'my custom yaml', 'unknown-origin directory untouched');
  check(logs.warn.some((m) => m.includes('without a seed marker')), 'warns about the missing marker');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[upgrade: older marker → backup + re-seed]');
{
  const home = makeHome('upgrade');
  const dir = presetDir(home);
  const sibling = join(home, '.agent-presets', 'profile-flash-fixer-regression');
  const siblingMetadata = 'name: "Flash Fixer"\ndescription: "hand-authored sibling metadata"\norder: 77\n';
  const siblingSnapshot = `${JSON.stringify({
    preset: 'my-dsh-normal',
    roles: { fixer: { model: 'flash-fixer-custom', effort: 'low' } },
  }, null, 2)}\n`;
  mkdirSync(dir, { recursive: true });
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(dir, '.omds-seed.json'), JSON.stringify({ seededVersion: '0.1.0' }));
  writeFileSync(join(dir, 'hand-edit.txt'), 'user tweak');
  writeFileSync(join(sibling, 'preset.yml'), siblingMetadata);
  writeFileSync(join(sibling, 'profile.json'), siblingSnapshot);
  const siblingEntriesBefore = readdirSync(sibling).sort();
  process.env.DSH_HOME = home;
  const logs = runSeeder(home);
  const marker = markerOf(home);
  if (logs.error.length > 0) console.log('  [debug] error logs:', JSON.stringify(logs.error));
  if (logs.info.length > 0) console.log('  [debug] info logs:', JSON.stringify(logs.info));
  check(marker?.seededVersion === BUNDLED_VERSION, `marker bumped to ${BUNDLED_VERSION}`);
  check(!existsSync(join(dir, 'hand-edit.txt')), 're-seeded directory is clean bundled content');
  check(logs.warn.some((m) => m.includes('upgraded') && m.includes('backed up')), 'warns with backup location');
  check(existsSync(sibling) && statSync(sibling).isDirectory(), 'sibling custom profile directory survives bundled upgrade');
  check(
    JSON.stringify(readdirSync(sibling).sort()) === JSON.stringify(siblingEntriesBefore),
    'sibling custom profile directory contents remain complete',
  );
  check(readFileSync(join(sibling, 'preset.yml'), 'utf8') === siblingMetadata, 'sibling preset metadata remains unchanged');
  check(readFileSync(join(sibling, 'profile.json'), 'utf8') === siblingSnapshot, 'sibling profile snapshot remains unchanged');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[upgrade creates recoverable backup]');
{
  const home = makeHome('backup');
  const dir = presetDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.omds-seed.json'), JSON.stringify({ seededVersion: '0.1.0' }));
  writeFileSync(join(dir, 'hand-edit.txt'), 'precious tweak');
  process.env.DSH_HOME = home;
  runSeeder(home);
  const parent = join(home, '.agent-presets');
  const backupName = (await import('node:fs')).readdirSync(parent).find((n) => n.startsWith('oh-my-dsh-slim.bak-'));
  check(backupName !== undefined, 'backup directory created next to the preset');
  if (backupName) {
    const backed = readFileSync(join(parent, backupName, 'hand-edit.txt'), 'utf8');
    check(backed === 'precious tweak', 'hand edits recoverable from the backup');
  }
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[up-to-date: same version untouched]');
{
  const home = makeHome('same');
  const dir = presetDir(home);
  cpSync(new URL('../npm-package/preset', import.meta.url), dir, { recursive: true });
  writeFileSync(join(dir, '.omds-seed.json'), JSON.stringify({ seededVersion: BUNDLED_VERSION }));
  writeFileSync(join(dir, 'sentinel.txt'), 'still here');
  process.env.DSH_HOME = home;
  const logs = runSeeder(home);
  check(readFileSync(join(dir, 'sentinel.txt'), 'utf8') === 'still here', 'directory untouched');
  check(logs.info.some((m) => m.includes('up to date')), 'logs up-to-date');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[downgrade protection: newer marker untouched]');
{
  const home = makeHome('downgrade');
  const dir = presetDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.omds-seed.json'), JSON.stringify({ seededVersion: '9.9.9' }));
  process.env.DSH_HOME = home;
  const logs = runSeeder(home);
  check(markerOf(home)?.seededVersion === '9.9.9', 'newer marker untouched');
  check(!logs.warn.some((m) => m.includes('upgraded')), 'no upgrade attempted');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[settings: fresh install registers the namespace and imports legacy JSON]');
{
  const home = makeHome('settings-import');
  const doc = { presets: { 'my-dsh-normal': { librarian: { model: 'legacy-model' } } } };
  const path = legacyJson(home, doc);
  process.env.DSH_HOME = home;
  const service = makeSettingsService();
  const logs = runSeeder(home, { settings: service });
  check(await waitForRegistration(service), 'namespace "oh-my-dsh-slim" registered');
  check(
    JSON.stringify(service.sections['oh-my-dsh-slim']) === JSON.stringify(doc),
    `legacy document became the user section (got ${JSON.stringify(service.sections['oh-my-dsh-slim'])})`,
  );
  check(!existsSync(path), 'legacy file removed after import');
  const archive = (await import('node:fs')).readdirSync(home).find((n) => n.startsWith('oh-my-dsh-slim.json.imported-'));
  check(archive !== undefined, 'legacy file archived with timestamped suffix');
  check(logs.info.some((m) => m.includes('imported') && m.includes('archived')), 'logs the import');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[settings: no legacy JSON → registers without importing]');
{
  const home = makeHome('settings-plain');
  process.env.DSH_HOME = home;
  const service = makeSettingsService();
  const logs = runSeeder(home, { settings: service });
  check(await waitForRegistration(service), 'namespace registered');
  check(service.sections['oh-my-dsh-slim'] === undefined, 'no section written');
  check(!logs.warn.some((m) => m.includes('legacy')), 'no legacy chatter');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[settings: existing settings.yaml section wins, legacy JSON kept]');
{
  const home = makeHome('settings-conflict');
  const path = legacyJson(home, { presets: { 'my-dsh-normal': { fixer: { model: 'legacy-model' } } } });
  process.env.DSH_HOME = home;
  const service = makeSettingsService({ 'oh-my-dsh-slim': { advanced: { roles: {} } } });
  const logs = runSeeder(home, { settings: service });
  await waitForRegistration(service);
  check(existsSync(path), 'legacy file left in place');
  check(
    JSON.stringify(service.sections['oh-my-dsh-slim']) === JSON.stringify({ advanced: { roles: {} } }),
    'existing section untouched',
  );
  check(logs.warn.some((m) => m.includes('already carries')), 'warns about the dual configuration');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[settings: schema-invalid legacy JSON kept with a warning]');
{
  const home = makeHome('settings-invalid');
  const path = legacyJson(home, { presets: { 'my-dsh-normal': { oracle: { effort: 'bogus' } } } });
  process.env.DSH_HOME = home;
  const service = makeSettingsService();
  const logs = runSeeder(home, { settings: service });
  await waitForRegistration(service);
  check(existsSync(path), 'invalid legacy file left in place');
  check(service.sections['oh-my-dsh-slim'] === undefined, 'nothing imported');
  check(logs.warn.some((m) => m.includes('failed schema validation')), 'warns with the validation failure');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[settings: unparseable legacy JSON kept with a warning]');
{
  const home = makeHome('settings-broken');
  const path = join(home, 'oh-my-dsh-slim.json');
  writeFileSync(path, '{oops');
  process.env.DSH_HOME = home;
  const service = makeSettingsService();
  const logs = runSeeder(home, { settings: service });
  await waitForRegistration(service);
  check(existsSync(path), 'unparseable legacy file left in place');
  check(service.sections['oh-my-dsh-slim'] === undefined, 'nothing imported');
  check(logs.warn.some((m) => m.includes('not valid JSON')), 'warns about the unparseable file');
  rmSync(home, { recursive: true, force: true });
}

console.log('\n[settings: service absent → seeding unaffected, wiring skipped]');
{
  const home = makeHome('settings-absent');
  process.env.DSH_HOME = home;
  const logs = runSeeder(home);
  check(existsSync(join(presetDir(home), 'agent.cordis.yml')), 'preset still seeded');
  check(!logs.error.some((m) => m.includes('settings namespace registration failed')), 'no registration errors');
  rmSync(home, { recursive: true, force: true });
}

process.env.DSH_HOME = prevHome;
console.log(failures === 0 ? '\nPRESET SEEDER: ALL CHECKS PASSED' : `\nPRESET SEEDER: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

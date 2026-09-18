// probe-omds-web — real-host web-mode probe for the /omds profile RPC.
//
// Why this exists: the L1 battery runs the headless profile, which has no
// `webServer` — exactly the seam where the 2026-09-10 regression hid. On DSH
// 0.1.5 `connection.rpc.handle()` threw `cannot get property "webServer"
// without inject` from the plugin fiber, so the channel silently never
// registered and the settings card reported 配置列表读取失败 with nothing in
// the host log. Only a booted WEB host can see that, so this probe boots one.
//
// It is version-parameterized: `--dsh <install-dir>` points at any
// @deepseek-ai/dsh installation (the running host, or an isolated peer such as
// an npm-installed 0.1.2-rc.1), which is how the 0.1.2 compatibility claim is
// verified instead of argued.
//
// Checks (all against a real host, zero model calls, no credentials):
//   1. the host boots and prints its readiness URL;
//   2. an unknown path answers 405 (control: 405 is the "unregistered" answer);
//   3. POST /omds/profile-list answers 401 without browser auth (the channel
//      IS registered and is behind the connection trust fence);
//   4. exchanging the readiness token for a browser cookie makes the same call
//      answer 200 with `{type:'server-response', rpcId, result:{ok:true,…}}`;
//   5. the seeded bundled preset appears in that roster.
//
// Usage:
//   node scripts/probe-omds-web.mjs                       # installed dsh
//   node scripts/probe-omds-web.mjs --dsh /tmp/dsh012/node_modules/@deepseek-ai/dsh
//   node scripts/probe-omds-web.mjs --preset-pkg /path/to/oh-my-dsh-slim --keep
//
// A peer host version is a plain isolated install, e.g. the 0.1.2 line:
//   npm install --ignore-scripts --prefix /tmp/dsh012 @deepseek-ai/dsh@0.1.2-rc.1
// (verified 2026-09-10: PASS on both 0.1.2-rc.1 and 0.1.5-rc.1)
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOOT_TIMEOUT_MS = 90_000;
const PROBE_TIMEOUT_MS = 20_000;

/** Pre-0.1.5 composition shape: a `text:`-only persona row. */
const LEGACY_COMPOSITION = [
  '# identity',
  '- id: persona',
  "  name: '@deepseek-ai/dsh-persona'",
  '  config:',
  '    text: |-',
  '      You are a coding agent.',
  '',
  '- id: agent-instructions',
  '  name: X',
  '',
].join('\n');

function parseArgs(argv) {
  const out = { dsh: undefined, presetPkg: join(ROOT, 'npm-package'), home: undefined, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dsh') out.dsh = argv[++i];
    else if (arg === '--preset-pkg') out.presetPkg = argv[++i];
    else if (arg === '--home') out.home = argv[++i];
    else if (arg === '--keep') out.keep = true;
    else { console.error(`probe-omds-web: unknown argument ${arg}`); process.exit(2); }
  }
  return out;
}

/** Resolve the @deepseek-ai/dsh package dir of the installed CLI. */
function resolveDshDir() {
  try {
    const bin = execSync('command -v dsh', { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return dirname(dirname(execSync(`readlink -f ${bin}`, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()));
  } catch {
    return undefined;
  }
}

const args = parseArgs(process.argv.slice(2));
const dshDir = args.dsh ?? resolveDshDir();
if (dshDir === undefined || !existsSync(join(dshDir, 'lib', 'bin.js'))) {
  console.error('probe-omds-web: cannot resolve the DSH install; pass --dsh <dir containing lib/bin.js>');
  process.exit(2);
}
if (!existsSync(join(args.presetPkg, 'package.json'))) {
  console.error(`probe-omds-web: --preset-pkg has no package.json: ${args.presetPkg}`);
  process.exit(2);
}

const hostVersion = JSON.parse(readFileSync(join(dshDir, 'package.json'), 'utf8')).version;
const bundledVersion = JSON.parse(readFileSync(join(args.presetPkg, 'package.json'), 'utf8')).version;
const home = args.home ?? join(tmpdir(), `dsh-omds-web-${process.pid}`);
if (!args.keep && existsSync(home)) rmSync(home, { recursive: true, force: true });

console.log(`host        : ${dshDir} (DSH ${hostVersion})`);
console.log(`preset pkg  : ${args.presetPkg} (oh-my-dsh-slim ${bundledVersion})`);
console.log(`scratch home: ${home}\n`);

// A minimal web profile: the two DSH bundles resolve from the installation,
// our package is the profile's own dependency. No settings/credentials are
// needed — the probe never runs a model.
mkdirSync(join(home, 'profiles', 'web', 'node_modules'), { recursive: true });
mkdirSync(join(home, 'sessions'), { recursive: true });
writeFileSync(join(home, 'profiles', 'web', 'package.json'), `${JSON.stringify({
  name: 'dsh-profile-web',
  private: true,
  version: '0.0.0',
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'oh-my-dsh-slim'] } },
  dependencies: { 'oh-my-dsh-slim': '*' },
}, null, 2)}\n`);
writeFileSync(join(home, 'profiles', 'web', 'cordis.yml'), '[]\n');
writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), '[]\n');
symlinkSync(args.presetPkg, join(home, 'profiles', 'web', 'node_modules', 'oh-my-dsh-slim'));

const child = spawn(process.execPath, [join(dshDir, 'lib', 'bin.js'), '--profile', 'web', '--port', '0', '--no-open'], {
  env: { ...process.env, DSH_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

const ready = await new Promise((resolveReady) => {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  const timer = setInterval(() => {
    const match = stdout.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*)/);
    if (match !== null) { clearInterval(timer); resolveReady({ url: match[1] }); return; }
    if (Date.now() > deadline || child.exitCode !== null) { clearInterval(timer); resolveReady(undefined); }
  }, 250);
});

let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}${ok ? '' : ''}`); if (!ok) failures++; };

function stop() {
  if (child.exitCode === null) child.kill('SIGTERM');
}

if (ready === undefined) {
  console.error('FAIL  the host never printed a readiness URL');
  console.error(stderr.split('\n').slice(-12).join('\n'));
  stop();
  process.exit(1);
}

const origin = new URL(ready.url).origin;
const envelope = (body) => ({ type: 'client-request', rpcId: `probe-${Math.random().toString(36).slice(2, 8)}`, ...body });
const rpc = async (path, body, cookie) => {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: response.status, text, json };
};

try {
  console.log(`booted      : ${origin}\n`);

  const control = await rpc('/nope', {});
  check(control.status === 405, `control: an unknown path answers 405 (got ${control.status})`);

  const unauthenticated = await rpc('/omds/profile-list', envelope({ method: 'profile-list', payload: {} }));
  check(unauthenticated.status === 401, `POST /omds/profile-list is registered and fenced with 401 (got ${unauthenticated.status})`);

  // Exchange the one-time readiness token for the browser session cookie the
  // real card carries, so the probe exercises the handler and not just the fence.
  const index = await fetch(ready.url, { redirect: 'manual' });
  const cookie = (index.headers.getSetCookie?.() ?? []).map((entry) => entry.split(';')[0]).join('; ');
  check(cookie !== '', 'the readiness token mints a browser-session cookie');

  const listed = await rpc('/omds/profile-list', envelope({ method: 'profile-list', payload: {} }), cookie);
  const result = listed.json?.result;
  check(listed.status === 200, `authenticated profile-list answers 200 (got ${listed.status})`);
  check(listed.json?.type === 'server-response', 'response uses the connection server-response envelope');
  check(result?.ok === true, result?.ok === true ? 'result.ok is true' : `result.ok is true (got ${JSON.stringify(result?.error ?? null)})`);
  const profiles = result?.value?.profiles ?? [];
  check(profiles.some((entry) => entry.id === 'oh-my-dsh-slim'), `the seeded preset is in the roster (${profiles.map((entry) => entry.id).join(', ') || 'empty'})`);

  const unknown = await rpc('/omds/definitely-not-an-endpoint', envelope({ method: 'definitely-not-an-endpoint', payload: {} }), cookie);
  check(unknown.json?.result?.ok === false && unknown.json?.result?.error?.details !== undefined,
    'an unknown endpoint answers a coded failure with a record details field');

  // A custom profile directory created from pre-0.1.5 content (a `text:`-only
  // persona row) must be flagged and repairable through the same channel —
  // that directory would otherwise fail its whole preset mount on 0.1.5.
  console.log('\n[0.1.5 persona migration]');
  const legacyId = 'profile-legacy-probe';
  const legacyDir = join(home, '.agent-presets', legacyId);
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, 'preset.yml'), 'name: legacy probe\n');
  writeFileSync(join(legacyDir, 'agent.cordis.yml'), LEGACY_COMPOSITION);

  const before = await rpc('/omds/profile-list', envelope({ method: 'profile-list', payload: {} }), cookie);
  const flagged = (before.json?.result?.value?.profiles ?? []).find((entry) => entry.id === legacyId);
  check(flagged?.needsMigration === true, 'a legacy custom profile is flagged needsMigration by the roster');

  const migrated = await rpc('/omds/profile-migrate', envelope({ method: 'profile-migrate', payload: { profileId: legacyId } }), cookie);
  check(migrated.json?.result?.ok === true && migrated.json.result.value?.changed === true,
    `profile-migrate rewrites the composition (${JSON.stringify(migrated.json?.result?.error ?? null)})`);
  const rewritten = readFileSync(join(legacyDir, 'agent.cordis.yml'), 'utf8');
  check(/text: &omds-persona \|-/.test(rewritten) && /^\s+prefix: \*omds-persona$/m.test(rewritten),
    'the rewritten composition carries the anchored text and the prefix alias');
  check(existsSync(join(legacyDir, 'agent.cordis.yml.bak-pre-015-persona')),
    'the pre-migration composition is backed up (rollback path)');

  const after = await rpc('/omds/profile-list', envelope({ method: 'profile-list', payload: {} }), cookie);
  const cleared = (after.json?.result?.value?.profiles ?? []).find((entry) => entry.id === legacyId);
  check(cleared?.needsMigration === false, 'the flag clears once the profile is migrated');
  const replayed = await rpc('/omds/profile-migrate', envelope({ method: 'profile-migrate', payload: { profileId: legacyId } }), cookie);
  check(replayed.json?.result?.value?.changed === false, 'a second migrate is a no-op (idempotent)');
} catch (error) {
  console.error(`FAIL  probe error: ${error?.message ?? error}`);
  failures++;
}

stop();
if (!args.keep) rmSync(home, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'PROBE_VERDICT: PASS' : 'PROBE_VERDICT: FAIL'}`);
if (failures === 0) console.log(`web-mode /omds transport verified on DSH ${hostVersion} with oh-my-dsh-slim ${bundledVersion}`);
process.exit(failures === 0 ? 0 : 1);

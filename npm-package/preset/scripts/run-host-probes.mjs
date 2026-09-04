// run-host-probes — unified runner for the L1 zero-model host-contract probe
// battery (see TEST-INVENTORY.md). For each inventory entry it:
//   1. bootstraps a scratch DSH_HOME (headless profile skeleton copied from
//      the PRODUCTION home, preset copied from --preset / production install,
//      sessions dir); credentials are ONLY added with an explicit --creds and
//      are never needed by this battery (all entries are zero-model);
//   2. substitutes the __WORKSPACE__ token in the overlay template with this
//      repo's root (path portability) and writes it under scratch/patches/;
//   3. runs `dsh --profile headless --patch <overlay> probe` with the entry's
//      env, tees stdout/stderr to scratch/logs/, and reads the probe's
//      PROBE_VERDICT line.
// Usage:
//   node scripts/run-host-probes.mjs --list
//   node scripts/run-host-probes.mjs [--home <scratch>] [--preset <presetDir>]
//       [--only name[,name...]] [--keep] [--creds <file>]
// Exit code 0 only when every executed probe phase PASSes.
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync, closeSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = '__WORKSPACE__';
const PROBE_TIMEOUT_MS = 120000;

// name -> { overlay, phases: [{ label, env }], notes }
const BATTERY = {
  'session-query': { overlay: 'probe-patch.headless.yml', phases: [{ label: 'api', env: {} }] },
  'spawn-child': { overlay: 'probe-spawn-child-patch.headless.yml', phases: [{ label: 'join', env: {} }] },
  'ecc-sync': { overlay: 'probe-ecc-sync.headless.yml', phases: [{ label: 'contract', env: {} }] },
  'sandbox-parity': { overlay: 'probe-sandbox-parity.headless.yml', phases: [{ label: 'parity', env: {} }] },
  'subagent-result': { overlay: 'probe-subagent-result.headless.yml', phases: [{ label: 'query', env: {} }] },
  'effort-real': {
    overlay: 'probe-effort-real.headless.yml',
    phases: [
      { label: 'default', env: { OMDS_EFFORT_PHASE: 'default' } },
      { label: 'none', env: { OMDS_EFFORT_PHASE: 'none' } },
    ],
  },
  'profile-snapshots': { overlay: 'probe-seeder-load.headless.yml', phases: [{ label: 'seeder', env: {} }] },
  'model-capabilities': { overlay: 'probe-capabilities-patch.headless.yml', phases: [{ label: 'modality', env: {} }] },
};

function parseArgs(argv) {
  const out = { home: join(tmpdir(), 'dsh-host-probes'), preset: undefined, only: undefined, keep: false, creds: undefined, list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--home') out.home = argv[++i];
    else if (arg === '--preset') out.preset = argv[++i];
    else if (arg === '--only') out.only = argv[++i].split(',');
    else if (arg === '--keep') out.keep = true;
    else if (arg === '--creds') out.creds = argv[++i];
    else if (arg === '--list') out.list = true;
    else { console.error(`run-host-probes: unknown argument ${arg}`); process.exit(2); }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.list) {
  for (const [name, entry] of Object.entries(BATTERY)) {
    console.log(`${name.padEnd(18)} phases=${entry.phases.map((p) => p.label).join(',')}  overlay=${entry.overlay}`);
  }
  process.exit(0);
}

const productionHome = process.env.DSH_HOME;
if (!productionHome || !existsSync(join(productionHome, 'profiles', 'headless', 'package.json'))) {
  console.error('run-host-probes: DSH_HOME must point at a home with a headless profile (source for the scratch skeleton)');
  process.exit(2);
}
const presetSource = args.preset ?? join(productionHome, '.agent-presets', 'oh-my-dsh-slim');
if (!existsSync(join(presetSource, 'agent.cordis.yml'))) {
  console.error(`run-host-probes: preset source missing: ${presetSource}`);
  process.exit(2);
}

const home = args.home;
if (!args.keep && existsSync(home)) rmSync(home, { recursive: true, force: true });
mkdirSync(join(home, 'profiles', 'headless'), { recursive: true });
mkdirSync(join(home, 'profiles', 'headless', 'node_modules'), { recursive: true });
mkdirSync(join(home, 'sessions'), { recursive: true });
mkdirSync(join(home, 'patches'), { recursive: true });
mkdirSync(join(home, 'logs'), { recursive: true });
for (const file of ['package.json', 'cordis.yml', 'cordis.patch.yml']) {
  const source = join(productionHome, 'profiles', 'headless', file);
  if (existsSync(source)) cpSync(source, join(home, 'profiles', 'headless', file));
}
const presetTarget = join(home, '.agent-presets', 'oh-my-dsh-slim');
if (existsSync(presetTarget)) rmSync(presetTarget, { recursive: true, force: true });
cpSync(presetSource, presetTarget, { recursive: true });
if (args.creds) cpSync(args.creds, join(home, '.credentials.yaml'));
console.log(`scratch home: ${home}`);
console.log(`preset copy : ${presetSource}\n`);

/** Run one probe phase; tee both streams to files; resolve verdict + exit code. */
function runProbe(name, label, home, overlayPath, env) {
  const stdoutPath = join(home, 'logs', `${name}-${label}.out`);
  const stderrPath = join(home, 'logs', `${name}-${label}.err`);
  return new Promise((resolvePromise) => {
    const child = spawn('dsh', ['--profile', 'headless', '--patch', overlayPath, 'probe'], {
      env: { ...process.env, DSH_HOME: home, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outFd = openSync(stdoutPath, 'w');
    const errFd = openSync(stderrPath, 'w');
    let stdoutTail = '';
    child.stdout.on('data', (chunk) => {
      writeSync(outFd, chunk);
      stdoutTail = (stdoutTail + chunk.toString()).slice(-4000);
    });
    child.stderr.on('data', (chunk) => writeSync(errFd, chunk));
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, PROBE_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      closeSync(outFd);
      closeSync(errFd);
      resolvePromise({ verdict: `SPAWN_ERROR ${error?.message ?? error}`, exitCode: -1 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      closeSync(outFd);
      closeSync(errFd);
      const match = stdoutTail.match(/PROBE_VERDICT: (PASS|FAIL)/);
      // Newer probes print PROBE_VERDICT; older probes (model-capabilities,
      // profile-snapshots) follow the "JSON + exit code" convention.
      const verdict = match?.[1] ?? (code === 0 ? 'PASS' : 'NO_VERDICT');
      resolvePromise({ verdict, exitCode: code ?? -1, convention: match?.[1] !== undefined ? 'verdict-line' : 'exit-code' });
    });
  });
}

const selected = args.only ?? Object.keys(BATTERY);
const results = [];
let failed = 0;
for (const name of selected) {
  const entry = BATTERY[name];
  if (entry === undefined) {
    console.error(`run-host-probes: unknown probe "${name}" (see --list)`);
    failed++;
    continue;
  }
  for (const phase of entry.phases) {
    const template = readFileSync(join(ROOT, 'scripts', entry.overlay), 'utf8');
    if (!template.includes(TOKEN)) {
      console.error(`run-host-probes: ${entry.overlay} has no ${TOKEN} token`);
      failed++;
      continue;
    }
    const overlayPath = join(home, 'patches', `${name}-${phase.label}.yml`);
    writeFileSync(overlayPath, template.split(TOKEN).join(ROOT));
    const outcome = await runProbe(name, phase.label, home, overlayPath, phase.env);
    const ok = outcome.verdict === 'PASS';
    if (!ok) failed++;
    results.push({ name, phase: phase.label, ...outcome });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} [${phase.label}] (exit ${outcome.exitCode}, ${outcome.convention})`);
  }
}

console.log(`\n${results.length - failed}/${results.length} probe phases PASSED`);
if (!args.keep && failed === 0) {
  rmSync(home, { recursive: true, force: true });
  console.log(`scratch home cleaned: ${home} (use --keep to retain logs)`);
} else if (!args.keep) {
  console.log(`scratch home retained for diagnosis: ${home} (remove manually)`);
}
process.exit(failed === 0 ? 0 : 1);

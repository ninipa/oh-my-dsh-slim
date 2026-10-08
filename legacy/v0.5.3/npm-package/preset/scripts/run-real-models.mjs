// run-real-models — one-command real-model acceptance for the preset.
//
// The L1 battery is zero-model; the only real-model assets (the ECC settlement
// probe and the isolated smoke) otherwise need a hand-built scratch home. This
// script builds that home, points the whole stack at ONE model choice, and runs
// both assets against it:
//
//   * settings.yaml      agent-default-model = <provider>/<model> @ <effort>
//   * role configuration every role = <provider>/<model> @ <effort>
//   * preset             the WORKSPACE content (not the installed copy)
//
// The model is a parameter, never a constant: `--provider/--model/--effort`
// (or OMDS_REAL_PROVIDER/OMDS_REAL_MODEL/OMDS_REAL_EFFORT) re-point the whole
// run, so a retired model or a dead gateway is a flag change, not an edit. The
// provider's own profile (baseURL / api / compat / headers) is copied verbatim
// from the source home's settings — including the `x-opencode-session` header
// some gateways require — so no endpoint detail is duplicated here.
//
// Usage:
//   node scripts/run-real-models.mjs                      # new provider, low effort
//   node scripts/run-real-models.mjs --model deepseek-v4-flash --provider deepseek-official
//   node scripts/run-real-models.mjs --effort high --only ecc --keep
//
// Preconditions: DSH_HOME (or --source-home) points at a home with
// profiles/headless/*, settings.yaml (carrying the provider profile) and
// .credentials.yaml. Model calls are billed to that home's credentials.
import { spawn, spawnSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = '__WORKSPACE__';
const RUN_TIMEOUT_MS = 420_000;
const PRESET_ID = 'oh-my-dsh-slim';
/** Files that make up one preset directory (dev root carries other dev files too). */
const PRESET_FILES = [
  'agent.cordis.yml', 'preset.yml', 'defaults.json', 'config-loader.js', 'settings-schema.js',
  'host-version.js', 'role-subagent.js', 'effort-by-role.js', 'early-close-context.js',
  'sandbox-strip.js', 'subagent-result.js', 'oh-my-dsh-slim.schema.json',
];

function parseArgs(argv) {
  const out = {
    provider: process.env.OMDS_REAL_PROVIDER ?? 'opencode-ds-v41-flash',
    model: process.env.OMDS_REAL_MODEL ?? 'deepseek-flash',
    effort: process.env.OMDS_REAL_EFFORT ?? 'low',
    dsh: undefined,
    sourceHome: process.env.DSH_HOME,
    home: undefined,
    task: '使用 subagent_explorer 列出当前目录下的 3 个文件名，收到结果后用一句话汇报。不要自己搜索。',
    only: undefined,
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--provider') out.provider = argv[++i];
    else if (arg === '--model') out.model = argv[++i];
    else if (arg === '--effort') out.effort = argv[++i];
    else if (arg === '--dsh') out.dsh = argv[++i];
    else if (arg === '--source-home') out.sourceHome = argv[++i];
    else if (arg === '--home') out.home = argv[++i];
    else if (arg === '--task') out.task = argv[++i];
    else if (arg === '--only') out.only = argv[++i];
    else if (arg === '--keep') out.keep = true;
    else { console.error(`run-real-models: unknown argument ${arg}`); process.exit(2); }
  }
  return out;
}

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
  console.error('run-real-models: cannot resolve the DSH install; pass --dsh <dir containing lib/bin.js>');
  process.exit(2);
}
const sourceHome = args.sourceHome;
if (sourceHome === undefined || !existsSync(join(sourceHome, 'profiles', 'headless', 'package.json'))) {
  console.error('run-real-models: --source-home/DSH_HOME must point at a home with a headless profile');
  process.exit(2);
}
if (!existsSync(join(sourceHome, 'settings.yaml'))) {
  console.error(`run-real-models: ${sourceHome}/settings.yaml is required (provider profile + credentials live there)`);
  process.exit(2);
}

// ---- read the source facts: provider profile, credentials, preset key ------
const { parse: parseYaml, stringify: stringifyYaml } = await import(
  join(dshDir, 'node_modules', 'yaml', 'dist', 'index.js')
);
const sourceSettings = parseYaml(readFileSync(join(sourceHome, 'settings.yaml'), 'utf8'));
const providerProfile = sourceSettings?.['llm-pi-ai']?.providers?.[args.provider];
const hostBuiltinProvider = args.provider === 'deepseek-official';
if (providerProfile === undefined && !hostBuiltinProvider) {
  console.error(`run-real-models: provider "${args.provider}" is not defined in ${sourceHome}/settings.yaml (llm-pi-ai.providers).`);
  console.error('Add it there (baseURL/api/compat/headers) or pass --provider of a built-in one (deepseek-official).');
  process.exit(2);
}
const sourcePresetDefaults = JSON.parse(readFileSync(join(ROOT, 'defaults.json'), 'utf8'));
const presetKey = sourcePresetDefaults.preset;
const roleIds = Object.keys(sourcePresetDefaults.presets[presetKey]).filter((role) => role !== 'orchestrator');

const hostVersion = JSON.parse(readFileSync(join(dshDir, 'package.json'), 'utf8')).version;
const home = args.home ?? join(tmpdir(), `dsh-real-${process.pid}`);
if (!args.keep && existsSync(home)) rmSync(home, { recursive: true, force: true });

console.log(`host        : DSH ${hostVersion} (${dshDir})`);
console.log(`source home : ${sourceHome}`);
console.log(`model       : ${args.provider}/${args.model} @ ${args.effort}  (parent + every role)`);
console.log(`scratch home: ${home}\n`);

// ---- build the scratch home ------------------------------------------------
mkdirSync(join(home, 'profiles', 'headless'), { recursive: true });
mkdirSync(join(home, 'sessions'), { recursive: true });
mkdirSync(join(home, 'patches'), { recursive: true });
for (const file of ['package.json', 'cordis.yml', 'cordis.patch.yml']) {
  const source = join(sourceHome, 'profiles', 'headless', file);
  if (existsSync(source)) cpSync(source, join(home, 'profiles', 'headless', file));
}
// DeepSeek-official requests scan every ACTIVE file plugin and require the
// nearest package.json to carry a non-empty name AND version; the shipped
// headless profile has a name but no version, and this scratch home has no root
// manifest at all. Without these the official-provider run dies with
// `REQUEST_EXTENSION: DeepSeek request extension preparation failed`.
writeFileSync(join(home, 'package.json'), `${JSON.stringify({ name: 'omds-real-models-scratch', version: '0.0.0', private: true }, null, 2)}\n`);
const headlessManifestPath = join(home, 'profiles', 'headless', 'package.json');
const headlessManifest = existsSync(headlessManifestPath)
  ? JSON.parse(readFileSync(headlessManifestPath, 'utf8'))
  : { name: 'dsh-profile-headless' };
if (typeof headlessManifest.version !== 'string' || headlessManifest.version === '') headlessManifest.version = '0.0.0';
writeFileSync(headlessManifestPath, `${JSON.stringify(headlessManifest, null, 2)}\n`);
cpSync(join(sourceHome, '.credentials.yaml'), join(home, '.credentials.yaml'));

const roles = {};
for (const roleId of roleIds) roles[roleId] = { provider: args.provider, model: args.model, effort: args.effort };
const scratchSettings = {
  'agent-default-model': { provider: args.provider, model: args.model, reasoningEffort: args.effort },
  'agent-presets': { default: PRESET_ID },
  ...(providerProfile === undefined ? {} : { 'llm-pi-ai': { providers: { [args.provider]: providerProfile } } }),
  [PRESET_ID]: { presets: { [presetKey]: roles } },
};
writeFileSync(join(home, 'settings.yaml'), stringifyYaml(scratchSettings));

const presetDir = join(home, '.agent-presets', PRESET_ID);
mkdirSync(presetDir, { recursive: true });
for (const file of PRESET_FILES) cpSync(join(ROOT, file), join(presetDir, file));
if (existsSync(join(ROOT, 'npm-package', 'preset', 'package.json'))) {
  cpSync(join(ROOT, 'npm-package', 'preset', 'package.json'), join(presetDir, 'package.json'));
}

// The smoke runner replaces the stock headless runner (the stock one never
// mounts a preset) and the debug plugin logs every resolved agent/request.
cpSync(join(ROOT, 'scripts', 'runner-with-preset.js'), join(home, 'profiles', 'headless', 'runner-plugin.js'));
cpSync(join(ROOT, 'scripts', 'debug-agent-request.js'), join(home, 'debug-plugin.js'));
writeFileSync(join(home, 'patches', 'smoke.yml'), [
  '# real-model smoke: preset mounted on our own runner + per-request model trace',
  '- insert:',
  '    - id: agent-presets',
  "      name: '@deepseek-ai/dsh-agent-presets'",
  `      config:`,
  `        default: ${PRESET_ID}`,
  '    - id: debug-agent-request',
  `      name: file://${join(home, 'debug-plugin.js')}`,
  '- id: headless-runner',
  '  disabled: true',
  '- id: tool-subagent',
  '  disabled: true',
  '- id: tool-subagent-fork',
  '  disabled: true',
  '- insert:',
  '    - id: runner-with-preset',
  `      name: file://${join(home, 'profiles', 'headless', 'runner-plugin.js')}`,
  '',
].join('\n'));
const eccOverlay = join(home, 'patches', 'ecc.yml');
writeFileSync(eccOverlay, readFileSync(join(ROOT, 'scripts', 'run-ecc-real.headless.yml'), 'utf8').split(TOKEN).join(ROOT));

let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

function runHeadless(overlay, extraEnv) {
  return spawnSync(process.execPath, [join(dshDir, 'lib', 'bin.js'), '--profile', 'headless', '--patch', overlay, 'probe'], {
    env: { ...process.env, DSH_HOME: home, ...extraEnv },
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
}

/** Parse `[dbg] agent/request … depth=<n> opts=…` / `[dbg]   -> config=…` pairs. */
function modelTrace(stderr) {
  const out = [];
  let depth;
  for (const line of String(stderr).split('\n')) {
    const head = line.match(/^\[dbg\] agent\/request agent=(\S+) depth=(\S+) opts=(\{.*\})$/);
    if (head !== null) { depth = head[2] === 'undefined' ? undefined : Number(head[2]); continue; }
    const config = line.match(/^\[dbg\]   -> config=(\{.*\})$/);
    if (config !== null && depth !== null) { out.push({ depth, config: JSON.parse(config[1]) }); depth = null; }
  }
  return out;
}

// ---------------------------------------------------------------- smoke ----
if (args.only === undefined || args.only === 'smoke') {
  console.log('[smoke] preset mount + real delegation');
  const smoke = spawnSync(process.execPath, [join(dshDir, 'lib', 'bin.js'), '--profile', 'headless', '--patch', join(home, 'patches', 'smoke.yml'), args.task], {
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
  writeFileSync(join(home, 'smoke.out'), smoke.stdout ?? '');
  writeFileSync(join(home, 'smoke.err'), smoke.stderr ?? '');
  check(smoke.status === 0, `the smoke run exits 0 (got ${smoke.status})`);
  const trace = modelTrace(smoke.stderr);
  check(trace.length > 0, `the debug plugin logged resolved requests (${trace.length})`);
  const wrong = trace.filter((entry) => entry.config.provider !== args.provider || entry.config.model !== args.model);
  check(wrong.length === 0, `every request resolved to ${args.provider}/${args.model} (${wrong.length} mismatched)`);
  const child = trace.filter((entry) => entry.depth !== undefined);
  check(child.length > 0, `at least one delegated child was requested (${child.length})`);
  const childEffort = child.every((entry) => entry.config.reasoningEffort === args.effort);
  check(childEffort, `every role child ran at effort ${args.effort} (${child.map((entry) => entry.config.reasoningEffort).join(', ') || 'none'})`);
  if (failures > 0) {
    console.log('  --- smoke stderr tail ---');
    console.log(String(smoke.stderr ?? '').split('\n').slice(-8).map((line) => `  ${line}`).join('\n'));
  }
}

// ------------------------------------------------------------------ ecc ----
if (args.only === undefined || args.only === 'ecc') {
  console.log('\n[ecc] settlement ordering (real relay + real settle)');
  const ecc = runHeadless(eccOverlay, { ECC_DEBUG: '1' });
  writeFileSync(join(home, 'ecc.out'), ecc.stdout ?? '');
  writeFileSync(join(home, 'ecc.err'), ecc.stderr ?? '');
  check(/RUN_VERDICT: PASS/.test(ecc.stdout ?? ''), 'the ECC probe reports RUN_VERDICT: PASS');
  const analyzed = spawnSync(process.execPath, [join(ROOT, 'scripts', 'analyze-ecc-real.mjs'), join(home, 'ecc.out'), join(home, 'ecc.err')], { encoding: 'utf8' });
  check(/ECC_ORDER_VERDICT: PASS/.test(analyzed.stdout ?? ''), 'the analyzer confirms settlement ordering');
  if (!/ECC_ORDER_VERDICT: PASS/.test(analyzed.stdout ?? '')) console.log(analyzed.stdout ?? '');
}

if (!args.keep) rmSync(home, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'REAL MODELS: ALL CHECKS PASSED' : `REAL MODELS: ${failures} CHECK(S) FAILED`}`);
if (args.keep) console.log(`scratch home retained: ${home}`);
process.exit(failures === 0 ? 0 : 1);

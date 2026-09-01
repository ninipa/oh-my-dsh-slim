// T0 static validation for the plugin-driven oh-my-dsh-slim preset.
// Usage: node scripts/t0-validate.mjs [preset-dir]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const presetDir = resolve(process.argv[2] ?? root);
let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };

let YAML;
try {
  const roots = [];
  if (process.env.DSH_HOME) roots.push(join(process.env.DSH_HOME, 'profiles', 'node_modules'));
  const probeOptions = { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] };
  for (const command of ['npm root -g', 'zsh -lic "npm root -g"']) {
    // zsh -lic sources the user's login+interactive shell config, which can hang
    // (reported on Linux); every probe is bounded and silent on stderr.
    try {
      roots.push(execSync(command, probeOptions).trim());
      break; // first reachable npm root wins; the zsh fallback only runs when plain sh lacks npm
    } catch {}
  }
  try {
    const dshBin = realpathSync(execSync('command -v dsh', probeOptions).trim());
    const packageDir = dirname(dirname(dshBin));
    roots.push(dirname(dirname(packageDir)));
  } catch {}
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const dshRoot = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!dshRoot) throw new Error('DSH package not found');
  YAML = createRequire(join(dshRoot, '@deepseek-ai/dsh/package.json'))('yaml');
} catch (error) {
  console.error(`FATAL: cannot resolve the DSH YAML parser: ${error.message}`);
  process.exit(2);
}

console.log('\n[1] preset structure');
const composePath = join(presetDir, 'agent.cordis.yml');
let rows;
try {
  rows = YAML.parse(readFileSync(composePath, 'utf8').replace(/!!js(?=\s)/g, '!!str'));
  if (!Array.isArray(rows)) throw new Error('root is not a list');
  pass('agent.cordis.yml parses as YAML list');
} catch (error) {
  fail(`YAML parse error: ${error.message}`);
  process.exit(1);
}
const ids = rows.map((row) => row?.id);
if (new Set(ids).size === ids.length) pass('row ids unique'); else fail('duplicate row ids');
const roleRows = rows.filter((row) => row?.name === './role-subagent.js');
const roleIds = roleRows.map((row) => row.config?.roleId);
const expectedRoles = ['oracle', 'designer', 'fixer', 'explorer', 'librarian', 'observer'];
if (roleRows.length === 6) pass('6 role tool rows'); else fail(`expected 6 role rows, got ${roleRows.length}`);
if (expectedRoles.every((id) => roleIds.includes(id)) && new Set(roleIds).size === 6) pass('stable roleId roster is complete and unique'); else fail(`roleId roster invalid: ${JSON.stringify(roleIds)}`);
if (roleRows.every((row) => row.config?.agentOptions === undefined)) pass('runtime model parameters are absent from YAML'); else fail('agentOptions still exposed in YAML');
if (roleRows.every((row) => row.config?.enabled === undefined)) pass('YAML role rows keep `enabled` out (JSON-domain key)'); else fail('YAML role rows expose `enabled`; it belongs to oh-my-dsh-slim.json');
if (rows.filter((row) => row?.name === '@deepseek-ai/dsh-mcp-client').length === 0) pass('no global MCP rows'); else fail('MCP is still globally mounted');
const webRow = rows.find((row) => row?.id === 'tool-web');
if (webRow?.config?.fetch === false && webRow?.config?.searchTimeoutMs === 60000) pass('web_fetch is disabled while web_search remains configured');
else fail('tool-web must set fetch: false and retain web search');

console.log('\n[2] bundled/user configuration');
let defaults;
try {
  defaults = JSON.parse(readFileSync(join(presetDir, 'defaults.json'), 'utf8'));
  pass('defaults.json parses');
} catch (error) { fail(`defaults.json invalid: ${error.message}`); }
if (defaults?.presets?.[defaults?.preset]) pass('default preset is present'); else fail('default preset missing');
for (const roleId of expectedRoles) {
  const role = defaults?.presets?.[defaults?.preset]?.[roleId];
  if (!role) { fail(`default role missing: ${roleId}`); continue; }
  if (typeof role.model === 'string' && typeof role.effort === 'string' && role.temperature === undefined && role.maxTokens === undefined) pass(`${roleId}: user-facing defaults hide runtime parameters`);
  else fail(`${roleId}: defaults.json exposes runtime parameters`);
  if (role.tools?.includes('web_fetch')) fail(`${roleId}: web_fetch must not be enabled`);
}
if (defaults?.presets?.[defaults?.preset]?.librarian?.mcps?.join(',') === 'context7,gh_grep') pass('Librarian defaults to context7 + gh_grep'); else fail('Librarian MCP defaults incorrect');
if (defaults?.presets?.[defaults?.preset]?.orchestrator?.mcps?.length === 0) pass('orchestrator MCP defaults empty'); else fail('orchestrator MCP defaults are not empty');
const loaderSrc = readFileSync(join(presetDir, 'config-loader.js'), 'utf8');
if (/RUNTIME_DEFAULTS/.test(loaderSrc) && /temperature: 0\.1/.test(loaderSrc) && /maxTokens: 128000/.test(loaderSrc)) pass('runtime defaults live inside config-loader.js'); else fail('runtime defaults are not internal to config-loader.js');

console.log('\n[3] plugin and schema');
for (const file of ['config-loader.js', 'role-subagent.js', 'effort-by-role.js', 'subagent-result.js', 'oh-my-dsh-slim.schema.json', 'sandbox-strip.js']) {
  if (existsSync(join(presetDir, file))) pass(`${file} present`); else fail(`${file} missing`);
}
const stripRows = rows.filter((row) => row?.id === 'sandbox-strip');
if (stripRows.length === 1 && stripRows[0]?.name === './sandbox-strip.js') pass('sandbox-strip registered exactly once'); else fail(`sandbox-strip row invalid: ${JSON.stringify(stripRows)}`);
const stripSrc = readFileSync(join(presetDir, 'sandbox-strip.js'), 'utf8');
if (/tools\/pre-execute/.test(stripSrc) && /dshRoleId/.test(stripSrc) && /sandbox_permissions/.test(stripSrc) && /tools\/post-execute/.test(stripSrc)) pass('sandbox-strip strips child escalation fields at pre-execute');
else fail('sandbox-strip missing pre-execute stripping logic');
if (/escalationArgsAreDoomed/.test(stripSrc) && /TOP_STRIP_NOTE/.test(stripSrc) && /sandboxPolicy/.test(stripSrc) && /WIDER_MODES/.test(stripSrc)) pass('sandbox-strip strips only doomed shapes at top level, keeps legitimate escalations');
else fail('sandbox-strip missing top-level doomed-shape handling');
const resultRows = rows.filter((row) => row?.name === './subagent-result.js');
if (resultRows.length === 1) pass('subagent_result registered exactly once (singleton)'); else fail(`subagent-result.js must be registered exactly once, got ${resultRows.length}`);
const resultSrc = readFileSync(join(presetDir, 'subagent-result.js'), 'utf8');
if (/readSurface/.test(resultSrc) && /parentSession/.test(resultSrc)) pass('subagent-result reads surfaces and authorizes by parentSession'); else fail('subagent-result missing readSurface/parentSession authorization');
if (/send_message/.test(resultSrc) && /without waking|without resuming|does not wake/i.test(resultSrc)) pass('subagent_result description contrasts with send_message'); else fail('subagent_result description must state it does not resume the child');
const roleSrc = readFileSync(join(presetDir, 'role-subagent.js'), 'utf8');
if (!/subagent_result/.test(roleSrc)) pass('role-subagent does not register subagent_result'); else fail('subagent_result leaked into role-subagent.js');
if (/roleId/.test(roleSrc) && /registerContinuableSetup/.test(roleSrc) && /dsh-mcp-client/.test(roleSrc)) pass('role plugin has stable ids and scoped MCP setup'); else fail('role plugin missing config/MCP setup');
if (/foregroundMcpNote/.test(roleSrc) && /were not mounted/.test(roleSrc)) pass('role plugin carries 方案3 foreground-MCP transparency'); else fail('role plugin missing foreground-MCP transparency');
const effortSrc = readFileSync(join(presetDir, 'effort-by-role.js'), 'utf8');
if (/roleFromPayload/.test(effortSrc) && !/mimo-v2\.5:\d+/.test(effortSrc)) pass('effort plugin uses role identity, not model:maxTokens'); else fail('effort plugin still uses compound model:maxTokens keys');
const personaTexts = roleRows.map((row) => row.config?.persona ?? '');
if (personaTexts.some((text) => /web_fetch/.test(text))) fail('persona exposes unavailable web_fetch'); else pass('no persona recommends web_fetch');
if (personaTexts.every((text) => !/\b(ast_grep_search|apply_patch)\b/.test(text))) pass('personas contain only DSH tool vocabulary'); else fail('persona contains unsupported tool vocabulary');
for (const file of ['role-subagent.js', 'subagent-result.js', 'web-fetch-gate.js', 'early-close-context.js', 'sandbox-strip.js']) {
  const src = readFileSync(join(presetDir, file), 'utf8');
  if (src.includes('zsh -lic') && src.includes('timeout: 2000') && src.includes("stdio: ['ignore', 'pipe', 'ignore']")) pass(`${file} bounds its shell probes`);
  else fail(`${file} must bound execSync probes (zsh -lic can hang; timeout + silent stderr required)`);
}

console.log('\n[5] soft-disabled roles');
const orchestratorRow = rows.find((row) => row?.id === 'persona');
const personaBlock = typeof orchestratorRow?.config?.text === 'string' ? orchestratorRow.config.text : '';
const observerRowCfg = rows.find((row) => row?.id === 'tool-subagent-observer')?.config;
if (!/subagent_observer/.test(personaBlock)) pass('orchestrator persona has no dead reference to subagent_observer'); else fail('orchestrator persona still advertises subagent_observer');
if (typeof observerRowCfg?.advertisement === 'string' && observerRowCfg.advertisement.includes('@observer')) pass('observer advertisement moved into its role row'); else fail('observer row missing advertisement block');
try {
  const obs = defaults?.presets?.[defaults?.preset]?.observer;
  if (obs?.enabled === false && ['oracle', 'designer', 'fixer', 'explorer', 'librarian'].every((id) => defaults.presets[defaults.preset][id]?.enabled === true)) {
    pass('defaults.json ships observer disabled, other roles enabled');
  } else fail(`defaults.json enabled flags wrong: ${JSON.stringify(Object.fromEntries(['oracle','designer','fixer','explorer','librarian','observer'].map((id) => [id, defaults.presets[defaults.preset][id]?.enabled])))}`);
} catch (error) { fail(`defaults.json enabled flags unreadable: ${error.message}`); }

console.log('\n[4] metadata and paths');
try {
  const meta = YAML.parse(readFileSync(join(presetDir, 'preset.yml'), 'utf8'));
  if (typeof meta?.name === 'string' && typeof meta?.description === 'string') pass('preset.yml metadata present'); else fail('preset.yml metadata incomplete');
} catch (error) { fail(`preset.yml invalid: ${error.message}`); }
for (const row of rows.filter((row) => typeof row?.name === 'string' && row.name.startsWith('./'))) {
  if (existsSync(join(presetDir, row.name))) pass(`relative plugin ${row.name} resolves`); else fail(`relative plugin ${row.name} missing`);
}

console.log('\n[6] distribution sync');
// The dev workspace keeps three identical composition copies: the root preset,
// the publish staging copy and the bundled npm preset copy. The copies visible
// from this script's own location must byte-match the composition it validates.
const syncCopies = basename(root) === 'publish'
  ? [join(root, '..', 'agent.cordis.yml'), join(root, '..', 'npm-package', 'preset', 'agent.cordis.yml')]
  : basename(dirname(root)) === 'npm-package' && basename(root) === 'preset'
    ? [join(root, '..', '..', 'agent.cordis.yml'), join(root, '..', '..', 'publish', 'agent.cordis.yml')]
    : [join(root, 'publish', 'agent.cordis.yml'), join(root, 'npm-package', 'preset', 'agent.cordis.yml')];
const composeSrc = readFileSync(composePath, 'utf8');
let syncFailures = 0;
for (const copy of syncCopies) {
  if (!existsSync(copy)) { fail(`composition copy missing: ${copy}`); syncFailures++; continue; }
  if (readFileSync(copy, 'utf8') !== composeSrc) { fail(`composition out of sync: ${copy}`); syncFailures++; }
}
if (syncFailures === 0) pass('composition copies are in sync');

console.log(failures === 0 ? '\nT0: ALL CHECKS PASSED' : `\nT0: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

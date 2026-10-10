// T0 static validation for the 0.6.x declarative line.
//
// The preset is no longer a directory: the repository root is a package whose
// export map serves the same modules as the published `npm-package/` content,
// and both bundle patches name exported package subpaths. This script asserts
// the invariants that would otherwise fail silently on a real host.
//
// Usage: node scripts/t0-validate.mjs
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plugins } from '../npm-package/preset/preset.js';
import { auditHostRows, referenceHostDir } from './audit-host-rows.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const pass = (line) => console.log(`PASS ${line}`);
const fail = (line) => { failures += 1; console.log(`FAIL ${line}`); };
const check = (ok, line) => (ok ? pass(line) : fail(line));
const read = (file) => readFileSync(join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));

// ---------------------------------------------------------------- manifests
const rootManifest = json('package.json');
const pkgManifest = json('npm-package/package.json');
check(rootManifest.name === 'oh-my-dsh-slim' && pkgManifest.name === 'oh-my-dsh-slim', 'both manifests name oh-my-dsh-slim');
check(rootManifest.version === pkgManifest.version, `root and npm-package versions agree (${rootManifest.version})`);
check(/^\d+\.\d+\.\d+$/.test(rootManifest.version), `release version carries no prerelease suffix (${rootManifest.version})`);

// ------------------------------------------------------------- export maps
const ROOT_EXPORTS = { '.': 'npm-package/lib/index.js', './preset': 'npm-package/preset/preset.js', './profile-registry': 'npm-package/lib/profile-registry.js', './client': 'npm-package/client/client.js' };
const PKG_EXPORTS = { '.': 'lib/index.js', './preset': 'preset/preset.js', './profile-registry': 'lib/profile-registry.js', './client': 'client/client.js' };
for (const [key, target] of Object.entries(ROOT_EXPORTS)) {
  const actual = rootManifest.exports?.[key];
  check(actual === `./${target}` && existsSync(join(root, target)), `root export ${key} → ${target}`);
}
for (const [key, target] of Object.entries(PKG_EXPORTS)) {
  const actual = pkgManifest.exports?.[key];
  check(actual === `./${target}` && existsSync(join(root, 'npm-package', target)), `npm-package export ${key} → ${target}`);
}
check(rootManifest.dsh?.bundle?.patch === './cordis.patch.yml' && existsSync(join(root, 'cordis.patch.yml')), 'root manifest declares the bundle patch');
check(pkgManifest.dsh?.bundle?.patch === './cordis.patch.yml' && existsSync(join(root, 'npm-package/cordis.patch.yml')), 'npm-package manifest declares the bundle patch');
check(pkgManifest.dsh?.client?.platform === 'web', 'npm-package declares its web client');

// ------------------------------------------------------------ bundle patches
// Rows must name exported subpaths: a path-based row is a second client-module
// source for the same package on a full web host.
const ROWS = ['preset-oh-my-dsh-slim:oh-my-dsh-slim/preset', 'oh-my-dsh-slim-profiles:oh-my-dsh-slim/profile-registry', 'oh-my-dsh-slim:oh-my-dsh-slim'];
for (const [file, label] of [['cordis.patch.yml', 'root patch'], ['npm-package/cordis.patch.yml', 'package patch']]) {
  const text = read(file);
  for (const row of ROWS) {
    const [id, name] = row.split(':');
    check(new RegExp(`id:\\s*${id}\\s*\\n\\s*name:\\s*'${name.replace(/[/]/g, '\\/')}'`).test(text), `${label} declares ${id} as ${name}`);
  }
  check(!/name:\s*'\.\.?\//.test(text), `${label} uses no relative-path row names`);
}

// ------------------------------------------------------- host range wiring
const hostVersion = read('npm-package/lib/host-version.js');
const min = /MIN_HOST_VERSION = '([^']+)'/.exec(hostVersion)?.[1];
const max = /MAX_HOST_VERSION_EXCLUSIVE = '([^']+)'/.exec(hostVersion)?.[1];
check(Boolean(min && max), `host-version.js declares the admitted range (${min} .. ${max})`);
const engines = pkgManifest.engines?.dsh ?? '';
check(engines === `>=${min} <${max}`, `engines.dsh matches host-version.js (${engines})`);
for (const [name, range] of Object.entries(pkgManifest.peerDependencies ?? {})) {
  check(range === `>=${min} <${max}`, `peer ${name} pinned to the same range`);
}
check(rootManifest.engines?.dsh === engines, 'root engines.dsh matches the package');

// --------------------------------------------------- published file surface
const files = pkgManifest.files ?? [];
for (const required of ['lib', 'client', 'preset', 'cordis.patch.yml', 'LICENSE']) {
  check(files.includes(required), `files[] ships ${required}`);
}
check(typeof pkgManifest.scripts?.prepare === 'string' && /README\.md/.test(pkgManifest.scripts.prepare), 'prepare copies README/CHANGELOG into the published package');

// ------------------------------------------------------------------- docs
const version = rootManifest.version;
check(read('README.md').includes(`oh-my-dsh-slim · ${version}`), `README.md states version ${version}`);
check(read('README.zh.md').includes(`oh-my-dsh-slim · ${version}`), `README.zh.md states version ${version}`);
check(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(read('CHANGELOG.md')), `CHANGELOG.md has a ${version} section`);
const stale = ['README.md', 'README.zh.md', 'npm-package/cordis.patch.yml', 'cordis.patch.yml']
  .filter((file) => /native\.\d/.test(read(file)));
check(stale.length === 0, `no pre-release label left in shipped docs${stale.length ? ` (${stale.join(', ')})` : ''}`);

// ------------------------------------------------------------- layout state
for (const file of ['agent.cordis.yml', 'preset.yml', 'config-loader.js', 'role-subagent.js']) {
  check(!existsSync(join(root, file)), `no directory-preset remnant at the root (${file})`);
}
check(existsSync(join(root, 'test')) && existsSync(join(root, 'legacy/v0.5.3')), 'test/ and legacy/v0.5.3/ are present (the archive test reads them)');

// -------------------------------------------------- agent-plane row intent
// A preset row is a definition, not a patch: 0.6.0-0.6.2 shipped the 0.5.3
// `tool-web: { fetch: false }` verbatim, and on 0.2.0 that dead declaration
// became effective and dropped web_fetch from every preset session. Pin the
// intended values here, and cross-check every shared host row with the audit
// below whenever a reference host is installed.
const flatten = (rows) => rows.flatMap((row) => [row, ...(row.group && Array.isArray(row.config) ? flatten(row.config) : [])]);
const rows = flatten(plugins);
const toolWeb = rows.find((row) => row.id === 'tool-web');
check(toolWeb?.config?.fetch === true && toolWeb?.config?.searchTimeoutMs === 60000,
  `tool-web keeps web_fetch enabled with the search timeout (${JSON.stringify(toolWeb?.config ?? null)})`);
const planMode = rows.find((row) => row.id === 'plan-mode');
check(typeof planMode?.config?.section === 'string' && planMode.config.section.trim() !== '',
  'plan-mode carries a non-empty baseline section (the host text is inherited at mount time)');

// ------------------------------------------------------- host-row audit
const audit = auditHostRows({ referenceDir: referenceHostDir() });
if (audit.skipped) {
  console.log(`SKIP host-row audit: ${audit.skipped}`);
} else {
  for (const failure of audit.failures) fail(failure);
  const { same, known, off, hostOff } = audit.summary;
  pass(`host-row audit (${same} identical, ${known} listed divergence, ${off} listed absence, ${hostOff} host default-off)`);
}

console.log(failures === 0 ? '\nT0 OK' : `\nT0 FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);

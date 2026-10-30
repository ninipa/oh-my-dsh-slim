// A retired host row must cost one tool, not the whole preset.
//
// issue #10: DSH master briefly folded `list_agents` into the
// `@deepseek-ai/dsh-tool-subagent-control` main entry and removed the
// `/list-agents` subpath export. `resolvedDefinition` resolved every row with
// `requireHost.resolve`, so that one export threw ERR_PACKAGE_PATH_NOT_EXPORTED
// out of `apply()` and the preset entry never activated — six roles lost to
// one retired subpath.
//
// These tests build a synthetic host node_modules tree instead of booting a
// host: the decision is a pure function of (base patch rows, resolvable entry).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { plugins, resolvedDefinition, patchRowIds } = await import(
  pathToFileURL(join(root, 'npm-package', 'preset', 'preset.js')).href
);

const CONTROL = '@deepseek-ai/dsh-tool-subagent-control';

const flatten = (rows) => rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? flatten(row.config) : [])]);
const declared = flatten(plugins);
// Every native row name this preset asks the host for.
const nativeNames = [...new Set(declared.map(row => row.name).filter(name => typeof name === 'string' && name.startsWith('@deepseek-ai/')))];
const basePackages = [...new Set(nativeNames.map(name => name.split('/').slice(0, 2).join('/')))];

/** Rows the preset mounts against a host that ships everything. */
const TOTAL_ROWS = declared.length;

const created = [];
test.after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * Write a host node_modules tree.
 * @param options.declareListAgents - the base patch still declares the row.
 * @param options.listAgentsEntry - 'present' | 'absent' | 'dangling': whether
 *   the control package exports `./list-agents` to an existing file.
 * @param options.missing - base package names to leave out of the tree.
 * @param options.patch - write `dsh-base/cordis.patch.yml` at all.
 * @returns the directory acting as the profile root.
 */
function syntheticHost({ declareListAgents = true, listAgentsEntry = 'present', missing = [], patch = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omds-preset-rows-'));
  const scope = join(dir, 'node_modules', '@deepseek-ai');
  mkdirSync(scope, { recursive: true });
  const omitted = new Set(missing.map(name => (name.includes('/') ? name : '@deepseek-ai/' + name)));
  for (const full of basePackages) {
    if (omitted.has(full)) continue;
    const pkg = full.split('/')[1];
    const pkgDir = join(scope, pkg);
    mkdirSync(join(pkgDir, 'lib'), { recursive: true });
    const exportsMap = {
      '.': './lib/index.js',
      ...(full === CONTROL && listAgentsEntry !== 'absent' ? { './list-agents': './lib/list-agents.js' } : {}),
    };
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: full, version: '0.0.0', type: 'module', exports: exportsMap }));
    writeFileSync(join(pkgDir, 'lib', 'index.js'), 'export default {};\n');
    if (full === CONTROL && listAgentsEntry === 'present') {
      writeFileSync(join(pkgDir, 'lib', 'list-agents.js'), 'export default {};\n');
    }
  }
  if (patch) {
    const baseDir = join(scope, 'dsh-base');
    mkdirSync(baseDir, { recursive: true });
    // No export map: the host resolves the patch by direct path.
    writeFileSync(join(baseDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-base', version: '0.0.0' }));
    writeFileSync(join(baseDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: plan-mode',
      "      name: '@deepseek-ai/dsh-plan-mode'",
      '      config:',
      '        section: |',
      '          Host plan text.',
      ...(declareListAgents
        ? [
          '    - id: tool-subagent-list-agents',
          "      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'",
        ]
        : []),
      '',
    ].join('\n'));
  }
  created.push(dir);
  return dir;
}

/** A context with the host base the preset would see, plus a warn recorder. */
function contextFor(dir) {
  const warnings = [];
  return {
    warnings,
    ctx: {
      loader: { config: { bareModuleBaseUrl: pathToFileURL(join(dir, 'package.json')).href } },
      logger: { warn: (...args) => warnings.push(args) },
    },
  };
}

const rowsOf = (definition) => flatten(definition.plugins);
const rowById = (definition, id) => rowsOf(definition).find(row => row.id === id);

test('patchRowIds reads nested rows and ignores prose', () => {
  const ids = patchRowIds([
    '# - id: commented-out',
    '- insert:',
    '    - id: plan-mode',
    "    - id: 'quoted-row'",
    '        - id: nested-row',
    '      config:',
    '        id: not-a-row',
  ].join('\n'));
  assert.deepEqual([...ids].sort(), ['nested-row', 'plan-mode', 'quoted-row']);
});

test('the list_agents row mounts when the host declares it and exports the subpath', () => {
  const { ctx, warnings } = contextFor(syntheticHost());
  const definition = resolvedDefinition(ctx);
  const row = rowById(definition, 'tool-subagent-list-agents');
  assert.ok(row, 'row is mounted');
  assert.match(row.name, /^file:\/\/.*dsh-tool-subagent-control\/lib\/list-agents\.js$/);
  assert.equal(rowsOf(definition).length, TOTAL_ROWS);
  assert.deepEqual(warnings, [], 'no warning on a host that still ships the row');
});

test('the row is dropped silently when the host base patch no longer declares it', () => {
  const { ctx, warnings } = contextFor(syntheticHost({ declareListAgents: false }));
  const definition = resolvedDefinition(ctx);
  assert.equal(rowById(definition, 'tool-subagent-list-agents'), undefined);
  assert.equal(rowsOf(definition).length, TOTAL_ROWS - 1, 'every other row still mounts');
  assert.deepEqual(warnings, [], 'the new host layout is not a warning: the capability moved upstream');
  // The rest of the delegation plane is untouched.
  assert.ok(rowById(definition, 'tool-subagent-control'));
});

test('a retired subpath skips only that row and warns once', () => {
  const { ctx, warnings } = contextFor(syntheticHost({ listAgentsEntry: 'absent' }));
  const definition = resolvedDefinition(ctx);
  assert.equal(rowById(definition, 'tool-subagent-list-agents'), undefined);
  assert.equal(rowsOf(definition).length, TOTAL_ROWS - 1);
  assert.equal(warnings.length, 1, 'exactly one warn for the skipped row');
  assert.equal(warnings[0][1], 'tool-subagent-list-agents');
  assert.equal(warnings[0][2], 'ERR_PACKAGE_PATH_NOT_EXPORTED');
  assert.equal(warnings[0][3], 'the list_agents tool');
  assert.match(warnings[0][0], /skipping %s and mounting the rest of the preset/);
});

test('a subpath pointing at a missing file is skipped too', () => {
  const { ctx, warnings } = contextFor(syntheticHost({ listAgentsEntry: 'dangling' }));
  const definition = resolvedDefinition(ctx);
  assert.equal(rowById(definition, 'tool-subagent-list-agents'), undefined);
  assert.equal(rowsOf(definition).length, TOTAL_ROWS - 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][2], 'MODULE_NOT_FOUND');
});

test('a required row still fails loudly', () => {
  const { ctx } = contextFor(syntheticHost({ missing: ['dsh-tool-fs'] }));
  assert.throws(() => resolvedDefinition(ctx), (error) => error?.code === 'MODULE_NOT_FOUND');
});

test('an unreadable base patch keeps the row (fail-open)', () => {
  const { ctx, warnings } = contextFor(syntheticHost({ patch: false }));
  const definition = resolvedDefinition(ctx);
  assert.ok(rowById(definition, 'tool-subagent-list-agents'), 'no evidence the host dropped it, so mount it');
  assert.equal(warnings.length, 1, 'only the plan-mode baseline warning');
  assert.match(String(warnings[0][0]), /plan-mode section/);
});

test('the inherited plan-mode section still comes from the host patch', () => {
  const { ctx } = contextFor(syntheticHost());
  assert.equal(rowById(resolvedDefinition(ctx), 'plan-mode').config.section, 'Host plan text.\n');
});

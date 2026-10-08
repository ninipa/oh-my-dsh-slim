// Guard the one duplication the DSH 0.2.0 layout still needs.
//
// The preset is authored once, in npm-package/preset/preset.js. Two bundle
// patches point at it: the repository-root cordis.patch.yml (used by
// `dsh plugin add github:...` and by a checkout added to dsh.profile.bundles)
// and npm-package/cordis.patch.yml (used by the published npm package). Only
// the `insert` row paths may differ between them; every other field must
// match, or one install path silently ships a different preset than the other.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sep } from 'node:path';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Structural/default tests must never read the developer's real role routes.
const isolatedHome = mkdtempSync(join(tmpdir(), 'omds-layout-'));
process.env.DSH_HOME = isolatedHome;
test.after(() => rmSync(isolatedHome, { recursive: true, force: true }));
const presetModule = await import(pathToFileURL(join(root, 'npm-package', 'preset', 'preset.js')).href);

// js-yaml is not a dependency of this repository: the bundle patches are YAML
// and the host parses them, so the tests reuse the copy the running DSH profile
// already installed, the same way dsh-app-boot parses these files. The preset
// itself is a JS module and needs no parser.
const { default: yaml } = await import(pathToFileURL(join(root, 'test', 'vendor', 'js-yaml-shim.mjs')).href);

const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (data) => data !== null && typeof data === 'object' && '__jsExpr' in data,
  represent: (data) => data.__jsExpr,
});
const schema = yaml.JSON_SCHEMA.extend(JsExpr);

function loadPatch(relativePath) {
  const document = yaml.load(readFileSync(join(root, relativePath), 'utf8'), { schema });
  assert.ok(Array.isArray(document), relativePath + ' must be a top-level patch list');
  const rows = [];
  for (const patch of document) {
    assert.ok(Array.isArray(patch?.insert), relativePath + ' must declare rows through `insert`');
    rows.push(...patch.insert);
  }
  return rows;
}

/** The repository patch addresses the same file one directory higher. */
function packageRelative(name) {
  return './' + name.replace(/^[.]\//, '').replace(/^npm-package\//, '');
}

test('both bundle patches declare the same preset row', () => {
  const repo = loadPatch('cordis.patch.yml');
  const published = loadPatch('npm-package/cordis.patch.yml');
  assert.deepEqual(repo.map((row) => row.id), published.map((row) => row.id));
  for (const [index, row] of repo.entries()) {
    const mirror = published[index];
    assert.equal(mirror.id, row.id);
    assert.equal(mirror.name, packageRelative(row.name), 'row ' + row.id + ': package-relative name');
    assert.deepEqual(mirror.config ?? null, row.config ?? null, 'row ' + row.id + ': config');
    assert.deepEqual(mirror.disabled ?? null, row.disabled ?? null, 'row ' + row.id + ': disabled');
  }
});

/**
 * The preset declaration as the host sees it. preset.js has to be two things
 * at once: the plugin a bundle-patch row imports (rows are reached with
 * import(), and a module that only exports data activates no fiber at all), and
 * the source of the declaration that plugin registers.
 * @returns {Promise<object>} the `@deepseek-ai/dsh-agent-preset` row it declares
 */
async function loadPresetDeclaration() {
  const rows = loadPatch('npm-package/cordis.patch.yml');
  const row = rows.find((candidate) => candidate.id === 'preset-oh-my-dsh-slim');
  assert.equal(row.name, './preset/preset.js');
  const module = await import(pathToFileURL(join(root, 'npm-package', 'preset', 'preset.js')).href);
  assert.equal(typeof module.apply, 'function', 'preset.js must export the plugin apply() a row can mount');
  assert.deepEqual(module.inject, ['agentPresets', 'loader'], 'preset.js registers through the preset registry service');
  const declaration = { id: row.id, name: '@deepseek-ai/dsh-agent-preset', config: module.definition };
  assert.deepEqual(declaration.config, module.patch.insert[0].config, 'definition and patch agree');
  assert.equal(declaration.config.id, module.PRESET_ID);
  return declaration;
}

test('the preset row points at the authored preset module', async () => {
  const declaration = await loadPresetDeclaration();
  assert.equal(declaration.id, 'preset-oh-my-dsh-slim');
  assert.equal(declaration.name, '@deepseek-ai/dsh-agent-preset');
  assert.equal(declaration.config.id, 'oh-my-dsh-slim');
  assert.ok(declaration.config.plugins.length > 0, 'the preset declares plugins');
  for (const row of declaration.config.plugins) {
    assert.ok(typeof row.name === 'string' && row.name.length > 0, 'plugin row ' + String(row.id) + ' names a plugin');
  }
});

test('every package-local plugin row names an existing absolute file URL', () => {
  const declaration = { config: presetModule.definition };
  const presetDir = join(root, 'npm-package', 'preset') + sep;
  const walk = (rows) => {
    for (const row of rows) {
      // A relative './x.js' row silently never starts: the registry mounts a
      // declaration under the baseUrl of the patch that DECLARED it, so the
      // relative name resolves beside the profile, not beside preset.js.
      assert.doesNotMatch(
        String(row.name),
        /^[.]{1,2}\//,
        'preset row ' + String(row.id) + ' must not name a plugin by a relative path',
      );
      if (typeof row.name === 'string' && row.name.startsWith('file:')) {
        const file = fileURLToPath(row.name);
        assert.ok(
          file.startsWith(presetDir),
          'preset row ' + String(row.id) + ' points outside the preset directory: ' + file,
        );
        assert.doesNotThrow(
          () => readFileSync(file),
          'preset row ' + String(row.id) + ' points at a missing file: ' + file,
        );
        assert.doesNotMatch(file, /[.]ya?ml$/, 'preset row ' + String(row.id) + ' names a YAML file, which import() rejects');
      }
      if (Array.isArray(row.config)) walk(row.config);
    }
  };
  walk(declaration.config.plugins);
});

test('the bundled defaults reach every role without a user config file', async () => {
  const config = await import(pathToFileURL(join(root, 'npm-package', 'preset', 'config.js')).href);
  // defaults.json is a full document of the same shape as a user config, and its
  // own presets[<name>] table is the lowest-priority channel. Reading only the
  // user document dropped every shipped role setting and left the RUNTIME_DEFAULTS
  // floor, so a fresh install delegated with no provider and no model at all.
  const previous = {
    OH_MY_DSH_SLIM_CONFIG: process.env.OH_MY_DSH_SLIM_CONFIG,
    OH_MY_DSH_SLIM_PROFILE_DIR: process.env.OH_MY_DSH_SLIM_PROFILE_DIR,
  };
  process.env.OH_MY_DSH_SLIM_CONFIG = join(root, '__no_user_config__.json');
  process.env.OH_MY_DSH_SLIM_PROFILE_DIR = join(root, '__no_profile_snapshot__');
  try {
    config.resetConfigForTests();
    const loaded = config.loadConfig();
    assert.equal(loaded.preset, 'my-dsh-normal');
    assert.ok(loaded.servers.context7, 'the bundled MCP servers survive');
    for (const roleId of config.ROLE_IDS) {
      const role = loaded.roles[roleId];
      const shipped = JSON.parse(readFileSync(join(root, 'npm-package', 'preset', 'defaults.json'), 'utf8'))
        .presets['my-dsh-normal'][roleId];
      assert.equal(role.provider, shipped.provider, roleId + ': shipped provider');
      assert.equal(role.model, shipped.model, roleId + ': shipped model');
      assert.equal(role.effort, shipped.effort, roleId + ': shipped effort');
      assert.deepEqual(role.deny ?? [], shipped.deny ?? [], roleId + ': shipped deny');
    }
    assert.deepEqual(loaded.roles.oracle.mcps, []);
    assert.deepEqual(loaded.roles.librarian.mcps, ['context7', 'gh_grep']);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    config.resetConfigForTests();
  }
});

test('a partial user override keeps the shipped role settings', async () => {
  const config = await import(pathToFileURL(join(root, 'npm-package', 'preset', 'config.js')).href);
  // The role layers merge key by key: a user document that names only a model
  // must not erase the shipped provider, effort and deny list, or a small
  // override would silently widen a role's tool access.
  const dir = mkdtempSync(join(tmpdir(), 'omds-config-'));
  const file = join(dir, 'user.json');
  writeFileSync(file, JSON.stringify({
    preset: 'my-dsh-normal',
    roles: { oracle: { model: 'custom-oracle-model' }, explorer: { enabled: false } },
  }));
  const previous = {
    OH_MY_DSH_SLIM_CONFIG: process.env.OH_MY_DSH_SLIM_CONFIG,
    OH_MY_DSH_SLIM_PROFILE_DIR: process.env.OH_MY_DSH_SLIM_PROFILE_DIR,
  };
  process.env.OH_MY_DSH_SLIM_CONFIG = file;
  process.env.OH_MY_DSH_SLIM_PROFILE_DIR = dir;
  try {
    config.resetConfigForTests();
    const roles = config.loadConfig().roles;
    assert.equal(roles.oracle.model, 'custom-oracle-model', 'the user model wins');
    assert.equal(roles.oracle.provider, 'deepseek-official', 'the shipped provider survives');
    assert.equal(roles.oracle.effort, 'max', 'the shipped effort survives');
    assert.deepEqual(
      roles.oracle.deny,
      ['edit', 'write', 'skill', 'job_kill', 'job_list', 'job_output', 'todo_write', 'ask_user_question'],
      'the shipped deny list survives a model-only override',
    );
    assert.equal(roles.oracle.maxTokens, 128000, 'the runtime floor still applies');
    assert.equal(roles.explorer.enabled, false, 'the user may disable one role');
    assert.equal(roles.designer.model, 'deepseek-v4-flash', 'untouched roles stay upstream shipped');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    config.resetConfigForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each role carries its shipped route into the host agentOptions', async () => {
  const roles = await import(pathToFileURL(join(root, 'npm-package', 'preset', 'roles.js')).href);
  const defaults = JSON.parse(readFileSync(join(root, 'npm-package', 'preset', 'defaults.json'), 'utf8'));
  const shipped = defaults.presets['my-dsh-normal'];
  // The host reads a child route from agentOptions.reasoningEffort; an effort
  // kept only in the role document never reaches the delegated model, so every
  // role would silently run at the parent's effort.
  for (const roleId of roles.roleIds()) {
    const role = roles.resolveRole({ definition: { roleId, persona: 'body' } });
    assert.equal(role.agentOptions.provider, shipped[roleId].provider, roleId + ': provider reaches the host');
    assert.equal(role.agentOptions.model, shipped[roleId].model, roleId + ': model reaches the host');
    assert.equal(role.agentOptions.reasoningEffort, shipped[roleId].effort, roleId + ': effort reaches the host');
    assert.equal(typeof role.agentOptions.maxTokens, 'number', roleId + ': maxTokens reaches the host');
    assert.deepEqual(role.toolFilter.deny, shipped[roleId].deny, roleId + ': deny reaches the tool filter');
  }
  assert.equal(roles.resolveRole({ definition: { roleId: 'oracle', persona: 'body' } }).toolFilter.allow, undefined);
});

test('the role wrapper hands the host every service and key it needs', async () => {
  const roles = await import(pathToFileURL(join(root, 'npm-package', 'preset', 'roles.js')).href);
  // The wrapper does not re-implement delegation: it imports the host's own
  // @deepseek-ai/dsh-tool-subagent and calls its apply(). Cordis refuses every
  // service read that the calling fiber does not inject, so the wrapper's inject
  // list has to cover what the HOST implementation reads (tools, subagents,
  // systemPrompt, sessionProjections) on top of its own `loader`. Dropping one
  // makes the rows mount silently with no role tool at all.
  for (const service of ['loader', 'tools', 'subagents', 'systemPrompt', 'sessionProjections']) {
    assert.ok(roles.inject.includes(service), 'the role wrapper must inject "' + service + '"');
  }
  // ...and the config it forwards must name the tool. The host defaults
  // `toolName` to its own `subagent`, so losing the key here registers a
  // generically named tool and the role silently disappears from the model.
  const stock = roles.stockConfig(
    { provider: 'spawn', backgroundMode: 'continuable', maxDepth: 1, definition: { roleId: 'oracle' } },
    { agentOptions: {}, persona: 'body', toolFilter: undefined, toolName: 'subagent_oracle' },
  );
  assert.equal(stock.toolName, 'subagent_oracle');
  assert.equal(stock.persona, 'body');
  assert.ok(!('definition' in stock), 'the preset-only `definition` key must not reach the host');
  const role = roles.resolveRole({ provider: 'spawn', definition: { roleId: 'oracle', persona: 'body' } });
  assert.equal(role.stock.toolName, role.toolName, 'resolveRole forwards the row tool name');
  assert.equal(role.toolName, 'subagent_oracle');
});

test('the preset declares one role tool per advertised role', async () => {
  const declaration = await loadPresetDeclaration();
  const module = await import(pathToFileURL(join(root, 'npm-package', 'preset', 'preset.js')).href);
  const roles = await import(pathToFileURL(join(root, 'npm-package', 'preset', 'roles.js')).href);
  const rows = [];
  const walk = (list) => {
    for (const row of list) {
      rows.push(row);
      if (Array.isArray(row.config)) walk(row.config);
    }
  };
  walk(declaration.config.plugins);
  const rolesUrl = pathToFileURL(join(root, 'npm-package', 'preset', 'roles.js')).href;
  const roleRows = rows.filter((row) => row.name === rolesUrl);
  assert.deepEqual(
    roleRows.map((row) => row.config.definition.roleId),
    roles.roleIds(),
    'one role row per role, in roster order',
  );
  for (const row of roleRows) {
    const roleId = row.config.definition.roleId;
    const table = roles.ROLE_TABLE[roleId];
    assert.equal(row.id, 'tool-' + table.toolName.replace(/_/g, '-'), 'tool row id for ' + roleId);
    const body = String(row.config.definition.persona ?? '');
    assert.ok(body.trim().length > 0, roleId + ' declares a role body');
    assert.ok(!body.includes(roles.ROLE_MARKER_PREFIX), roleId + ' must not carry a marker of its own');
    const persona = roles.composeRolePersona(roleId, body, undefined, undefined);
    assert.ok(
      persona.startsWith('Internal role id: ' + roles.ROLE_MARKER_PREFIX + roleId + '.'),
      roleId + ' persona must open with its role marker',
    );
    assert.equal(roles.roleIdFromEvents([{ type: 'subagent/descriptor', data: { persona } }]), roleId);
  }
});

// Council configuration surface: the derived synthesizer switch, the fixed
// permission ceiling, and the validation negatives that keep MCP tools and
// prompt variables out of council roles. Zero-cost, no host.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COUNCIL_ROLE_ID, COUNCILLOR_ROLE_IDS, MIN_COUNCIL_SEATS, UPSTREAM_ROLE_IDS,
  councilActive, councilSeats, loadConfig, resetConfigForTests, validateConfigDocument,
} from '../npm-package/preset/config.js';
import { ROLE_TABLE, effectiveRoleFilter } from '../npm-package/preset/roles.js';
import { roleFilter } from '../npm-package/preset/role-composition.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const defaults = JSON.parse(readFileSync(join(root, 'npm-package', 'preset', 'defaults.json'), 'utf8'));
const shipped = defaults.presets[defaults.preset];

function fixture(t, document = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omds-council-config-'));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(document));
  const previous = { OH_MY_DSH_SLIM_CONFIG: process.env.OH_MY_DSH_SLIM_CONFIG, OH_MY_DSH_SLIM_PROFILE_DIR: process.env.OH_MY_DSH_SLIM_PROFILE_DIR, DSH_HOME: process.env.DSH_HOME };
  process.env.OH_MY_DSH_SLIM_CONFIG = file;
  process.env.OH_MY_DSH_SLIM_PROFILE_DIR = join(dir, 'no-snapshot');
  process.env.DSH_HOME = dir;
  resetConfigForTests();
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfigForTests();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, file, save: doc => writeFileSync(file, JSON.stringify(doc)) };
}

test('council roster and defaults: seats and synthesizer ship disabled', t => {
  fixture(t, {});
  const config = loadConfig();
  assert.deepEqual(COUNCILLOR_ROLE_IDS, ['councillor-alpha', 'councillor-beta', 'councillor-gamma']);
  assert.equal(MIN_COUNCIL_SEATS, 2);
  assert.deepEqual(councilSeats(config.roles), []);
  assert.equal(councilActive(config.roles), false);
  assert.equal(config.roles[COUNCIL_ROLE_ID].enabled, false, 'synthesizer derives to off');
  for (const roleId of COUNCILLOR_ROLE_IDS) {
    assert.equal(shipped[roleId].enabled, false, roleId + ': shipped disabled');
    assert.deepEqual(shipped[roleId].tools, ['read', 'glob', 'grep'], roleId + ': shipped read-only');
    assert.equal(shipped[roleId].provider, undefined, roleId + ': model inherited');
  }
  for (const roleId of UPSTREAM_ROLE_IDS) {
    assert.deepEqual(config.roles[roleId].deny ?? [], shipped[roleId].deny ?? [], roleId + ': upstream role untouched');
  }
});

test('the synthesizer is derived from enabled seats (>= 2), never from its own flag', t => {
  const f = fixture(t, {});
  const enable = (...seats) => {
    f.save({ roles: Object.fromEntries(seats.map(seat => [seat, { enabled: true }])) });
    resetConfigForTests();
    return loadConfig();
  };
  const one = enable('councillor-alpha');
  assert.deepEqual(councilSeats(one.roles), ['councillor-alpha']);
  assert.equal(councilActive(one.roles), false, 'one seat is an ordinary delegation');
  assert.equal(one.roles[COUNCIL_ROLE_ID].enabled, false);

  const two = enable('councillor-alpha', 'councillor-beta');
  assert.deepEqual(councilSeats(two.roles), ['councillor-alpha', 'councillor-beta']);
  assert.equal(councilActive(two.roles), true);
  assert.equal(two.roles[COUNCIL_ROLE_ID].enabled, true);

  const three = enable('councillor-alpha', 'councillor-beta', 'councillor-gamma');
  assert.equal(councilActive(three.roles), true);

  // The flag is not a kill switch in either direction.
  f.save({ roles: { council: { enabled: true } } });
  resetConfigForTests();
  assert.equal(councilActive(loadConfig().roles), false, 'a true flag with zero seats stays off');
  f.save({ roles: { council: { enabled: false }, 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } });
  resetConfigForTests();
  assert.equal(councilActive(loadConfig().roles), true, 'a false flag with two seats still activates');
});

test('the seat permission ceiling can only be narrowed, never widened', () => {
  assert.equal(ROLE_TABLE['councillor-alpha'].fixedAllow.join(','), 'read,glob,grep');
  assert.deepEqual(effectiveRoleFilter('councillor-alpha', {}), { allow: ['read', 'glob', 'grep'] });
  assert.deepEqual(effectiveRoleFilter('councillor-alpha', { tools: ['read'] }), { allow: ['read'] });
  assert.deepEqual(effectiveRoleFilter('councillor-alpha', { tools: ['bash'] }), { allow: [] }, 'user cannot add bash');
  assert.deepEqual(effectiveRoleFilter('councillor-alpha', { tools: ['read', 'bash'] }), { allow: ['read'] });
  assert.deepEqual(effectiveRoleFilter('councillor-alpha', {}, { allow: ['bash'] }), { allow: [] }, 'row definition cannot add bash');
  assert.deepEqual(effectiveRoleFilter('councillor-alpha', {}, { allow: ['read', 'grep'] }), { allow: ['read', 'grep'] });
  // deny is a separate list; the host's restrict() applies it over allow.
  assert.deepEqual(effectiveRoleFilter('councillor-alpha', { deny: ['grep'] }), { allow: ['read', 'glob', 'grep'], deny: ['grep'] });
  assert.deepEqual(effectiveRoleFilter('councillor-alpha', { tools: [] }), { allow: ['read', 'glob', 'grep'] }, 'empty tools is not configured');
});

test('the synthesizer is tool-less no matter what the user writes', () => {
  assert.equal(ROLE_TABLE.council.synthesisOnly, true);
  assert.deepEqual(effectiveRoleFilter('council', {}), { allow: [] });
  assert.deepEqual(effectiveRoleFilter('council', { tools: ['bash'] }), { allow: [] });
  assert.deepEqual(effectiveRoleFilter('council', { tools: ['read'], deny: [] }), { allow: [] });
  assert.deepEqual(effectiveRoleFilter('council', { deny: ['read'] }, { allow: ['bash'] }), { allow: [] });
});

test('upstream roles keep their historical filter shape', () => {
  const oracle = effectiveRoleFilter('oracle', { deny: ['edit', 'write'] });
  assert.equal(oracle.allow, undefined);
  assert.deepEqual(oracle.deny, ['edit', 'write']);
  assert.equal(effectiveRoleFilter('fixer', {}), undefined);
  assert.deepEqual(effectiveRoleFilter('explorer', { tools: ['read', 'glob'] }), { allow: ['read', 'glob'] }, 'non-ceiling roles still accept a user allow list');
  // The role-composition wrapper must agree with resolveRole's helper.
  for (const [roleId, config, definition] of [
    ['oracle', { deny: ['edit'] }, {}],
    ['councillor-alpha', { tools: ['bash'] }, {}],
    ['councillor-alpha', {}, { allow: ['bash'] }],
    ['council', { tools: ['bash'] }, {}],
  ]) {
    assert.deepEqual(roleFilter(roleId, config, definition), effectiveRoleFilter(roleId, config, definition), roleId + ': filters agree');
  }
});

test('council roles reject MCP servers at validation time', t => {
  for (const roleId of [...COUNCILLOR_ROLE_IDS, COUNCIL_ROLE_ID]) {
    const f = fixture(t, { roles: { [roleId]: { mcps: ['context7'] } } });
    assert.throws(() => loadConfig(), /mcps is not supported/, roleId + ': loadConfig');
    assert.throws(() => validateConfigDocument({ roles: { [roleId]: { mcps: ['context7'] } } }), /mcps is not supported/, roleId + ': validate');
    f.save({ roles: { [roleId]: { mcps: [] } } });
    resetConfigForTests();
    assert.deepEqual(loadConfig().roles[roleId].mcps, [], roleId + ': empty mcps is fine');
  }
});

test('personaAppend is validated for type, size and interpolation shape', t => {
  const f = fixture(t, {});
  const expectThrow = (value, pattern) => {
    f.save({ roles: { 'councillor-alpha': { personaAppend: value } } });
    resetConfigForTests();
    assert.throws(() => loadConfig(), pattern);
  };
  expectThrow(42, /personaAppend must be a string/);
  expectThrow('x'.repeat(8001), /at most 8000 characters/);
  expectThrow('focus on {{model}}', /must not contain \{\{\.\.\.\}\}/);
  f.save({ roles: { 'councillor-alpha': { personaAppend: 'Focus on failure recovery.' } } });
  resetConfigForTests();
  assert.equal(loadConfig().roles['councillor-alpha'].personaAppend, 'Focus on failure recovery.');
  f.save({ roles: { 'councillor-alpha': { personaAppend: '' } } });
  resetConfigForTests();
  assert.equal(loadConfig().roles['councillor-alpha'].personaAppend, '');
});

test('derived council state survives every config channel shape', t => {
  const f = fixture(t, {});
  // Legacy presets[<name>] shape.
  f.save({ presets: { 'my-dsh-normal': { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } } });
  resetConfigForTests();
  assert.equal(councilActive(loadConfig().roles), true, 'legacy preset shape');
  // Compact roles shape.
  f.save({ roles: { 'councillor-gamma': { enabled: true }, 'councillor-alpha': { enabled: true } } });
  resetConfigForTests();
  assert.deepEqual(councilSeats(loadConfig().roles), ['councillor-alpha', 'councillor-gamma'], 'compact shape, roster order');
  // advanced.roles shape.
  f.save({ advanced: { roles: { 'councillor-beta': { enabled: true }, 'councillor-gamma': { enabled: true } } } });
  resetConfigForTests();
  assert.equal(councilActive(loadConfig().roles), true, 'advanced shape');
  // An existing install that never knew about council still gets the derived off state.
  f.save({ roles: { oracle: { model: 'custom' } } });
  resetConfigForTests();
  const config = loadConfig();
  assert.equal(config.roles.oracle.model, 'custom');
  assert.equal(councilActive(config.roles), false);
  assert.equal(config.roles[COUNCIL_ROLE_ID].enabled, false);
  assert.ok(!existsSync(join(f.dir, 'untouched.json')), 'the fixture never writes outside its own file');
});

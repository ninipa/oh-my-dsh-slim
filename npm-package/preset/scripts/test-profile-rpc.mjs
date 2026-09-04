// Zero-cost unit test for the /omds profile endpoints
// (makeProfileEndpoints in ../npm-package/lib/index.js). Drives the endpoint
// logic with a mock agent-presets roster over REAL temp directories: every
// endpoint has success, conflict, and failure paths, and the failure paths
// assert the roster never stays half-authored.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeProfileEndpoints,
  profileIdForDisplayName,
  isCustomProfileId,
} from '../npm-package/lib/index.js';

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
const BUNDLED = 'oh-my-dsh-slim';

function parseMetaYaml(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
  return out;
}

function renderMetaYaml(name, description) {
  return `${name === undefined ? '' : `name: ${JSON.stringify(name)}\n`}${description === undefined ? '' : `description: ${JSON.stringify(description)}\n`}order: 10\n`;
}

/** Mock of the DSH agent-presets authoring service over a temp root. */
function makeRoster(root, options = {}) {
  const state = { defaultId: options.defaultId };
  const dirOf = (id) => join(root, id);
  function row(id) {
    const dir = dirOf(id);
    if (!existsSync(join(dir, 'agent.cordis.yml'))) return undefined;
    const meta = existsSync(join(dir, 'preset.yml')) ? parseMetaYaml(readFileSync(join(dir, 'preset.yml'), 'utf8')) : {};
    return { id, trust: 'user', path: join(dir, 'agent.cordis.yml'), ...meta };
  }
  return {
    state,
    async list() {
      const out = [];
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !PRESET_ID.test(entry.name)) continue;
        const found = row(entry.name);
        if (found) out.push(found);
      }
      return out.sort((a, b) => a.id.localeCompare(b.id));
    },
    async resolve(id) {
      const found = row(id);
      if (!found) throw Object.assign(new Error(`unknown preset "${id}"`), { code: 'UnknownPresetError' });
      return found;
    },
    async copy(from, id, name) {
      const source = row(from);
      if (!source) throw new Error(`unknown source "${from}"`);
      const target = dirOf(id);
      if (existsSync(target)) throw Object.assign(new Error(`preset "${id}" already exists`), { code: 'PresetExistsError' });
      cpSync(dirOf(from), target, { recursive: true });
      writeFileSync(join(target, 'preset.yml'), renderMetaYaml(name, source.description));
    },
    async remove(id) {
      if (!existsSync(dirOf(id))) throw new Error(`unknown preset "${id}"`);
      rmSync(dirOf(id), { recursive: true, force: true });
    },
    get defaultId() { return state.defaultId; },
  };
}

function seedBundled(root) {
  const dir = join(root, BUNDLED);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.cordis.yml'), 'rows: []\n');
  writeFileSync(join(dir, 'preset.yml'), renderMetaYaml('极简角色委派', 'default description'));
  writeFileSync(join(dir, 'defaults.json'), '{"preset":"my-dsh-normal","presets":{"my-dsh-normal":{"oracle":{"model":"m1"}}}}\n');
}

function makeHome(label) {
  const home = join(tmpdir(), `omds-rpc-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(home, { recursive: true });
  return home;
}

const makeSettings = () => {
  const calls = [];
  return {
    calls,
    async mutate(ns, ops) { calls.push({ ns, ops }); },
  };
};

const VALID_CONFIG = { preset: 'my-dsh-normal', roles: { fixer: { model: 'custom-model', effort: 'max' } } };

{
  const home = makeHome('list');
  seedBundled(home);
  const roster = makeRoster(home, { defaultId: BUNDLED });
  const endpoints = makeProfileEndpoints({ agentPresets: roster, getSettings: () => undefined, log: {} });
  const listed = await endpoints.list();
  check(listed.profiles.length === 1 && listed.profiles[0].id === BUNDLED, 'list: bundled profile alone with no custom profiles');
  check(listed.profiles[0].kind === 'bundled' && listed.profiles[0].isDefaultForNewSessions === true, 'list: bundled is the default when no other default is chosen');
  check(listed.profiles[0].revision === undefined, 'list: bundled profile has no file revision (settings channel)');
  check(listed.defaultProfileId === BUNDLED, 'list: defaultProfileId falls back to the bundled id');
  rmSync(home, { recursive: true, force: true });
}

{
  const home = makeHome('create');
  seedBundled(home);
  const roster = makeRoster(home);
  const endpoints = makeProfileEndpoints({ agentPresets: roster, getSettings: () => undefined, log: {} });
  const created = await endpoints.create({ displayName: 'GPT 系列', config: VALID_CONFIG });
  const id = profileIdForDisplayName('GPT 系列');
  check(created.id === id && created.displayName === 'GPT 系列', `create: stable id + display name (${id})`);
  check(typeof created.revision === 'string' && created.revision.length === 16, 'create: content revision returned');
  check(existsSync(join(home, id, 'agent.cordis.yml')), 'create: real preset directory materialized');
  const meta = parseMetaYaml(readFileSync(join(home, id, 'preset.yml'), 'utf8'));
  check(meta.name === 'GPT 系列' && meta.description === 'default description', 'create: metadata copied with the new display name');
  const snapshot = JSON.parse(readFileSync(join(home, id, 'profile.json'), 'utf8'));
  check(snapshot.roles.fixer.model === 'custom-model', 'create: config snapshot persisted');
  const after = await endpoints.list();
  const entry = after.profiles.find((profile) => profile.id === id);
  check(entry?.kind === 'custom' && entry.revision === created.revision, 'create: roster lists the new profile with its revision');
  check(JSON.stringify(entry?.config) === JSON.stringify(VALID_CONFIG), 'create: roster returns the persisted config');
  rmSync(home, { recursive: true, force: true });
}

{
  const home = makeHome('create-fail');
  seedBundled(home);
  const roster = makeRoster(home);
  const endpoints = makeProfileEndpoints({ agentPresets: roster, getSettings: () => undefined, log: {} });
  const first = await endpoints.create({ displayName: 'GPT 系列', config: {} });
  let dupErr;
  try { await endpoints.create({ displayName: 'gpt 系列', config: {} }); } catch (error) { dupErr = error; }
  check(dupErr?.code === 'PROFILE_NAME_CONFLICT', 'create: case-insensitive duplicate name rejected');
  const id = profileIdForDisplayName('GPT 系列');
  check(existsSync(join(home, id)), 'create: first profile untouched by the rejected duplicate');
  let invalidErr;
  try { await endpoints.create({ displayName: '坏配置', config: { roles: { oracle: { effort: 'bogus' } } } }); } catch (error) { invalidErr = error; }
  check(invalidErr?.code === 'PROFILE_INVALID_CONFIG', 'create: invalid config rejected');
  const badId = profileIdForDisplayName('坏配置');
  check(!existsSync(join(home, badId)), 'create: invalid-config failure rolls the copy back (no half-authored profile)');
  let emptyName;
  try { await endpoints.create({ displayName: '   ', config: {} }); } catch (error) { emptyName = error; }
  check(emptyName instanceof TypeError && emptyName?.code === undefined, 'create: empty name rejected');
  let longName;
  try { await endpoints.create({ displayName: 'x'.repeat(65), config: {} }); } catch (error) { longName = error; }
  check(longName instanceof RangeError, 'create: over-64 name rejected');
  check(isCustomProfileId(first.id), 'isCustomProfileId: profile ids are custom');
  rmSync(home, { recursive: true, force: true });
}

{
  const home = makeHome('save');
  seedBundled(home);
  const roster = makeRoster(home);
  const endpoints = makeProfileEndpoints({ agentPresets: roster, getSettings: () => undefined, log: {} });
  const created = await endpoints.create({ displayName: 'DeepSeek 系列', config: {} });
  const id = created.id;
  // A second profile must stay untouched when the first is saved (save-isolation).
  const other = await endpoints.create({ displayName: 'GPT 系列', config: { roles: { fixer: { model: 'gpt-model' } } } });
  const configPath = join(home, id, 'profile.json');
  const saved = await endpoints.save({ id, config: VALID_CONFIG, expectedRevision: created.revision });
  check(saved.revision !== created.revision && saved.revision.length === 16, 'save: config persisted with a fresh revision');
  check(JSON.parse(readFileSync(configPath, 'utf8')).roles.fixer.model === 'custom-model', 'save: snapshot content replaced atomically');
  check(
    JSON.parse(readFileSync(join(home, other.id, 'profile.json'), 'utf8')).roles.fixer.model === 'gpt-model',
    'save: other profiles untouched (per-profile isolation)',
  );
  let stale;
  try { await endpoints.save({ id, config: {}, expectedRevision: created.revision }); } catch (error) { stale = error; }
  check(stale?.code === 'PROFILE_CONFLICT', 'save: stale expectedRevision refused (two-writer fencing)');
  let noRev;
  try { await endpoints.save({ id, config: {} }); } catch (error) { noRev = error; }
  check(noRev?.code === 'PROFILE_CONFLICT', 'save: missing expectedRevision refused');
  let unknown;
  try { await endpoints.save({ id: 'profile-ghost-000', config: {}, expectedRevision: 'none' }); } catch (error) { unknown = error; }
  check(unknown?.code === 'PROFILE_NOT_FOUND', 'save: unknown profile refused');
  let bundledSave;
  try { await endpoints.save({ id: BUNDLED, config: {}, expectedRevision: 'none' }); } catch (error) { bundledSave = error; }
  check(bundledSave?.code === 'PROFILE_UNSUPPORTED', 'save: bundled profile refused (it saves through the settings namespace)');
  let invalid;
  try { await endpoints.save({ id, config: { roles: { explorer: { tools: ['bogus-tool'] } } }, expectedRevision: saved.revision }); } catch (error) { invalid = error; }
  check(invalid?.code === 'PROFILE_INVALID_CONFIG', 'save: invalid config refused without touching the snapshot');
  check(JSON.parse(readFileSync(configPath, 'utf8')).roles.fixer.model === 'custom-model', 'save: refused invalid config left the snapshot intact');
  rmSync(home, { recursive: true, force: true });
}

{
  const home = makeHome('rename');
  seedBundled(home);
  const roster = makeRoster(home);
  const endpoints = makeProfileEndpoints({ agentPresets: roster, getSettings: () => undefined, log: {} });
  const created = await endpoints.create({ displayName: '重命名前', config: {} });
  const id = created.id;
  const renamed = await endpoints.save({
    id, config: {}, expectedRevision: created.revision, displayName: '重命名后',
  });
  const meta = parseMetaYaml(readFileSync(join(home, id, 'preset.yml'), 'utf8'));
  check(meta.name === '重命名后', 'rename: display metadata updated (id unchanged)');
  check(renamed.id === id && renamed.displayName === '重命名后', 'rename: response carries the new name and the same id');
  check(renamed.revision === created.revision, 'rename: name change does not touch the config revision');
  // Rename onto an existing profile name → conflict.
  await endpoints.create({ displayName: '另一配置', config: {} });
  let conflict;
  try {
    await endpoints.save({ id, config: {}, expectedRevision: renamed.revision, displayName: '另一配置' });
  } catch (error) { conflict = error; }
  check(conflict?.code === 'PROFILE_NAME_CONFLICT', 'rename: onto an existing display name refused');
  rmSync(home, { recursive: true, force: true });
}

{
  const home = makeHome('default');
  seedBundled(home);
  const roster = makeRoster(home);
  const settings = makeSettings();
  const endpoints = makeProfileEndpoints({ agentPresets: roster, getSettings: () => settings, log: {} });
  const created = await endpoints.create({ displayName: '默认系列', config: {} });
  const result = await endpoints.setDefault({ profileId: created.id });
  check(result.isDefaultForNewSessions === true, 'setDefault: success answer');
  check(settings.calls.length === 1 && settings.calls[0].ns === 'agent-presets', 'setDefault: writes the native agent-presets namespace');
  check(JSON.stringify(settings.calls[0].ops) === JSON.stringify([{ op: 'set', path: ['default'], value: created.id }]), 'setDefault: op shape = set default to the profile id');
  roster.state.defaultId = created.id;
  const listed = await endpoints.list();
  check(listed.profiles.find((profile) => profile.id === created.id)?.isDefaultForNewSessions === true, 'setDefault: new-session default marker reflected in the roster');
  let unknown;
  try { await endpoints.setDefault({ profileId: 'profile-ghost-000' }); } catch (error) { unknown = error; }
  check(unknown?.code === 'PROFILE_NOT_FOUND', 'setDefault: unknown profile refused');
  let foreign;
  try { await endpoints.setDefault({ profileId: 'some-other-preset' }); } catch (error) { foreign = error; }
  check(foreign?.code === 'PROFILE_UNSUPPORTED', 'setDefault: foreign preset ids refused');
  const noSettings = makeProfileEndpoints({ agentPresets: roster, getSettings: () => undefined, log: {} });
  let unavailable;
  try { await noSettings.setDefault({ profileId: created.id }); } catch (error) { unavailable = error; }
  check(unavailable?.code === 'PROFILE_SETTINGS_UNAVAILABLE', 'setDefault: without a settings service fails loudly');
  rmSync(home, { recursive: true, force: true });
}

{
  const home = makeHome('empty-write');
  seedBundled(home);
  const roster = makeRoster(home);
  const endpoints = makeProfileEndpoints({ agentPresets: roster, getSettings: () => undefined, log: {} });
  const created = await endpoints.create({ displayName: '空配置', config: {} });
  const id = created.id;
  const savedDoc = JSON.parse(readFileSync(join(home, id, 'profile.json'), 'utf8'));
  check(savedDoc.preset === undefined && savedDoc.webFetch === undefined, 'create: empty config persists an empty snapshot (inherit all defaults)');
  let missing;
  try { await endpoints.create({ displayName: '缺配置', config: undefined }); } catch (error) { missing = error; }
  check(missing?.code === 'PROFILE_INVALID_CONFIG', 'create: undefined config rejected (a caller bug, not an empty profile)');
  check(!existsSync(join(home, profileIdForDisplayName('缺配置'))), 'create: undefined-config failure rolled back');
  // Round-trip: the empty snapshot loads as pure bundled defaults (the
  // loader-side behavior is covered in test-config-loader; here we verify
  // the RPC contract).
  const listed = await endpoints.list();
  check(JSON.stringify(listed.profiles.find((profile) => profile.id === id)?.config) === JSON.stringify({}), 'create: empty config round-trips through the roster');
  rmSync(home, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nPROFILE RPC: ALL CHECKS PASSED' : `\nPROFILE RPC: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

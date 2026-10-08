// Zero-cost unit test for the settings card client bundle
// (../npm-package/client/client.js). Materializes the hand-written
// ModuleLoader bundle under a mocked window/host (react + ui primitives +
// settingsScope + slots) and asserts the export face, the card registration
// contract, the old-host degradation guard, and the pure write-planner.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfigDocument } from '../config-loader.js';

const clientPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'npm-package', 'client', 'client.js');
const source = readFileSync(clientPath, 'utf8');

let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- mock host
const mockReact = { createElement: (type, props, ...children) => ({ type, props, children }) };
function makePrimitives({ drop = [] } = {}) {
  const full = {
    Button: {}, Input: {}, Toast: {}, Modal: {},
    IconCheckOutline16: {}, IconWarningOutline16: {}, IconChevronDownOutline14: {},
  };
  for (const name of drop) delete full[name];
  return full;
}

function materialize({ primitives }) {
  const registrations = [];
  globalThis.window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } };
  try {
    new Function(source)();
  } finally {
    delete globalThis.window;
  }
  check(registrations.length === 1, 'bundle registers exactly one ModuleLoader entry');
  const bundle = registrations[0];
  const requireMock = (spec) => {
    if (spec === 'react') return mockReact;
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error(`unexpected require("${spec}") — bundle purity: only platform seeds may be required`);
  };
  const exports = bundle.factory(requireMock);
  return { bundle, exports };
}

// ------------------------------------------------------------ export face
console.log('\n[export face]');
const { exports: card } = materialize({ primitives: makePrimitives() });
check(card.name === 'oh-my-dsh-slim', `name matches the package id (${card.name})`);
check(Array.isArray(card.inject) && ['slots', 'locale', 'connection'].every((s) => card.inject.includes(s)),
  `inject declares slots/locale/connection: ${JSON.stringify(card.inject)}`);
check(typeof card.apply === 'function', 'apply exported');
check(Array.isArray(card.REQUIRED_PRIMITIVES) && card.REQUIRED_PRIMITIVES.includes('Button'), 'REQUIRED_PRIMITIVES exported');
check(typeof card.missingPrimitives === 'function' && card.missingPrimitives(makePrimitives()).length === 0,
  'missingPrimitives: full host → no gaps');
check(card.missingPrimitives(makePrimitives({ drop: ['Button', 'Toast'] })).join(',') === 'Button,Toast',
  'missingPrimitives: reports dropped components');
check(typeof card.planUserOps === 'function' && typeof card.buildDraft === 'function',
  'pure helpers exported for tests');
check(source.includes("const EFFORTS = ['none', 'off', 'low', 'medium', 'high', 'max'];"), 'effort options include explicit none mode');
check(source.includes('effortNoneHint'), 'none mode carries a compatibility explanation');

// ------------------------------------------------------- apply + slot wiring
console.log('\n[apply: card registration]');
function runApply(cardExports) {
  const events = { localeRegisters: [], boundSpecs: [], slotInjects: [], registrations: [], warnings: [] };
  const originalWarn = console.warn;
  console.warn = (message) => events.warnings.push(String(message));
  try {
    const mockScope = { getSnapshot: () => ({ writable: true, value: {}, base: {}, user: {} }), subscribe: () => () => {}, write: async () => {} };
    const scoped = {
      settingsScope: { bind: (spec) => { events.boundSpecs.push(spec); return mockScope; } },
      slots: {
        inject: (slotName, registerFn) => { events.slotInjects.push(slotName); registerFn(); },
        register: (options, componentFactory) => { events.registrations.push({ options, componentFactory }); return () => {}; },
      },
    };
    const ctx = {
      effect: (fn) => { fn(); return () => {}; },
      locale: {
        register: (ns, dicts) => events.localeRegisters.push({ ns, dicts }),
        bind: (ns) => (key) => `${ns}:${key}`,
      },
      connection: { api: {} },
      inject: (deps, cb) => { if (deps.includes('settingsScope')) cb(scoped); },
    };
    cardExports.apply(ctx);
    return events;
  } finally {
    console.warn = originalWarn;
  }
}

{
  const events = runApply(card);
  check(events.localeRegisters.length === 1 && events.localeRegisters[0].ns === 'oh-my-dsh-slim',
    'locale dictionaries registered under the namespace');
  check(events.localeRegisters[0].dicts.zh && events.localeRegisters[0].dicts.en, 'zh + en dictionaries present');
  check(events.boundSpecs[0]?.namespace === 'oh-my-dsh-slim', 'settings scope bound to the namespace');
  check(events.slotInjects[0] === 'settings.plugin.item', 'card injected into the plugin-configuration slot');
  const entry = events.registrations[0];
  check(entry.options.key === 'oh-my-dsh-slim' && entry.options.name === 'settings.plugin.item',
    'slot entry claims the namespace (host × card intersection)');
  check(entry.options.priority === 1, 'slot entry priority=1 sorts the card after the built-ins (ascending keyed order)');
  check(entry.options.locale === 'oh-my-dsh-slim', 'slot entry carries the locale namespace');
  const element = entry.componentFactory();
  check(typeof element.type === 'function' && element.props.scope && element.props.t && element.props.connection,
    'component factory yields the card with scope/t/connection props');
}

console.log('\n[apply: old-host degradation]');
{
  const degraded = materialize({ primitives: makePrimitives({ drop: ['DisclosureRow'] }) });
  // DisclosureRow is NOT in REQUIRED_PRIMITIVES (the card stopped using it) —
  // verify with a genuinely required one instead.
  const events = runApply(materialize({ primitives: makePrimitives({ drop: ['Button', 'Toast'] }) }).exports);
  check(events.warnings.some((w) => w.includes('settings card disabled')), 'missing primitives disables the card with a warning');
  check(events.localeRegisters.length === 0 && events.slotInjects.length === 0, 'degraded apply registers nothing');
}

// ------------------------------------------------------------- planUserOps
console.log('\n[planUserOps]');
// Fixture mirrors the real base shape: every role carries enabled/provider/
// model/effort (as the shipped defaults.json does).
const roleDefaults = (provider, model, effort) => ({ enabled: true, provider, model, effort });
const BASE = {
  preset: 'p',
  presets: {
    p: {
      oracle: roleDefaults('prov', 'm1', 'high'),
      designer: roleDefaults('prov', 'm1', 'high'),
      fixer: roleDefaults('prov', 'm1', 'high'),
      explorer: roleDefaults('prov', 'm1', 'low'),
      librarian: roleDefaults('prov', 'm1', 'high'),
      observer: roleDefaults('prov', 'm1', 'high'),
    },
  },
  advanced: { roles: {} },
};
const effective = (user) => JSON.parse(JSON.stringify({
  ...BASE,
  presets: { p: { ...BASE.presets.p } },
  advanced: JSON.parse(JSON.stringify(user.advanced ?? { roles: {} })),
}));
const draftFrom = (user, patchRole = {}, patchAdvanced = {}) => {
  const merged = effective(user);
  merged.presets.p.oracle = { ...merged.presets.p.oracle, ...patchRole };
  merged.advanced.roles.oracle = { ...(merged.advanced.roles.oracle ?? {}), ...patchAdvanced };
  return card.buildDraft(merged, merged.advanced);
};
const opsFor = (user, patchRole = {}, patchAdvanced = {}) =>
  card.planUserOps(BASE, user, draftFrom(user, patchRole, patchAdvanced));

{
  const ops = opsFor({});
  check(ops.length === 0, `clean draft against clean user layer plans nothing (${JSON.stringify(ops)})`);

  const ops2 = opsFor({ presets: { p: { oracle: { model: 'old' } } } }, { model: 'm1' });
  check(ops2.length === 1 && ops2[0].op === 'unset' && ops2[0].path.join('.') === 'presets.p.oracle.model',
    'override equal to base plans unset (inherit)');

  const ops3 = opsFor({}, { model: 'm2' });
  check(ops3.length === 1 && ops3[0].op === 'set' && ops3[0].value === 'm2' && ops3[0].path.join('.') === 'presets.p.oracle.model',
    'override different from base plans set');

  const userWithSame = { presets: { p: { oracle: { model: 'm2' } } } };
  check(opsFor(userWithSame, { model: 'm2' }).length === 0, 'draft equal to existing user layer plans nothing');

  const ops4 = opsFor({}, { enabled: false });
  check(ops4.length === 1 && ops4[0].op === 'set' && ops4[0].path.join('.') === 'presets.p.oracle.enabled' && ops4[0].value === false,
    'enabled toggle plans a set on the preset layer');

  const ops5 = opsFor({}, {}, { maxTokens: 999 });
  check(ops5.length === 1 && ops5[0].op === 'set' && ops5[0].path.join('.') === 'advanced.roles.oracle.maxTokens' && ops5[0].value === 999,
    'advanced maxTokens plans a set on the advanced layer');

  const ops6 = opsFor({ advanced: { roles: { oracle: { maxTokens: 999 } } } }, {}, { maxTokens: undefined });
  check(ops6.length === 1 && ops6[0].op === 'unset' && ops6[0].path.join('.') === 'advanced.roles.oracle.maxTokens',
    'cleared advanced field plans unset');

  const both = opsFor({}, { model: 'm2', effort: 'max' }, { temperature: 0.3 });
  check(both.length === 3, `independent changes plan one op each (${both.length})`);

  const noneOps = opsFor({}, { effort: 'none' });
  check(noneOps.length === 1 && noneOps[0].op === 'set' && noneOps[0].value === 'none'
    && noneOps[0].path.join('.') === 'presets.p.oracle.effort',
    'effort none plans a set on the preset layer (differs from base high)');

  const noneUser = { presets: { p: { oracle: { effort: 'none' } } } };
  check(opsFor(noneUser, { effort: 'none' }).length === 0, 'effort none equal to user layer plans nothing');

  const noneReset = opsFor(noneUser, {});
  check(noneReset.length === 1 && noneReset[0].op === 'unset' && noneReset[0].path.join('.') === 'presets.p.oracle.effort',
    'restoring base effort plans unset of the stored none override');

}

console.log('\n[buildDraft]');
{
  const value = {
    preset: 'p',
    presets: { p: { oracle: { enabled: false, provider: 'x', model: 'y', effort: 'low' }, observer: {} } },
    advanced: { roles: { fixer: { maxTokens: 5 } } },
  };
  const draft = card.buildDraft(value, value.advanced);
  check(draft.preset === 'p', 'preset name carried');
  check(draft.roles.oracle.enabled === false && draft.roles.oracle.model === 'y', 'preset-layer fields surfaced');
  check(draft.roles.observer.enabled === true, 'missing enabled defaults to true');
  check(draft.roles.fixer.maxTokens === 5 && draft.roles.oracle.maxTokens === undefined, 'advanced layer surfaced per role');

}

// -------------------------------------------------------------- profiles
console.log('\n[profile roster]');
{
  const initial = card.initialProfileRoster({ preset: 'p' });
  check(initial.profiles.length === 1 && initial.profiles[0].id === 'oh-my-dsh-slim', 'initial roster carries exactly the bundled profile');
  check(initial.profiles[0].kind === 'bundled' && initial.profiles[0].isDefaultForNewSessions === true, 'bundled profile is the default for new sessions');

  const payload = {
    defaultProfileId: 'profile-gpt-abc',
    profiles: [
      { id: 'oh-my-dsh-slim', displayName: 'Minimal Role Delegation', isDefaultForNewSessions: false },
      { id: 'profile-gpt-abc', displayName: 'GPT 系列', isDefaultForNewSessions: true, revision: 'r1', needsMigration: true, config: { preset: 'p', roles: { oracle: { model: 'gpt' } } } },
      { id: '__new__', displayName: 'ignored' },
      { id: 'some-other-preset', displayName: 'not ours — filtered by host' },
    ],
  };
  const roster = card.normalizeProfileRoster({ preset: 'p' }, payload);
  check(roster.profiles.length === 2, `roster keeps bundled + custom, drops foreign ids (${roster.profiles.length})`);
  check(roster.profiles[0].id === 'oh-my-dsh-slim', 'bundled first');
  const gpt = roster.profiles.find((entry) => entry.id === 'profile-gpt-abc');
  check(gpt?.isDefaultForNewSessions === true && gpt.kind === 'custom' && gpt.revision === 'r1', 'default marker and revision carried');
  check(gpt?.config?.roles?.oracle?.model === 'gpt', 'profile config document carried');
  check(gpt?.needsMigration === true, 'roster keeps the host migration flag (0.1.5 persona rewrite)');
  check(roster.profiles[0].needsMigration === false, 'profiles without the host flag default to no migration');
  check(roster.profiles.every((entry) => entry.isDefaultForNewSessions === (entry.id === 'profile-gpt-abc')), 'default is exactly one profile');

  const fallback = card.normalizeProfileRoster({ preset: 'p' }, undefined);
  check(fallback.profiles.length === 1 && fallback.profiles[0].isDefaultForNewSessions === true, 'no payload → bundled-only roster');
}

console.log('\n[mergeProfileConfig]');
{
  const BASE = {
    preset: 'p',
    presets: { p: { oracle: { enabled: true, provider: 'prov', model: 'm1', effort: 'high' }, fixer: { enabled: true, provider: 'prov', model: 'm1' } } },
    mcpServers: { context7: { transport: 'streamable-http', url: 'https://x' } },
    advanced: { roles: { oracle: { maxTokens: 100 } } },
  };
  const doc = { preset: 'p', roles: { oracle: { model: 'm2', effort: 'max' } }, advanced: { roles: { oracle: { temperature: 0.5 } } } };
  const merged = card.mergeProfileConfig(BASE, doc);
  check(merged.presets.p.oracle.model === 'm2' && merged.presets.p.oracle.provider === 'prov', 'compact role override merges over the base role');
  check(merged.presets.p.fixer.model === 'm1' && merged.presets.p.fixer.enabled === true, 'untouched role keeps the base');
  check(merged.advanced.roles.oracle.maxTokens === 100 && merged.advanced.roles.oracle.temperature === 0.5, 'advanced layer merges over the base advanced');
  check(merged.webFetch === undefined && merged.mcpServers.context7.url === 'https://x', 'merge drops the legacy webFetch key and keeps mcpServers');

  const legacy = card.mergeProfileConfig(BASE, { preset: 'p', presets: { p: { oracle: { model: 'm3' } } } });
  check(legacy.presets.p.oracle.model === 'm3', 'legacy presets-map shape merges too');
}

console.log('\n[validateProfileName / draftToConfig]');
{
  const roster = {
    profiles: [{ id: 'oh-my-dsh-slim', displayName: '极简角色委派' }, { id: 'profile-x', displayName: 'GPT 系列' }],
  };
  check(card.validateProfileName('  新配置  ', roster.profiles).valid === true, 'trimmed non-empty name is valid');
  check(card.validateProfileName('', roster.profiles).reason === 'required', 'empty name rejected');
  check(card.validateProfileName('x'.repeat(65), roster.profiles).reason === 'too-long', 'over-64 name rejected');
  check(card.validateProfileName('gpt 系列', roster.profiles).reason === 'conflict', 'duplicate name (case-insensitive) rejected');
  check(card.validateProfileName('极简角色委派', roster.profiles, 'oh-my-dsh-slim').valid === true, 'same profile renaming to its own name is allowed');

  const BASE = {
    preset: 'p',
    presets: { p: { oracle: { enabled: true, provider: 'prov', model: 'm1', effort: 'high' } } },
    advanced: { roles: {} },
  };
  const effective = card.mergeProfileConfig(BASE, {});
  const draft = card.buildDraft(effective, effective.advanced);
  draft.roles.oracle.model = 'm2';
  const doc = card.draftToConfig(draft, {}, effective);
  check(doc.preset === 'p' && doc.presets.p.oracle.model === 'm2', 'override written into the legacy document shape');
  check(doc.presets.p.oracle.provider === undefined && doc.presets.p.oracle.effort === undefined, 'base-equal fields omitted (unset = inherit)');
  const resetDoc = card.draftToConfig(card.buildDraft(effective, effective.advanced), {}, effective);
  check(resetDoc.presets.p === undefined || Object.keys(resetDoc.presets.p).length === 0, 'defaults draft serializes to an empty document (no overrides)');
}

console.log('\n[create-from-profile snapshot baseline]');
{
  // A profile created FROM another custom profile must snapshot the source's
  // overrides against the NEW profile's own base (bundled defaults), not
  // against the source's effective values — otherwise every field inherited
  // from the source is dropped and the new profile silently becomes the
  // bundled defaults plus the one edited field (the flash-fixer report).
  const BASE = {
    preset: 'p',
    presets: {
      p: {
        oracle: { enabled: true, provider: 'prov', model: 'm1', effort: 'high' },
        designer: { enabled: true, provider: 'prov', model: 'm1', effort: 'high' },
        fixer: { enabled: true, provider: 'prov', model: 'm1', effort: 'high' },
      },
    },
    advanced: { roles: {} },
  };
  const gptDoc = {
    preset: 'p',
    roles: {
      oracle: { model: 'gpt-pro', effort: 'max' },
      designer: { model: 'gpt', effort: 'max' },
      fixer: { model: 'gpt' },
    },
  };
  const gptEffective = card.mergeProfileConfig(BASE, gptDoc);
  const draft = card.buildDraft(gptEffective, gptEffective.advanced);
  draft.roles.fixer.model = 'flash';
  const defaultsEffective = card.mergeProfileConfig(BASE, {});
  const doc = card.draftToConfig(draft, gptDoc, defaultsEffective);
  check(doc.presets.p.oracle?.model === 'gpt-pro' && doc.presets.p.oracle?.effort === 'max',
    'create-from-profile: source oracle overrides snapshotted');
  check(doc.presets.p.designer?.model === 'gpt' && doc.presets.p.designer?.effort === 'max',
    'create-from-profile: source designer overrides snapshotted');
  check(doc.presets.p.fixer?.model === 'flash', 'create-from-profile: the edited field wins');
  const buggy = card.draftToConfig(draft, gptDoc, gptEffective);
  check(buggy.presets.p?.oracle === undefined && buggy.presets.p?.designer === undefined,
    'regression guard: comparing against the source effective drops inherited overrides (the fixed bug)');
}

console.log('\n[profile RPC adapter]');
{
  const responses = [];
  let forced;
  const connection = {
    rpc: {
      call: (path, method, payload) => {
        responses.push({ path, method, payload });
        if (forced !== undefined) return Promise.resolve(forced);
        const table = {
          'profile-list': { ok: true, value: { profiles: [], defaultProfileId: 'oh-my-dsh-slim' } },
          'profile-create': { ok: true, value: { id: 'profile-x-123', displayName: 'X', revision: 'none' } },
          'profile-save': { ok: true, value: { id: 'profile-x-123', revision: 'r2' } },
          'profile-set-default': { ok: true, value: { profileId: 'profile-x-123' } },
          'profile-migrate': { ok: true, value: { profileId: 'profile-x-123', changed: true, backup: 'agent.cordis.yml.bak-pre-015-persona' } },
        };
        return Promise.resolve(table[method]);
      },
    },
  };
  const adapter = card.createProfileAdapter(connection);
  check(typeof adapter?.list === 'function', 'adapter built over the rpc channel');
  const listed = await adapter.list();
  check(listed.defaultProfileId === 'oh-my-dsh-slim', 'list unwraps the envelope value');
  check(responses[0].path === '/omds' && responses[0].method === 'profile-list', 'calls /omds with the endpoint name');
  const saved = await adapter.save({ id: 'profile-x-123' });
  check(saved.revision === 'r2', 'save unwraps the envelope value');
  const created = await adapter.create({ displayName: 'X', config: {} });
  check(created.id === 'profile-x-123', 'create unwraps the envelope value');
  const migrated = await adapter.migrate('profile-x-123');
  check(migrated.changed === true, 'migrate unwraps the envelope value');
  const migrateCall = responses[responses.length - 1];
  check(migrateCall.method === 'profile-migrate' && migrateCall.payload?.profileId === 'profile-x-123',
    'migrate calls /omds profile-migrate with the profile id');
  check(card.unwrapProfileRpc({ ok: true, value: 42 }) === 42, 'unwrap: ok/value');
  check(card.unwrapProfileRpc({ result: { ok: true, value: 7 } }) === 7, 'unwrap: legacy result envelope');
  check(card.unwrapProfileRpc({ profiles: [] }) !== undefined, 'unwrap: raw roster passthrough');
  check(card.unwrapProfileRpc({ ok: false, error: {} }) === undefined, 'unwrap: error envelope yields undefined');
  forced = { ok: false, error: { code: 'PROFILE_CONFLICT', message: 'stale revision' } };
  let thrown;
  const failing = card.createProfileAdapter({ rpc: { call: () => Promise.resolve(forced) } });
  await failing.list().catch((error) => { thrown = error; });
  check(thrown?.code === 'PROFILE_CONFLICT', 'adapter converts RPC errors into coded errors');
  check(card.createProfileAdapter({}) === undefined, 'no rpc channel → no adapter (bundled-only degradation)');
}

console.log('\n[ProfileSelect sentinel]');
{
  const element = card.ProfileSelect({
    profiles: [{ id: 'oh-my-dsh-slim', displayName: '极简角色委派', isDefaultForNewSessions: true, kind: 'bundled' }],
    selectedId: 'oh-my-dsh-slim',
    onChange: () => {},
    disabled: false,
    t: (key) => key,
  });
  const options = element.children.flat();
  const values = options.map((child) => child?.props?.value).filter(Boolean);
  check(values.join(',') === 'oh-my-dsh-slim,__sep__,__new__',
    `dropdown always carries the new-config sentinel after a separator (${values.join(',')})`);
  check(options[0]?.children?.[0] === '极简角色委派 · newSessionDefault', 'default-for-new-sessions marker rendered on the bundled option');
  check(options[1]?.props?.disabled === true, 'separator option is disabled (visual divider)');
  check(options[2]?.children?.[0] === '+ newProfile（newProfileHint）' && element.props.value === 'oh-my-dsh-slim', 'sentinel label carries the editable hint; select shows the current profile');
}

console.log('\n[default action + initial selection]');
{
  check(card.canSetDefault({ kind: 'custom', isDefaultForNewSessions: false }) === true, 'custom non-default → "set as default" action shown');
  check(card.canSetDefault({ kind: 'bundled', isDefaultForNewSessions: false }) === true, 'bundled non-default → action shown (default can be switched back)');
  check(card.canSetDefault({ kind: 'bundled', isDefaultForNewSessions: true }) === false, 'current default → no action');
  check(card.canSetDefault({ kind: 'draft', isDefaultForNewSessions: false }) === false, 'new-profile draft → no action (nothing exists yet)');
  check(card.canSetDefault(undefined) === false, 'no profile → no action');

  check(card.resolveInitialSelection('oh-my-dsh-slim', { defaultProfileId: 'profile-x' }) === 'profile-x',
    'roster loaded → dropdown opens on the new-session default');
  check(card.resolveInitialSelection('oh-my-dsh-slim', { defaultProfileId: 'oh-my-dsh-slim' }) === 'oh-my-dsh-slim',
    'bundled default → stays on the bundled profile');
  check(card.resolveInitialSelection('profile-x', { defaultProfileId: 'profile-y' }) === 'profile-x',
    'manual selection is never overridden by the default');
  check(card.resolveInitialSelection('oh-my-dsh-slim', undefined) === 'oh-my-dsh-slim',
    'unknown roster → bundled fallback (no default data)');
}

console.log('\n[model-scoped effort options (flash+medium regression)]');
{
  // Catalog mirrors the real host shape: per-model reasoning.efforts carry
  // the adapter-authoritative supported levels (DeepSeek = Off/Low/High/Max,
  // no medium) plus defaultEffort; some models declare no reasoning at all.
  const CATALOG = {
    groups: [
      {
        id: 'deepseek-official', name: 'DeepSeek', models: [
          { id: 'deepseek-v4-flash', name: 'Flash', reasoning: { efforts: [
            { id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultEffort: 'high' } },
          { id: 'deepseek-v4-pro', name: 'Pro', reasoning: { efforts: [
            { id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }] } },
        ],
      },
      {
        id: 'intelalloc', name: 'IntelAlloc', models: [
          { id: 'gpt-5.6-sol', name: 'Sol', reasoning: { efforts: [
            { id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }, { id: 'max' }] } },
        ],
      },
      { id: 'generic', name: 'Generic', models: [{ id: 'local-model', name: 'Local' }] },
    ],
  };
  const values = (provider, model) => card.effortOptionsFor(CATALOG.groups, provider, model);
  const labels = (provider, model) => card.effortOptionsFor(CATALOG.groups, provider, model).map((o) => o.label).join(',');
  const ids = (provider, model) => card.effortOptionsFor(CATALOG.groups, provider, model).map((o) => o.value).join(',');

  check(ids('deepseek-official', 'deepseek-v4-flash') === 'none,off,low,high,max',
    'flash offers only its adapter-supported levels with none FIRST — medium excluded (the fixed bug)');
  check(labels('deepseek-official', 'deepseek-v4-flash') === 'none,Off,Low,High,Max',
    'labels show the host-provided names while values stay ids');
  check(ids('deepseek-official', 'deepseek-v4-pro') === 'none,low,max', 'per-model sets differ (pro has no off/high)');
  check(ids('intelalloc', 'gpt-5.6-sol') === 'none,low,medium,high,xhigh,max',
    'host levels beyond the preset fixed list (xhigh) are offered, order preserved');
  check(values('intelalloc', 'gpt-5.6-sol').every((o) => typeof o.value === 'string' && typeof o.label === 'string'),
    'name-less efforts fall back to their id as label');
  check(ids('generic', 'local-model') === 'none', 'known model without declared reasoning offers only none');
  const fixedFallback = card.effortOptionsFor(CATALOG.groups, 'ghost-provider', 'ghost-model').map((o) => o.value).join(',');
  check(fixedFallback === 'none,off,low,medium,high,max', 'unknown model/provider → fixed-list fallback (behavior unchanged)');
  check(card.effortOptionsFor([], undefined, undefined).length === 6, 'catalog loading/error (empty groups) → fixed-list fallback');

  const mismatch = (effort, provider, model) => card.effortMismatch(effort, CATALOG.groups, provider, model);
  check(mismatch('medium', 'deepseek-official', 'deepseek-v4-flash') === true, 'flash + medium flagged as mismatch');
  check(mismatch('high', 'deepseek-official', 'deepseek-v4-flash') === false, 'flash + high is fine');
  check(mismatch('none', 'deepseek-official', 'deepseek-v4-flash') === false, 'none never mismatches');
  check(mismatch(undefined, 'deepseek-official', 'deepseek-v4-flash') === false, 'empty effort (inherit) never mismatches');
  check(mismatch('medium', 'ghost-provider', 'ghost-model') === false, 'unknown model → fallback list → no mismatch block');
  check(mismatch('high', 'generic', 'local-model') === true, 'no-reasoning model + explicit level flagged (only none allowed)');
  check(mismatch('high', 'intelalloc', 'gpt-5.6-sol') === false, 'sol + high fine (catalog-driven, not preset-list-driven)');

  // The link that was missing (2026-09-18): every level the card OFFERS must be
  // writable by the configuration paths. The card derives options from the live
  // model catalog while the writers gated on a fixed vocabulary, so a level a
  // model genuinely declares outside that list was selectable but unsaveable
  // (intelalloc xhigh: save failed with "effort is invalid").
  const unwritable = [];
  for (const group of CATALOG.groups) {
    for (const model of group.models) {
      for (const option of card.effortOptionsFor(CATALOG.groups, group.id, model.id)) {
        try {
          validateConfigDocument({
            preset: 'p',
            presets: { p: { oracle: { provider: group.id, model: model.id, effort: option.value } } },
          });
        } catch (error) {
          unwritable.push(`${group.id}/${model.id}:${option.value} (${error.message})`);
        }
      }
    }
  }
  check(unwritable.length === 0,
    `every catalog-offered level is writable by the profile RPC${unwritable.length === 0 ? '' : ` — unwritable: ${unwritable.join('; ')}`}`);
}

console.log(failures === 0 ? '\nCLIENT CARD: ALL CHECKS PASSED' : `\nCLIENT CARD: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

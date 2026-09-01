// Zero-cost unit test for the settings card client bundle
// (../npm-package/client/client.js). Materializes the hand-written
// ModuleLoader bundle under a mocked window/host (react + ui primitives +
// settingsScope + slots) and asserts the export face, the card registration
// contract, the old-host degradation guard, and the pure write-planner.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    Button: {}, Input: {}, Toast: {},
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

  const wfOn = card.planUserOps(BASE, {}, card.buildDraft({ ...BASE, webFetch: true }, {}));
  check(wfOn.length === 1 && wfOn[0].op === 'set' && wfOn[0].path.join('.') === 'webFetch' && wfOn[0].value === true,
    'webFetch on plans a set on the namespace top level');

  const wfUserOn = card.planUserOps(BASE, { webFetch: true }, card.buildDraft({ ...BASE, webFetch: true }, {}));
  check(wfUserOn.length === 0, 'webFetch on equal to user layer plans nothing');

  const wfOff = card.planUserOps(BASE, { webFetch: true }, card.buildDraft({ ...BASE, webFetch: false }, {}));
  check(wfOff.length === 1 && wfOff[0].op === 'unset' && wfOff[0].path.join('.') === 'webFetch',
    'webFetch off (default) plans unset of the stored override');
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

  const wfDraft = card.buildDraft({ ...value, webFetch: true }, value.advanced);
  check(wfDraft.webFetch === true, 'webFetch true surfaced');
  check(card.buildDraft({ ...value, webFetch: false }, value.advanced).webFetch === false, 'webFetch false surfaced');
  check(card.buildDraft(value, value.advanced).webFetch === false, 'missing webFetch defaults to false');
}

console.log(failures === 0 ? '\nCLIENT CARD: ALL CHECKS PASSED' : `\nCLIENT CARD: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

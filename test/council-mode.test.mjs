// Council Mode section gating: top-level only, >= 2 seats, only seats whose
// tools are actually mounted, and the synthesizer tool visible. Zero-cost.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply as applyCouncilMode, councilModeText, COUNCIL_TOOL_NAME } from '../npm-package/preset/council-mode.js';
import { resetConfigForTests } from '../npm-package/preset/config.js';

function fixture(t, document = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omds-council-mode-'));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(document));
  const previous = { OH_MY_DSH_SLIM_CONFIG: process.env.OH_MY_DSH_SLIM_CONFIG, OH_MY_DSH_SLIM_PROFILE_DIR: process.env.OH_MY_DSH_SLIM_PROFILE_DIR };
  process.env.OH_MY_DSH_SLIM_CONFIG = file;
  process.env.OH_MY_DSH_SLIM_PROFILE_DIR = join(dir, 'no-snapshot');
  resetConfigForTests();
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfigForTests();
    rmSync(dir, { recursive: true, force: true });
  });
}

async function mount(ctx) {
  let section;
  const warnings = [];
  const systemPrompt = { section: (value) => { section = value; } };
  await applyCouncilMode({ ...ctx, systemPrompt, logger: { warn: (message) => warnings.push(String(message)) } });
  assert.ok(section, 'the section is registered');
  return Object.assign(section, { warnings });
}

const parent = () => ({ session: { header: {} } });
const child = () => ({ session: { header: { origin: 'subagent', delegationDepth: 1 } } });

function toolsWith(visible) {
  return { get: (toolName) => (visible.has(toolName) ? { name: toolName } : undefined) };
}

test('councilModeText lists the seats with their seat and tool names', () => {
  const text = councilModeText(['councillor-alpha', 'councillor-gamma']);
  assert.match(text, /Enabled council seats: alpha \(subagent_councillor_alpha\), gamma \(subagent_councillor_gamma\)/);
  assert.match(text, /## Council Mode/);
  assert.match(text, /ONE assistant message, in parallel/);
  assert.match(text, /Do not dispatch separate exploration lanes first/);
  assert.match(text, /verbatim/);
  assert.match(text, /do not summarize, reorder, or drop the per-councillor details/);
  assert.match(text, /retry that seat once/);
  assert.match(text, /single view, not a consensus/);
  assert.ok(!text.includes('{{'), 'no prompt variables');
});

test('the section is top-level only', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } });
  const visible = new Set(['subagent_councillor_alpha', 'subagent_councillor_beta', COUNCIL_TOOL_NAME]);
  const section = await mount({ tools: toolsWith(visible) });
  assert.equal(section.text({ agent: child(), scope: 'child' }), '', 'child sessions never see Council Mode');
  assert.equal(section.text({ agent: undefined, scope: 'none' }), '', 'diagnostics see nothing');
  assert.match(section.text({ agent: parent(), scope: 'parent' }), /## Council Mode/);
});

test('zero or one seat advertises nothing', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true } } });
  const visible = new Set(['subagent_councillor_alpha', COUNCIL_TOOL_NAME]);
  const section = await mount({ tools: toolsWith(visible) });
  assert.equal(section.text({ agent: parent(), scope: 'parent' }), '', 'one seat is an ordinary delegation');

  fixture(t, {});
  const none = await mount({ tools: toolsWith(visible) });
  assert.equal(none.text({ agent: parent(), scope: 'parent' }), '', 'zero seats is off');
});

test('a configured seat whose tool did not mount is not advertised', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true }, 'councillor-gamma': { enabled: true } } });
  const visible = new Set(['subagent_councillor_alpha', 'subagent_councillor_beta', COUNCIL_TOOL_NAME]);
  const section = await mount({ tools: toolsWith(visible) });
  const text = section.text({ agent: parent(), scope: 'parent' });
  assert.match(text, /alpha/);
  assert.match(text, /beta/);
  assert.ok(!text.includes('gamma'), 'the unmounted seat is not advertised');
});

test('the section hides when fewer than two seat tools are visible', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } });
  const onlyOne = new Set(['subagent_councillor_alpha', COUNCIL_TOOL_NAME]);
  const section = await mount({ tools: toolsWith(onlyOne) });
  assert.equal(section.text({ agent: parent(), scope: 'parent' }), '', 'one visible seat is not a council');
});

test('the section hides when the synthesizer tool is missing', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } });
  const noSynth = new Set(['subagent_councillor_alpha', 'subagent_councillor_beta']);
  const section = await mount({ tools: toolsWith(noSynth) });
  assert.equal(section.text({ agent: parent(), scope: 'parent' }), '', 'never advertise a tool that is not mounted');
});

test('a broken tools lookup hides the section instead of throwing into assembly', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } });
  const section = await mount({ tools: { get: () => { throw new Error('scope unavailable'); } } });
  assert.equal(section.text({ agent: parent(), scope: 'parent' }), '');
});

test('a configured but unusable council is logged once, not silently hidden', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } });
  const onlyOne = new Set(['subagent_councillor_alpha', COUNCIL_TOOL_NAME]);
  const section = await mount({ tools: toolsWith(onlyOne) });
  assert.equal(section.text({ agent: parent(), scope: 'parent' }), '');
  assert.equal(section.text({ agent: parent(), scope: 'parent' }), '');
  assert.equal(section.warnings.length, 1, 'one warning per reason, no per-turn spam');
  assert.match(section.warnings[0], /only 1 of 2 seat tools are mounted/);
});

test('a missing synthesizer is logged once', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } });
  const noSynth = new Set(['subagent_councillor_alpha', 'subagent_councillor_beta']);
  const section = await mount({ tools: toolsWith(noSynth) });
  assert.equal(section.text({ agent: parent(), scope: 'parent' }), '');
  assert.equal(section.text({ agent: parent(), scope: 'parent' }), '');
  assert.equal(section.warnings.length, 1);
  assert.match(section.warnings[0], /synthesizer tool is not mounted/);
});

test('a healthy council logs nothing', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } });
  const visible = new Set(['subagent_councillor_alpha', 'subagent_councillor_beta', COUNCIL_TOOL_NAME]);
  const section = await mount({ tools: toolsWith(visible) });
  assert.match(section.text({ agent: parent(), scope: 'parent' }), /## Council Mode/);
  assert.equal(section.warnings.length, 0);
});

// Negative security tests for the council child composition:
//   * a role disabled mid-session must not turn an already-mounted tool into an
//     unrestricted child (the old `enabled:false -> skipped` fail-open);
//   * council roles must never mount MCP tools (role-mcp appends those outside
//     tools.restrict);
//   * a failed restrict must reject the delegation, never fail open;
//   * the persona section renders literally so a user {variable} cannot abort a
//     strict-interpolation host turn.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeChild } from '../npm-package/preset/role-composition.js';
import { resetConfigForTests } from '../npm-package/preset/config.js';
import { createRolePlugin } from '../npm-package/preset/roles.js';
import { roleSupportsMcp } from '../npm-package/preset/role-mcp.js';

function fixture(t, document = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omds-council-security-'));
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
  return file;
}

function harness(label, { known = ['read', 'glob', 'grep', 'edit', 'write', 'bash'], restrictThrows = false } = {}) {
  const recorded = { sections: [], filters: [] };
  const tools = {
    view: () => ({ restrictableNames: new Set(known) }),
    restrict: (filter) => {
      if (restrictThrows) throw new Error('restrict unavailable');
      recorded.filters.push(filter);
      return () => {};
    },
  };
  const agent = {
    ctx: {
      systemPrompt: { section: (section) => recorded.sections.push(section), getSectionOrder: () => 100 },
      get: (name) => (name === 'tools' ? tools : undefined),
      tools,
    },
    session: {
      header: { origin: 'subagent', delegationDepth: 1 },
      ownEvents: () => [{ type: 'subagent/descriptor', data: { label } }],
    },
  };
  const ctx = { logger: { warn: () => {} } };
  return { agent, ctx, recorded };
}

const scopeOf = () => 'scope';

test('a seat disabled mid-session still composes read-only (no fail-open)', async t => {
  fixture(t, { roles: { 'councillor-beta': { enabled: true }, 'councillor-gamma': { enabled: true } } });
  const { agent, ctx, recorded } = harness('councillor-alpha · stale tool call');
  const result = await composeChild(agent, ctx, scopeOf);
  assert.equal(result, 'ok', 'the disabled role is composed, not skipped');
  assert.equal(recorded.sections.length, 1, 'the seat persona is installed');
  assert.match(String(recorded.sections[0].text), /Internal role id: oh-my-dsh-slim-role:councillor-alpha\./);
  assert.deepEqual(recorded.filters, [{ allow: ['read', 'glob', 'grep'] }], 'the read-only ceiling still applies');
});

test('a synthesizer child created by a stale tool is still tool-less', async t => {
  fixture(t, {}); // zero seats: the derived synthesizer is off
  const { agent, ctx, recorded } = harness('council · stale tool call');
  const result = await composeChild(agent, ctx, scopeOf);
  assert.equal(result, 'ok');
  assert.deepEqual(recorded.filters, [{ allow: [] }], 'synthesisOnly wins even while disabled');
});

test('a seat with two seats enabled keeps its ceiling; the synthesizer gets the empty filter', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } });
  const seat = harness('councillor-beta · live call');
  await composeChild(seat.agent, seat.ctx, scopeOf);
  assert.deepEqual(seat.recorded.filters, [{ allow: ['read', 'glob', 'grep'] }]);
  const synth = harness('council · live call');
  await composeChild(synth.agent, synth.ctx, scopeOf);
  assert.deepEqual(synth.recorded.filters, [{ allow: [] }], 'the synthesizer has no tools');
});

test('a restrict failure rejects the delegation (fail closed)', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true }, 'councillor-beta': { enabled: true } } });
  const { agent, ctx } = harness('councillor-alpha · broken restrict', { restrictThrows: true });
  await assert.rejects(() => composeChild(agent, ctx, scopeOf), /restrict unavailable/);
});

test('the persona section renders literally (interpolate:false)', async t => {
  fixture(t, { roles: { 'councillor-alpha': { enabled: true, personaAppend: 'Focus on failure recovery.' } } });
  const { agent, ctx, recorded } = harness('councillor-alpha · prompt');
  await composeChild(agent, ctx, scopeOf);
  const section = recorded.sections[0];
  assert.equal(section.interpolate, false, 'literal rendering');
  assert.match(String(section.text), /Focus on failure recovery\./, 'user append reaches the child');
});

test('unknown or non-subagent agents are skipped', async t => {
  fixture(t, {});
  const { agent, ctx } = harness('someone-else · call');
  assert.equal(await composeChild(agent, ctx, scopeOf), 'skipped');
  const parent = harness('councillor-alpha · parent');
  parent.agent.session.header = {};
  assert.equal(await composeChild(parent.agent, parent.ctx, scopeOf), 'skipped');
});

test('only non-council roles are MCP-eligible', () => {
  for (const roleId of ['councillor-alpha', 'councillor-beta', 'councillor-gamma', 'council']) {
    assert.equal(roleSupportsMcp(roleId), false, roleId + ' must not mount MCP tools');
  }
  for (const roleId of ['oracle', 'explorer', 'librarian', 'designer', 'fixer', 'observer']) {
    assert.equal(roleSupportsMcp(roleId), true, roleId + ' keeps its MCP capability');
  }
});

test('a role tool that registers outside the intercepted path refuses to mount', async t => {
  // The label prefix this wrapper writes is the only runtime identity signal
  // role-composition has. If the host registers the tool through a path the
  // wrapper cannot intercept, the tool would create unlabelled children that
  // composeChild must skip — i.e. children with the parent's full tool surface.
  // The row must therefore fail closed instead of keeping the host description.
  fixture(t, {});
  const makeHarness = (registerName) => {
    const registered = [];
    const runtime = { register: (definition) => { registered.push(definition); return () => {}; }, get: () => registered[0] };
    const stock = {
      name: 'fake-stock',
      inject: [],
      apply: (scoped) => {
        scoped.tools.register({
          name: registerName,
          description: 'fake stock tool',
          parameters: { type: 'object', properties: {} },
          execute: async () => ({ kind: 'success' }),
        });
      },
    };
    const ctx = {
      loader: { config: { bareModuleBaseUrl: 'file:///fake/host.js' }, internal: { import: async () => stock } },
      tools: runtime,
      systemPrompt: { section() {}, getSectionOrder: () => 1 },
      logger: { warn() {}, info() {} },
      plugin: async (definition) => { await definition.apply(ctx); return { dispose: async () => {} }; },
      get: (name) => (name === 'tools' ? runtime : undefined),
    };
    return { ctx, registered };
  };
  const raw = { definition: { roleId: 'oracle', toolName: 'subagent_oracle' }, provider: 'spawn', backgroundMode: 'continuable', maxDepth: 1 };
  const silent = makeHarness('not_the_role_tool');
  await assert.rejects(() => createRolePlugin(raw).apply(silent.ctx), /refusing to mount an unlabelled role tool/);
  const mounted = makeHarness('subagent_oracle');
  await createRolePlugin(raw).apply(mounted.ctx);
  assert.ok(mounted.registered.some((definition) => definition.name === 'subagent_oracle'), 'the intercepted path mounts the role tool');
});

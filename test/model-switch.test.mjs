import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../npm-package/preset/subagent-roles.js';

const BASE = 'deepseek-official';
const PRO = 'deepseek-v4-pro';
const QWEN = 'openrouter/qwen3-coder';

function harness({ profiles, info, agents }) {
  const handlers = [];
  const warnings = [];
  const ctx = {
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
    get: (key) => {
      if (key === 'omdsProfiles') return { read: (id) => profiles[id] };
      if (key === 'agents') return agents;
      if (key === 'llm') {
        return {
          resolveModelInfo: async (provider, model) => {
            const hit = info?.[provider + '/' + model];
            if (hit === undefined) throw new Error('unknown model');
            return hit;
          },
        };
      }
      return undefined;
    },
    effect: (factory) => factory(),
    on: (event, handler) => { handlers.push(handler); return () => {}; },
  };
  return { ctx, handlers, warnings };
}

function child(roleId, parentId) {
  return {
    session: {
      header: {
        origin: 'subagent',
        delegationDepth: 1,
        ...(parentId === undefined ? {} : { parentSession: parentId }),
      },
      ownEvents: () => [{ type: 'subagent/descriptor', data: { persona: 'Internal role id: oh-my-dsh-slim-role:' + roleId + '.' } }],
    },
  };
}

/** A live delegating agent: the child's "follow the session" source. */
function parentAgent(config) {
  return { session: { requestHeader: () => ({ config }) } };
}

async function run({ profiles, info, roleId = 'oracle', agent, resolved, parent, parentId = 'parent-session' }) {
  const agents = parent === undefined && parentId === undefined
    ? undefined
    : { get: (id) => (id === parentId ? parentAgent(parent) : undefined) };
  const { ctx, handlers, warnings } = harness({ profiles, info, agents });
  apply(ctx, { profileId: 'p' });
  assert.equal(handlers.length, 1);
  const result = await handlers[0]({ agent: agent ?? child(roleId, parent === undefined ? undefined : parentId) }, async () => resolved);
  return { result, warnings };
}

const profile = (oracle) => ({ p: { roles: { oracle } } });

test('an unchanged role route leaves the request untouched', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 128000 };
  const { result } = await run({
    profiles: profile({ provider: BASE, model: PRO, effort: 'none', temperature: 0.1 }),
    resolved,
  });
  assert.deepEqual(result, resolved);
});

test('a role switched to follow mid-session returns to the session route', async () => {
  // The librarian case: the role tool mounted while the role was pinned, so
  // its spawn options still carry that route. A card edit to "inherit" must
  // apply to the NEXT request, not only to sessions created later — otherwise
  // the child keeps running on a model the user already removed.
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1, maxTokens: 48000 };
  const { result } = await run({
    profiles: profile({ effort: 'none', temperature: 0.1 }),
    info: { [QWEN]: { reasoning: { efforts: [{ id: 'low' }] }, defaultMaxTokens: 64000 } },
    resolved,
    parent: { provider: 'openrouter', model: 'qwen3-coder', reasoningEffort: 'low', maxTokens: 32000 },
  });
  assert.equal(result.provider, 'openrouter', 'the session route replaces the stale pin');
  assert.equal(result.model, 'qwen3-coder');
  assert.equal(result.reasoningEffort, 'low', 'the session level comes with the route');
  assert.equal(result.maxTokens, 32000, 'the session cap comes with it too');
});

test('a followed session reroutes even when the role has its own effort', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 48000 };
  const { result } = await run({
    profiles: profile({ effort: 'max', temperature: 0.1 }),
    info: { [QWEN]: { reasoning: { efforts: [{ id: 'high' }, { id: 'max' }] } } },
    resolved,
    parent: { provider: 'openrouter', model: 'qwen3-coder', reasoningEffort: 'low', maxTokens: 32000 },
  });
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.reasoningEffort, 'max', 'a role level still wins over the session level');
  assert.equal(result.maxTokens, 32000, 'the cap follows the session regardless');
});

test('a followed session level change applies without a route change', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 48000 };
  const { result } = await run({
    profiles: profile({ effort: 'none', temperature: 0.1 }),
    resolved,
    parent: { provider: BASE, model: PRO, reasoningEffort: 'high', maxTokens: 131072 },
  });
  assert.equal(result.provider, BASE, 'the route is unchanged');
  assert.equal(result.reasoningEffort, 'high', 'the level follows the session');
  assert.equal(result.maxTokens, 131072, 'the cap follows the session');
});

test('a followed role drops a level the session no longer sends', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1, maxTokens: 48000 };
  const { result } = await run({
    profiles: profile({ effort: 'none', temperature: 0.1 }),
    resolved,
    parent: { provider: BASE, model: PRO },
  });
  assert.equal('reasoningEffort' in result, false, 'no stale level survives');
  assert.equal('maxTokens' in result, false, 'no stale cap survives');
});

test('a followed role keeps its resolved route when the parent is gone', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1, maxTokens: 48000 };
  const { result } = await run({
    profiles: profile({ effort: 'none', temperature: 0.1 }),
    resolved,
    parentId: 'missing-parent',
  });
  assert.deepEqual(result, resolved, 'an unreadable parent falls back to the existing route');
});

test('half a configured route follows the parent instead of pinning half a route', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1, maxTokens: 48000 };
  const { result } = await run({
    profiles: profile({ model: 'orphan-model', effort: 'none', temperature: 0.1 }),
    info: { [QWEN]: { reasoning: { efforts: [{ id: 'low' }] } } },
    resolved,
    parent: { provider: 'openrouter', model: 'qwen3-coder', reasoningEffort: 'low', maxTokens: 32000 },
  });
  assert.equal(result.provider, 'openrouter', 'the half route is ignored and the session route applies');
  assert.equal(result.model, 'qwen3-coder');
});

test('a followed role keeps the resolved values when the session route cannot be verified', async () => {
  // A model switch the registrar cannot resolve must not copy the parent's
  // level or cap onto the route the request will actually run on.
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 48000 };
  const { result, warnings } = await run({
    profiles: profileFor('designer', { effort: 'none', temperature: 0.1 }),
    info: {},
    resolved,
    roleId: 'designer',
    parent: { provider: 'openrouter', model: 'qwen3-coder', reasoningEffort: 'low', maxTokens: 32000 },
  });
  assert.deepEqual(result, resolved, 'no session value travels onto an unverified route');
  assert.match(warnings.join('\n'), /metadata is unavailable/);
});

test('a pinned route on another model does not inherit the session cap', async () => {
  // The host copies the parent's maxTokens into the child unconditionally. A
  // pinned route must not wear a cap that belongs to the session's model: the
  // target model has its own limit, so no cap is sent and its default applies.
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 384000 };
  const { result } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'none', temperature: 0.1 }),
    info: { [QWEN]: { reasoning: { efforts: [{ id: 'high' }] } } },
    resolved,
    parent: { provider: BASE, model: PRO, reasoningEffort: 'max', maxTokens: 384000 },
  });
  assert.equal(result.provider, 'openrouter');
  assert.equal('maxTokens' in result, false, 'the target model decides, not the session');
});

test('a pinned route on the session model keeps the session cap', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 384000 };
  const { result } = await run({
    profiles: profile({ provider: BASE, model: PRO, effort: 'none', temperature: 0.1 }),
    resolved,
    parent: { provider: BASE, model: PRO, reasoningEffort: 'max', maxTokens: 384000 },
  });
  assert.deepEqual(result, resolved, 'the cap belongs to the same model, so nothing changes');
});

test('a pinned route applies its own cap and clamps it to the target model', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 384000 };
  const { result } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'none', temperature: 0.1, maxTokens: 64000 }),
    info: { [QWEN]: { reasoning: { efforts: [{ id: 'high' }] }, defaultMaxTokens: 32000 } },
    resolved,
    parent: { provider: BASE, model: PRO, reasoningEffort: 'max', maxTokens: 384000 },
  });
  assert.equal(result.maxTokens, 32000, 'the role cap is applied and clamped to the model default');
});

test('a pinned role cap larger than the model default is clamped on the first request', async () => {
  // Nothing reroutes on the first request of a session, so the clamp cannot
  // ride the reroute branch: a stored 128k on a 32k model must still be lowered.
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 128000 };
  const { result } = await run({
    profiles: profile({ provider: BASE, model: PRO, effort: 'none', temperature: 0.1, maxTokens: 128000 }),
    info: { [BASE + '/' + PRO]: { reasoning: { efforts: [{ id: 'high' }] }, defaultMaxTokens: 32000 } },
    resolved,
  });
  assert.equal(result.maxTokens, 32000, 'the model default caps an oversized role budget');
});

test('a pinned cap survives when the model metadata is unavailable', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 128000 };
  const { result } = await run({
    profiles: profile({ provider: BASE, model: PRO, effort: 'none', temperature: 0.1, maxTokens: 128000 }),
    info: {},
    resolved,
  });
  assert.deepEqual(result, resolved, 'a failed lookup keeps the saved cap');
});

test('a role with no route keeps the session route and applies only its own knobs', async () => {
  // Issue #11: this is the shipped default — no provider/model means the child
  // follows the session's main model, while the role's effort/temperature still
  // apply. The saved effort is checked against the SESSION route's metadata.
  const resolved = { provider: 'session-provider', model: 'session-model', reasoningEffort: 'high', temperature: 0.1, maxTokens: 64000 };
  const { result, warnings } = await run({
    profiles: profile({ effort: 'low', temperature: 0.2 }),
    info: { 'session-provider/session-model': { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } } },
    resolved,
  });
  assert.equal(result.provider, 'session-provider', 'the inherited route is untouched');
  assert.equal(result.model, 'session-model', 'the inherited model is untouched');
  assert.equal(result.reasoningEffort, 'low', 'the role effort still applies');
  assert.equal(result.temperature, 0.2, 'the role temperature still applies');
  assert.equal(result.maxTokens, 64000, 'maxTokens is left to the session route');
  assert.deepEqual(warnings, []);
});

test('half a configured route never reroutes the child', async () => {
  // A model without its provider (or the reverse) cannot describe a target;
  // pairing it with the session's other half would cross providers.
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1 };
  for (const half of [{ model: 'orphan-model' }, { provider: 'orphan-provider' }]) {
    const { result } = await run({
      profiles: profile({ ...half, effort: 'none' }),
      info: { [BASE + '/' + PRO]: { reasoning: { efforts: [{ id: 'max' }] } } },
      resolved,
    });
    assert.equal(result.provider, BASE, JSON.stringify(half) + ': provider stays the session route');
    assert.equal(result.model, PRO, JSON.stringify(half) + ': model stays the session route');
  }
});

test('a saved route change reroutes the next child request', async () => {
  const { result } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'max', temperature: 0.1 }),
    info: { [QWEN]: { reasoning: { efforts: [{ id: 'high' }, { id: 'low' }] }, defaultMaxTokens: 32000 } },
    resolved: { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 128000 },
  });
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, 'qwen3-coder');
  assert.equal('reasoningEffort' in result, false);
  assert.equal(result.maxTokens, 32000);
});

test('an unsupported role effort falls back to the session effort, not the model default', async () => {
  // The issue-#11 scenario: the role follows the main model and keeps its own
  // effort (oracle = max). A new session runs a main model without "max" — the
  // request must land on the session's own level, which that model does declare.
  const resolved = { provider: 'session-p', model: 'session-m', reasoningEffort: 'high', temperature: 0.1, maxTokens: 64000 };
  const { result, warnings } = await run({
    profiles: profile({ provider: 'session-p', model: 'session-m', effort: 'max', temperature: 0.1 }),
    info: { 'session-p/session-m': { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } } },
    resolved,
  });
  assert.equal(result.reasoningEffort, 'high', 'the session level survives instead of an arbitrary model default');
  assert.match(warnings.join('\n'), /using the session effort "high"/);
});

test('a session effort the model cannot take still degrades to the model default', async () => {
  const resolved = { provider: 'session-p', model: 'session-m', reasoningEffort: 'max', temperature: 0.1 };
  const { result, warnings } = await run({
    profiles: profile({ provider: 'session-p', model: 'session-m', effort: 'xhigh', temperature: 0.1 }),
    info: { 'session-p/session-m': { reasoning: { efforts: [{ id: 'low' }] } } },
    resolved,
  });
  assert.equal('reasoningEffort' in result, false, 'both levels are undeclared, so the model default runs');
  assert.match(warnings.join('\n'), /using the model default/);
});

test('an effort the new model offers is carried over', async () => {
  const { result } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'max', temperature: 0.1 }),
    info: { [QWEN]: { reasoning: { efforts: [{ id: 'max' }, { id: 'high' }] } } },
    resolved: { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 128000 },
  });
  assert.equal(result.reasoningEffort, 'max');
  assert.equal(result.maxTokens, 128000);
});

test('an explicit none drops the old route effort instead of forwarding it', async () => {
  const { result, warnings } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'none', temperature: 0.1 }),
    info: { [QWEN]: { reasoning: { efforts: [{ id: 'high' }] } } },
    resolved: { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1 },
  });
  assert.equal('reasoningEffort' in result, false);
  assert.equal(warnings.length, 0);
});

test('the orchestrator request keeps its own model and only gets a temperature floor', async () => {
  const { result } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'max' }),
    agent: { session: { header: {} } },
    resolved: { temperature: undefined, reasoningEffort: 'max' },
  });
  assert.deepEqual(result, { temperature: 0.1, reasoningEffort: 'max' });
});

test('an unidentified child keeps the historical fallback and no route override', async () => {
  const { result } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'max' }),
    roleId: 'not-a-role',
    resolved: { temperature: undefined, reasoningEffort: undefined },
  });
  assert.deepEqual(result, { temperature: 0.1, reasoningEffort: 'high' });
});

test('a fixture without a resolved route does not trigger a model lookup', async () => {
  const resolved = { temperature: 0.4, reasoningEffort: 'high' };
  const { result } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'none', temperature: 0.4 }),
    resolved,
  });
  assert.deepEqual(result, resolved);
});

test('a named profile is reread for every request', async () => {
  const profiles = { p: { roles: { oracle: { provider: 'openrouter', model: 'route-a', effort: 'none', temperature: 0.1 } } } };
  const { ctx, handlers } = harness({ profiles, info: {
    'openrouter/route-a': { provider: 'openrouter', id: 'route-a', name: 'route-a' },
    'openrouter/route-b': { provider: 'openrouter', id: 'route-b', name: 'route-b' },
  } });
  apply(ctx, { profileId: 'p' });
  const agent = child('oracle');
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 128000 };
  const first = await handlers[0]({ agent }, async () => resolved);
  assert.equal(first.model, 'route-a');
  profiles.p.roles.oracle.model = 'route-b';
  const second = await handlers[0]({ agent }, async () => resolved);
  assert.equal(second.model, 'route-b');
});

test('a configured model whose metadata is unavailable keeps the current route and warns', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1 };
  const { result, warnings } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'max', temperature: 0.1 }),
    info: {},
    resolved,
  });
  assert.deepEqual(result, resolved);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /metadata is unavailable; keeping the current route/);
});

test('a larger output cap on the new model does not raise the old token budget', async () => {
  const { result } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'high', temperature: 0.1 }),
    info: { [QWEN]: { reasoning: { efforts: [{ id: 'high' }] }, defaultMaxTokens: 256000 } },
    resolved: { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1, maxTokens: 128000 },
  });
  assert.equal(result.maxTokens, 128000);
});

test('a saved temperature change still applies while the route changes', async () => {
  const { result } = await run({
    profiles: profile({ provider: 'openrouter', model: 'qwen3-coder', effort: 'high', temperature: 0.7 }),
    info: { [QWEN]: { reasoning: { efforts: [{ id: 'high' }] } } },
    resolved: { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1, maxTokens: 128000 },
  });
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.temperature, 0.7);
});

// Issue #9, second half: the card gates new saves, but configuration written
// outside it (an old profile, a hand-edited document, a model whose declaration
// changed) reaches the first dispatch unchanged. A stored level the mounted
// model does not offer must degrade to the model default there as well, instead
// of failing at dispatch with `does not support reasoning effort`.
test('an unchanged route whose model does not offer the saved effort degrades instead of failing', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1, maxTokens: 128000 };
  const { result, warnings } = await run({
    profiles: profile({ provider: BASE, model: PRO, effort: 'max', temperature: 0.1 }),
    info: { [BASE + '/' + PRO]: { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } } },
    resolved,
  });
  assert.equal('reasoningEffort' in result, false);
  assert.equal(result.maxTokens, 128000);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /effort "max" is not offered by "deepseek-official\/deepseek-v4-pro"; using the model default/);
});

test('a model with no effort control drops a saved level on an unchanged route', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1 };
  const { result, warnings } = await run({
    profiles: profile({ provider: BASE, model: PRO, effort: 'high', temperature: 0.1 }),
    info: { [BASE + '/' + PRO]: { provider: BASE, id: PRO, name: 'pro' } },
    resolved,
  });
  assert.equal('reasoningEffort' in result, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /The model declares no reasoning efforts/);
});

test('a supported level is kept on an unchanged route', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1 };
  const { result, warnings } = await run({
    profiles: profile({ provider: BASE, model: PRO, effort: 'max', temperature: 0.1 }),
    info: { [BASE + '/' + PRO]: { reasoning: { efforts: [{ id: 'max' }, { id: 'high' }] } } },
    resolved,
  });
  assert.deepEqual(result, resolved);
  assert.equal(warnings.length, 0);
});

test('an unchanged route with unavailable metadata keeps the saved effort', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1 };
  const { result, warnings } = await run({
    profiles: profile({ provider: BASE, model: PRO, effort: 'max', temperature: 0.1 }),
    info: {},
    resolved,
  });
  assert.deepEqual(result, resolved);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /metadata is unavailable; keeping the current route/);
});

// The saved route's metadata can be unavailable while the request still runs on
// the route the host resolved. The effort must then be judged against that
// route, because that is where it will actually be sent.
const profileFor = (roleId, config) => ({ p: { roles: { [roleId]: config } } });

test('a failed target lookup validates the effort against the route that will run', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1 };
  const { result, warnings } = await run({
    profiles: profileFor('fixer', { provider: 'openrouter', model: 'qwen3-coder', effort: 'high', temperature: 0.1 }),
    info: { [BASE + '/' + PRO]: { reasoning: { efforts: [{ id: 'low' }] } } },
    resolved,
    roleId: 'fixer',
  });
  assert.equal(result.provider, BASE, 'without target metadata the request is not rerouted');
  assert.equal('reasoningEffort' in result, false, 'the saved level is checked against the resolved route');
  assert.match(warnings.join('\n'), /effort "high" is not offered by "deepseek-official\/deepseek-v4-pro"/,
    'the warning names the route the request actually runs on');
  assert.equal(warnings.filter((entry) => /metadata is unavailable/.test(entry)).length, 1,
    'the silent re-check does not repeat the metadata warning');
});

test('a failed target lookup keeps a level the resolved route offers', async () => {
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1 };
  const { result } = await run({
    profiles: profileFor('fixer', { provider: 'openrouter', model: 'qwen3-coder', effort: 'high', temperature: 0.1 }),
    info: { [BASE + '/' + PRO]: { reasoning: { efforts: [{ id: 'high' }] } } },
    resolved,
    roleId: 'fixer',
  });
  assert.deepEqual(result, resolved);
});

test('a saved effort change applies on an unchanged route', async () => {
  const { result } = await run({
    profiles: profileFor('designer', { provider: BASE, model: PRO, effort: 'low', temperature: 0.1 }),
    info: { [BASE + '/' + PRO]: { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } } },
    resolved: { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1 },
    roleId: 'designer',
  });
  assert.equal(result.reasoningEffort, 'low');
});

test('an unsupported saved effort keeps the inherited level when the model declares it', async () => {
  // Issue #11: "follow the model" should land on what the session itself runs
  // with, not an arbitrary model default. The inherited level is only kept
  // after the target model's declaration confirms it.
  const { result, warnings } = await run({
    profiles: profileFor('designer', { provider: BASE, model: PRO, effort: 'max', temperature: 0.1 }),
    info: { [BASE + '/' + PRO]: { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } } },
    resolved: { provider: BASE, model: PRO, reasoningEffort: 'low', temperature: 0.1 },
    roleId: 'designer',
  });
  assert.equal(result.reasoningEffort, 'low', 'the inherited level is kept instead of the model default');
  assert.match(warnings.join('\n'), /using the session effort "low"/);
});

test('an unsupported saved effort drops the inherited level when that is undeclared too', async () => {
  const { result, warnings } = await run({
    profiles: profileFor('designer', { provider: BASE, model: PRO, effort: 'max', temperature: 0.1 }),
    info: { [BASE + '/' + PRO]: { reasoning: { efforts: [{ id: 'medium' }] } } },
    resolved: { provider: BASE, model: PRO, reasoningEffort: 'high', temperature: 0.1 },
    roleId: 'designer',
  });
  assert.equal('reasoningEffort' in result, false, 'the model default is used, not a stale level');
  assert.match(warnings.join('\n'), /using the model default/);
});

test('an unsupported effort warns once per role, route and level', async () => {
  const profiles = profileFor('librarian', { provider: BASE, model: PRO, effort: 'max', temperature: 0.1 });
  const info = { [BASE + '/' + PRO]: { reasoning: { efforts: [{ id: 'low' }] } } };
  const resolved = { provider: BASE, model: PRO, reasoningEffort: 'max', temperature: 0.1 };
  const first = await run({ profiles, info, resolved, roleId: 'librarian' });
  assert.equal(first.warnings.length, 1);
  const second = await run({ profiles, info, resolved, roleId: 'librarian' });
  assert.equal(second.warnings.length, 0, 'the same fallback is not reported twice');
});

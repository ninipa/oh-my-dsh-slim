import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../npm-package/preset/subagent-roles.js';

const BASE = 'deepseek-official';
const PRO = 'deepseek-v4-pro';
const QWEN = 'openrouter/qwen3-coder';

function harness({ profiles, info }) {
  const handlers = [];
  const warnings = [];
  const ctx = {
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
    get: (key) => {
      if (key === 'omdsProfiles') return { read: (id) => profiles[id] };
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

function child(roleId) {
  return {
    session: {
      header: { origin: 'subagent', delegationDepth: 1 },
      ownEvents: () => [{ type: 'subagent/descriptor', data: { persona: 'Internal role id: oh-my-dsh-slim-role:' + roleId + '.' } }],
    },
  };
}

async function run({ profiles, info, roleId = 'oracle', agent = child(roleId), resolved }) {
  const { ctx, handlers, warnings } = harness({ profiles, info });
  apply(ctx, { profileId: 'p' });
  assert.equal(handlers.length, 1);
  const result = await handlers[0]({ agent }, async () => resolved);
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

// Zero-cost unit test for effort-by-role.js: exercises the agent/request
// waterfall listener against the 6 matrix keys, the fallback branch, and the
// top-level temperature default/override rules, without any LLM call.
// Usage: node scripts/test-effort-plugin.mjs
import { readFileSync } from 'node:fs';
import { apply } from '../effort-by-role.js';

// Expected effort comes from the bundled defaults.json (single source of
// truth) so the test stays valid across deployments with different matrices.
const defaults = JSON.parse(readFileSync(new URL('../defaults.json', import.meta.url), 'utf8'));
const bundledEffort = (roleId) => defaults.presets[defaults.preset][roleId].effort;

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };

function makeCtx() {
  const listeners = [];
  return {
    on(name, listener) { if (name === 'agent/request') listeners.push(listener); },
    listeners,
  };
}

async function requestThrough(ctx, options, seed = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, agentExtra) {
  let resolved = seed;
  const agent = { options, ...agentExtra };
  for (const listener of ctx.listeners) {
    resolved = await listener({ agent }, async () => resolved);
  }
  return resolved;
}

// ── stable role ids (model/token values are intentionally arbitrary) ───────
console.log('\n[matrix]');
const cases = [
  ['oracle', { model: 'custom-model-a', maxTokens: 11111, dshRoleId: 'oracle', subagentDepth: 1 }, 0.1],
  ['designer', { model: 'custom-model-b', maxTokens: 22222, dshRoleId: 'designer', subagentDepth: 1 }, 0.7],
  ['fixer', { model: 'custom-model-c', maxTokens: 33333, dshRoleId: 'fixer', subagentDepth: 1 }, 0.2],
  ['explorer', { model: 'custom-model-d', maxTokens: 44444, dshRoleId: 'explorer', subagentDepth: 1 }, 0.1],
  ['librarian', { model: 'custom-model-e', maxTokens: 55555, dshRoleId: 'librarian', subagentDepth: 1 }, 0.1],
  ['observer', { model: 'custom-model-f', maxTokens: 66666, dshRoleId: 'observer', subagentDepth: 1 }, 0.1],
];
for (const [role, options, expectedTemp] of cases) {
  const ctx = makeCtx();
  apply(ctx);
  const expectedEffort = bundledEffort(role);
  const resolved = await requestThrough(ctx, options, { provider: 'opencode-go', model: options.model });
  const effortOk = resolved.reasoningEffort === expectedEffort;
  const tempOk = resolved.temperature === expectedTemp;
  if (effortOk && tempOk) pass(`${role} -> effort=${expectedEffort}, temperature=${expectedTemp}`);
  else fail(`${role}: expected effort=${expectedEffort} temp=${expectedTemp}, got ${JSON.stringify({ effort: resolved.reasoningEffort, temperature: resolved.temperature })}`);
}

// ── fallback (unknown maxTokens, e.g. matrix edited without syncing) ────────
console.log('\n[fallback]');
{
  const ctx = makeCtx();
  apply(ctx);
  const resolved = await requestThrough(ctx, { model: 'custom-model', maxTokens: 12345, dshRoleId: 'unknown', subagentDepth: 1 }, { provider: 'opencode-go', model: 'custom-model' });
  if (resolved.reasoningEffort === 'high') pass('unknown key falls back to high');
  else fail(`fallback: expected high, got ${JSON.stringify(resolved.reasoningEffort)}`);
}

// ── top-level session defaults to omo orchestrator temperature ──────────────
console.log('\n[top-level]');
{
  const ctx = makeCtx();
  apply(ctx);
  const seed = { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' };
  const resolved = await requestThrough(ctx, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, seed);
  if (resolved.reasoningEffort === 'max' && resolved.model === 'deepseek-v4-flash' && resolved.temperature === 0.1) pass('top-level request defaults temperature=0.1');
  else fail(`top-level default broken: ${JSON.stringify(resolved)}`);
}

// ── explicit top-level temperature remains authoritative ───────────────────
{
  const ctx = makeCtx();
  apply(ctx);
  const seed = { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max', temperature: 0.6 };
  const resolved = await requestThrough(ctx, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, seed);
  if (resolved.temperature === 0.6 && resolved.reasoningEffort === 'max') pass('explicit top-level temperature preserved');
  else fail(`explicit top-level temperature overwritten: ${JSON.stringify(resolved)}`);
}

// ── no-op when already equal ────────────────────────────────────────────────
console.log('\n[no-op]');
{
  const ctx = makeCtx();
  apply(ctx);
  const effort = bundledEffort('oracle');
  const resolved = await requestThrough(ctx, { model: 'custom-model', maxTokens: 99999, dshRoleId: 'oracle', subagentDepth: 1 }, { provider: 'opencode-go', model: 'custom-model', reasoningEffort: effort });
  if (resolved.reasoningEffort === effort) pass('equal effort returns without churn');
  else fail(`no-op broken: ${JSON.stringify(resolved)}`);
}

// ── cold-resumed continuable child (regression: 2026-08-21 smoke) ───────────
// The host omits runtime `subagentDepth` on cold resume (it trusts the durable
// header's delegationDepth), so the plugin must classify via the session
// header and re-resolve the role from the persisted descriptor marker.
console.log('\n[cold-resume]');
{
  const ctx = makeCtx();
  apply(ctx);
  const agentExtra = {
    session: {
      header: { delegationDepth: 1, parentSession: 'session-parent' },
      events: [
        { type: 'subagent/descriptor', data: { persona: 'Internal role id: oh-my-dsh-slim-role:fixer.\n\nYou are Fixer...' } },
      ],
    },
  };
  const resolved = await requestThrough(
    ctx,
    { provider: 'opencode-go', model: 'mimo-v2.5', maxTokens: 96000 },
    { provider: 'opencode-go', model: 'mimo-v2.5' },
    agentExtra,
  );
  if (resolved.temperature === 0.2 && resolved.reasoningEffort === 'high') pass('cold-resumed fixer keeps temperature=0.2 via header+marker');
  else fail(`cold-resumed fixer lost role temperature: ${JSON.stringify({ effort: resolved.reasoningEffort, temperature: resolved.temperature })}`);
}
{
  // A cold-resumed child of an unknown role still lands on the safe fallback.
  const ctx = makeCtx();
  apply(ctx);
  const agentExtra = {
    session: {
      header: { delegationDepth: 1, parentSession: 'session-parent' },
      events: [{ type: 'subagent/descriptor', data: { persona: 'no marker here' } }],
    },
  };
  const resolved = await requestThrough(ctx, { provider: 'opencode-go', model: 'mimo-v2.5' }, { provider: 'opencode-go', model: 'mimo-v2.5' }, agentExtra);
  if (resolved.reasoningEffort === 'high' && resolved.temperature === 0.1) pass('cold-resumed child without marker falls back to high/0.1');
  else fail(`cold-resumed fallback broken: ${JSON.stringify(resolved)}`);
}

// ── explicit none omits reasoningEffort while preserving temperature ─────────
console.log('\n[none]');
{
  const { writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmp = join(tmpdir(), `omds-effort-none-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify({ preset: 'p', presets: { p: { fixer: { effort: 'none' } } } }));
  const prev = process.env.OH_MY_DSH_SLIM_CONFIG;
  process.env.OH_MY_DSH_SLIM_CONFIG = tmp;
  try {
    const ctx = makeCtx();
    apply(ctx);
    const resolved = await requestThrough(
      ctx,
      { model: 'local-llama', maxTokens: 33333, dshRoleId: 'fixer', subagentDepth: 1 },
      { provider: 'local', model: 'local-llama' },
    );
    if (resolved.temperature === 0.2 && !('reasoningEffort' in resolved)) {
      pass('none omits reasoningEffort and keeps role temperature');
    } else {
      fail(`none mode broken: ${JSON.stringify({ effort: resolved.reasoningEffort, temperature: resolved.temperature })}`);
    }
  } finally {
    if (prev === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
    else process.env.OH_MY_DSH_SLIM_CONFIG = prev;
    rmSync(tmp, { force: true });
  }
}

// ── a configured level is checked against the exact model's declared efforts ─
// Effort ids are adapter-owned, so the configuration writers accept any
// well-formed token and this waterfall decides whether the chosen model
// declares it. Metadata that cannot be resolved fails open; only a derived
// verdict is cached.
console.log('\n[effort-declared]');
{
  const { writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const declared = ['low', 'medium', 'xhigh', 'max'];
  const modelStub = (calls) => ({
    resolveModel: async (provider, model) => {
      calls.push(`${provider}/${model}`);
      return { reasoning: { efforts: declared.map((id) => ({ id })), defaultEffort: 'medium' } };
    },
  });
  const runWith = async (effort, llm, model = 'gpt-5.6-sol') => {
    const tmp = join(tmpdir(), `omds-effort-declared-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(tmp, JSON.stringify({ preset: 'p', presets: { p: { fixer: { effort } } } }));
    const prev = process.env.OH_MY_DSH_SLIM_CONFIG;
    process.env.OH_MY_DSH_SLIM_CONFIG = tmp;
    try {
      const ctx = makeCtx();
      ctx.get = (name) => (name === 'llm' ? llm : undefined);
      apply(ctx);
      return await requestThrough(
        ctx,
        { provider: 'intelalloc', model, maxTokens: 33333, dshRoleId: 'fixer', subagentDepth: 1 },
        { provider: 'intelalloc', model },
      );
    } finally {
      if (prev === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
      else process.env.OH_MY_DSH_SLIM_CONFIG = prev;
      rmSync(tmp, { force: true });
    }
  };
  const catchFrom = async (effort, llm, model) => {
    try {
      await runWith(effort, llm, model);
      return undefined;
    } catch (error) {
      return error;
    }
  };

  // Each case runs on its own provider/model/effort key: verdicts are cached
  // per key, so sharing one would serve a case from another case's verdict.
  const calls = [];
  const declaredRun = await runWith('xhigh', modelStub(calls));
  if (declaredRun.reasoningEffort === 'xhigh') pass('a declared level (xhigh) is injected');
  else fail(`declared level not injected: ${JSON.stringify(declaredRun)}`);

  await runWith('xhigh', modelStub(calls));
  if (calls.length === 1) pass('the verdict is cached per provider/model/effort');
  else fail(`verdict re-resolved ${calls.length} times`);

  const undeclared = await catchFrom('ultra', modelStub([]));
  if (undeclared && /ultra/.test(undeclared.message) && /xhigh/.test(undeclared.message) && /medium/.test(undeclared.message)) {
    pass('an undeclared level fails with the declared list in the message');
  } else {
    fail(`undeclared level not rejected: ${undeclared === undefined ? 'no error' : undeclared.message}`);
  }

  const offline = await runWith('ultra', { resolveModel: async () => { throw new Error('provider not registered'); } }, 'offline-model');
  if (offline.reasoningEffort === 'ultra') pass('unresolvable metadata fails open');
  else fail(`unresolvable metadata blocked the request: ${JSON.stringify(offline)}`);

  const noService = await runWith('ultra', undefined, 'no-service-model');
  if (noService.reasoningEffort === 'ultra') pass('a missing llm service fails open');
  else fail(`missing llm service blocked the request: ${JSON.stringify(noService)}`);

  const noEfforts = await runWith('ultra', { resolveModel: async () => ({ reasoning: {} }) }, 'no-efforts-model');
  if (noEfforts.reasoningEffort === 'ultra') pass('a model with no declared efforts fails open');
  else fail(`model without declared efforts blocked the request: ${JSON.stringify(noEfforts)}`);

  // "Could not judge" must not be sticky: the same key judged later still fails.
  const lateKey = 'late-model';
  const beforeJudgement = await runWith('ultra', undefined, lateKey);
  const afterJudgement = await catchFrom('ultra', modelStub([]), lateKey);
  if (beforeJudgement.reasoningEffort === 'ultra' && afterJudgement && /ultra/.test(afterJudgement.message)) {
    pass('an unjudged key is re-judged once metadata is available');
  } else {
    fail('an unjudged verdict was cached and never re-checked');
  }
}

// (The matrix-key uniqueness and table coverage checks live in t0-validate.mjs
// section [3]; no duplication here.)

console.log(failures === 0 ? '\nEFFORT PLUGIN: ALL CHECKS PASSED' : `\nEFFORT PLUGIN: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

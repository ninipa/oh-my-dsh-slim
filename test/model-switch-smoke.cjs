// Opt-in model-switch smoke: boot a real host, mount the production
// subagent-roles row, and prove that editing the role configuration between two
// child requests reroutes the second child without restarting the session.
//
// The request is stopped at the agent/request waterfall before any model call,
// so this runs without credentials or tokens.
//
// The row is applied through a small context shim without `loader`: the
// composition-scope guard it would then install is covered separately by
// test/profile-scope.test.mjs, and this smoke exists to exercise the request
// patch against the real host waterfall on both supported host lines.
//
// Usage:
//   DSH_HOST_ANCHOR=<installed host bin.js> node --expose-internals test/model-switch-smoke.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');

const anchor = process.env.DSH_HOST_ANCHOR;
if (!anchor || !path.isAbsolute(anchor)) throw new Error('Set DSH_HOST_ANCHOR to an absolute installed DSH host JS entry');
const requireHost = createRequire(anchor);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omds-model-switch-'));
process.env.DSH_HOME = temporary;
delete process.env.DSH_PROFILE;
delete process.env.OH_MY_DSH_SLIM_CONFIG;
process.argv[1] = anchor;
const hostImport = (name) => import(pathToFileURL(requireHost.resolve(name)).href);
const packageDir = path.resolve(__dirname, '../npm-package');
const log = (...args) => console.log('[model-switch-smoke]', ...args);

(async () => {
  let ctx;
  try {
    const yaml = requireHost('js-yaml');
    const { boot } = await hostImport('@deepseek-ai/dsh-app-boot');
    const { LlmAdapter } = await hostImport('@deepseek-ai/dsh-llm');
    const baseDir = path.dirname(requireHost.resolve('@deepseek-ai/dsh-base/package.json'));
    const JsExpr = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => ({ __jsExpr: data }) });
    const rows = yaml.load(fs.readFileSync(path.join(baseDir, 'cordis.patch.yml'), 'utf8'), { schema: yaml.JSON_SCHEMA.extend(JsExpr) }).flatMap((p) => p.insert ?? []);
    for (const row of rows) if (['session-title-llm', 'session-query-sqlite', 'hmr'].includes(row.id)) row.disabled = true;
    const configPath = path.join(temporary, 'smoke.yml');
    fs.writeFileSync(configPath, yaml.dump(rows));
    fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'omds-model-switch-smoke', private: true }));
    const smokeHome = path.join(temporary, 'home'); fs.mkdirSync(smokeHome);
    const profileContext = { home: smokeHome, dir: temporary, patchPath: path.join(temporary, 'cordis.patch.yml'), installAnchor: anchor, name: 'omds-model-switch-smoke', startedBundles: [], bundles: [], overlays: [] };
    ctx = await boot('omds-model-switch-smoke', configPath, [], (root) => { root.provide('profileContext', profileContext); }, pathToFileURL(anchor).href);
    log('booted');

    const roleConfigPath = path.join(temporary, 'roles.json');
    const writeRoles = (model, effort, maxTokens) => fs.writeFileSync(roleConfigPath, JSON.stringify({
      roles: { oracle: { provider: 'fake', model, effort, temperature: 0.1, maxTokens } },
    }));
    writeRoles('route-a', 'max', 128000);
    process.env.OH_MY_DSH_SLIM_CONFIG = roleConfigPath;

    class FakeAdapter extends LlmAdapter {
      async *stream() {}
      async resolveModel(provider, model) {
        return {
          provider, id: model, name: model,
          reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }], defaultEffort: 'high' },
          defaultMaxTokens: 4096,
        };
      }
    }

    const subagentRoles = await import(pathToFileURL(path.join(packageDir, 'preset/subagent-roles.js')).href);
    const rowCtx = {
      get: (key) => ctx.get(key),
      effect: (factory) => ctx.effect(factory),
      on: (...args) => ctx.on(...args),
      logger: ctx.logger,
    };
    subagentRoles.apply(rowCtx, {});

    let notify;
    const observed = [];
    ctx.on('agent/request', async (payload, next) => {
      const own = payload.agent?.session?.ownEvents?.() ?? [];
      if (!own.some((event) => event.type === 'subagent/descriptor')) return next();
      const config = await next();
      const seen = { provider: config.provider, model: config.model, effort: config.reasoningEffort, maxTokens: config.maxTokens };
      observed.push(seen);
      const resolve = notify; notify = undefined;
      if (resolve) resolve(seen);
      throw new Error('MODEL_SWITCH_STOP');
    }, true);

    await new Promise((resolve, reject) => {
      ctx.inject(['llm', 'agents', 'subagents', 'systemPrompt'], async (c) => {
        try {
          c.llm.registerAdapter(['fake'], new FakeAdapter());
          const rootId = 'model-switch-root-' + randomUUID();
          const parent = (await c.agents.create({ sessionId: rootId, meta: { cwd: process.cwd() } })).agent;
          parent.options = { ...parent.options, provider: 'fake', model: 'route-a', reasoningEffort: 'max', maxTokens: 128000 };

          // The "follow the session" path reads three host primitives on every
          // child request: the child's parentSession, the live agents registry,
          // and the parent's request header. Pin them here (on a separate
          // parent so the pinned-route scenario above keeps its own header) so
          // a host change fails this smoke instead of silently sending
          // followers back to their mount-time route.
          const followRootId = 'model-switch-follow-root-' + randomUUID();
          const followParent = await c.agents.create({ sessionId: followRootId, meta: { cwd: process.cwd() } });
          followParent.agent.session.append('request/header', {
            header: { config: { provider: 'fake', model: 'route-follow', reasoningEffort: 'high', maxTokens: 32000 } },
            reason: 'initial',
          });
          assert.equal(followParent.agent.session.requestHeader()?.config?.model, 'route-follow', 'the parent header is readable');
          assert.equal(c.agents.get(followRootId), followParent.agent, 'the agents registry resolves a session id back to its agent');
          const probe = await c.agents.create({
            sessionId: 'model-switch-child-' + randomUUID(),
            parentAgent: followParent.agent,
            meta: { cwd: process.cwd(), parentSession: followRootId, origin: 'subagent', delegationDepth: 1 },
          });
          assert.equal(probe.agent.session.header.parentSession, followRootId, 'a child session records its parent');

          const request = async () => {
            const wait = new Promise((done, fail) => {
              const timer = setTimeout(() => fail(new Error('timed out waiting for the child request')), 10000);
              notify = (value) => { clearTimeout(timer); done(value); };
            });
            try {
              await (typeof c.subagents.startActivation === 'function'
                ? c.subagents.startActivation({ provider: 'spawn', label: 'oracle · smoke', request: { prompt: [{ type: 'text', text: 'smoke' }], parent, maxDepth: 1 }, signal: new AbortController().signal, delivery: 'parent' })
                : c.subagents.startContinuable({ provider: 'spawn', label: 'oracle · smoke', request: { prompt: [{ type: 'text', text: 'smoke' }], parent, maxDepth: 1 }, signal: new AbortController().signal }));
            } catch (error) {
              if (!String(error?.message ?? error).includes('MODEL_SWITCH_STOP')) throw error;
            }
            return wait;
          };

          const first = await request();
          assert.equal(first.provider, 'fake', 'first child keeps the mounted route provider');
          assert.equal(first.model, 'route-a', 'first child keeps the mounted route model');
          // The mounted route (resolved by the host before this request) carries
          // effort "max", which the fake model does not offer: the first child
          // must run on the model default instead of failing at dispatch.
          assert.equal(first.effort, undefined, 'an incompatible level is dropped on the first request');
          // 0.8.6: a cap above the model's declared default is clamped on the
          // first request too (the fake model declares 4096).
          assert.equal(first.maxTokens, 4096, 'an oversized configured cap is clamped to the model default');

          writeRoles('route-b', 'high', 999999);
          const second = await request();
          assert.equal(second.provider, 'fake', 'second child keeps the configured provider');
          assert.equal(second.model, 'route-b', 'a saved route change applies to the next child request');
          assert.equal(second.effort, 'high', 'a level the new model offers is carried over');
          assert.equal(second.maxTokens, 4096, 'the output cap is clamped to the new model');

          writeRoles('route-b', 'max', 999999);
          const third = await request();
          log('observed', JSON.stringify(observed));
          assert.equal(third.model, 'route-b', 'the rerouted model is kept');
          assert.equal(third.effort, undefined, 'an unsupported effort falls back to the model default');
          assert.equal(third.maxTokens, 4096, 'the clamped cap survives a further edit');

          log('MODEL_SWITCH_SMOKE_PASS', JSON.stringify({ first, second, third }));
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error('[model-switch-smoke] FAILED', error);
    process.exitCode = 1;
  } finally {
    setTimeout(async () => {
      if (ctx) await ctx.fiber.dispose().catch(() => {});
      fs.rmSync(temporary, { recursive: true, force: true });
      process.exit(process.exitCode ?? 0);
    }, 6000);
  }
})().catch((error) => { console.error(error); process.exit(1); });

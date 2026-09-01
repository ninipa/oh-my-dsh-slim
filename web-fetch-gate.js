// web-fetch-gate — dynamic web_fetch tool mount for oh-my-dsh-slim.
//
// The preset's tool-web row ships `fetch: false` (web_fetch absent by
// default). This companion plugin lets the user's `webFetch` configuration
// (host settings namespace or legacy JSON, read through config-loader) turn
// the tool ON at runtime without touching the composition file:
//
//   - webFetch enabled AND a fetch provider registered (e.g. the official
//     @deepseek-ai/dsh-web-fetch-http host plugin) → mount the real
//     `web_fetch` tool via the host's own applyWebFetchTool, so schema and
//     presentation stay byte-identical with a fetch:true tool-web row.
//   - enabled but no provider → do NOT register; log the mismatch (the GUI
//     card mirrors this state through the seeder's /omds RPC).
//   - disabled (default) → nothing is registered.
//
// The tool is mounted inside a disposable child plugin fiber, so flipping the
// setting hot-swaps the registration (dispose old fiber → register new) and
// the next model request sees the new tool list.
//
// Hosts whose dsh-tool-web does not export applyWebFetchTool (older DSH)
// degrade to "never registered" with a log line.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SETTINGS_NS, loadConfig } from './config-loader.js';

// Same dependency resolution as ./role-subagent.js: a plugin file outside the
// harness tree cannot bare-import @deepseek-ai/*, so resolve them from the
// global DSH install (the same install the `dsh` CLI runs). dsh-tool-web is
// ESM, so the module is loaded with a dynamic import once per mount.
function resolveDshPackage() {
  const roots = [];
  if (process.env.DSH_HOME) {
    roots.push(join(process.env.DSH_HOME, 'profiles', 'node_modules'));
    roots.push(join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules'));
  }
  const probeOptions = { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] };
  for (const command of ['npm root -g', 'zsh -lic "npm root -g"']) {
    // zsh -lic sources the user's login+interactive shell config, which can hang
    // (reported on Linux); every probe is bounded and silent on stderr.
    try {
      roots.push(execSync(command, probeOptions).trim());
      break; // first reachable npm root wins; the zsh fallback only runs when plain sh lacks npm
    } catch {}
  }
  try {
    const dshBin = realpathSync(execSync('command -v dsh', probeOptions).trim());
    roots.push(dirname(dirname(dirname(dirname(dshBin)))));
  } catch {}
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const root = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!root) throw new Error('web-fetch-gate: cannot locate the DSH node_modules');
  return join(root, '@deepseek-ai/dsh/package.json');
}

// Host defaults for the cooperative tool-call budget and rendered output cap
// (mirror dsh-tool-web's DEFAULT_WEB_TOOL_TIMEOUT_MS / DEFAULT_FETCH_MAX_OUTPUT_CHARS).
const FETCH_TIMEOUT_MS = 30000;
const FETCH_MAX_OUTPUT_CHARS = 200000;

export const name = 'web-fetch-gate';
export const inject = ['tools', 'web', 'systemPrompt', 'settings'];

export function apply(ctx) {
  const log = (level, message) => ctx.logger?.[level]?.(`web-fetch-gate: ${message}`);

  // The tool lives in its own child fiber so hot-swapping is a dispose +
  // re-mount of the plugin handle (registrations are fiber-scoped).
  const toolPlugin = {
    name: 'web-fetch-gate:tool',
    inject: ['tools', 'web', 'systemPrompt'],
    apply: (toolCtx) => {
      toolCtx.effect(() => () => {}, 'web-fetch-gate:tool');
    },
  };

  let applyWebFetchTool = undefined;
  let toolHandle = null;
  let disposed = false;

  const unmount = async () => {
    const handle = toolHandle;
    toolHandle = null;
    if (handle === null || handle === undefined) return;
    try {
      await handle.dispose?.();
    } catch (error) {
      log('warn', `failed to dispose web_fetch tool: ${error?.message ?? String(error)}`);
    }
    log('info', 'web_fetch tool removed');
  };

  const mount = async () => {
    if (toolHandle !== null || applyWebFetchTool === undefined) return;
    const handle = ctx.plugin(toolPlugin, {});
    toolHandle = handle;
    try {
      await handle;
    } catch (error) {
      toolHandle = null;
      log('warn', `web_fetch tool plugin failed to activate: ${error?.message ?? String(error)}`);
      return;
    }
    // The tool plugin's own fiber is alive; register through it so disposal
    // of that fiber unregisters both the tool and its prompt section.
      applyWebFetchTool(toolHandle.ctx, FETCH_TIMEOUT_MS, FETCH_MAX_OUTPUT_CHARS);
    log('info', 'web_fetch tool registered (webFetch enabled)');
  };

  const evaluate = async () => {
    if (disposed) return;
    const config = loadConfig(ctx);
      if (config.webFetch !== true) {
      await unmount();
      return;
    }
    const providers = ctx.web?.fetchProviders;
      const available = providers !== undefined && [...providers.values()].some(
      (provider) => typeof provider?.available !== 'function' || provider.available(),
    );
    if (!available) {
      await unmount();
      log('warn', 'webFetch is enabled but no fetch provider is registered (install @deepseek-ai/dsh-web-fetch-http, see README "进阶配置"); web_fetch NOT registered');
      return;
    }
    await mount();
  };

  // Apply-time evaluation only: the gate reads the CURRENT webFetch setting
  // when the standing composition mounts, so flipping the setting takes effect
  // after the next process start (restart the DSH app). Re-evaluation per
  // request (assemble) is deliberately NOT done: hot switching is a
  // micro-race window we have not validated end-to-end, and webFetch is a
  // low-frequency setting — deterministic restart semantics are preferable.
  // (The settings service's document-updated event fires on the host plane
  // and cannot be heard from this preset scope: events flow UP scope chains,
  // never down.)

  ctx.effect(() => () => {
    disposed = true;
    if (toolHandle !== null) void toolHandle.dispose?.();
  }, 'web-fetch-gate: teardown');

  void (async () => {
    try {
      const require = createRequire(resolveDshPackage());
      const mod = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tool-web')).href);
      applyWebFetchTool = mod.applyWebFetchTool;
        } catch (error) {
      log('info', `host dsh-tool-web unavailable (${error?.message ?? error}); web_fetch stays disabled`);
      return;
    }
    if (typeof applyWebFetchTool !== 'function') {
      log('info', 'host dsh-tool-web has no applyWebFetchTool export; web_fetch stays disabled');
      return;
    }
    await evaluate();
    })();
}

export { SETTINGS_NS };
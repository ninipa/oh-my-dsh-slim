// preset/bridge.js — reach the host's own @deepseek-ai/dsh-* module instances.
//
// Why this exists. A preset plugin file lives outside the DSH installation
// (it is an ordinary package inside the profile's node_modules), so a bare
// `import '@deepseek-ai/dsh-tools'` would be resolved by Node against the
// *file's own* ancestor node_modules chain. On a packaged desktop host the
// core packages live inside app.asar and are reached through the host loader,
// not through any directory on disk, so a bare import either fails outright or
// silently binds to a stale copy left in a user-level node_modules. Either way
// the Service identity would not match the host's.
//
// The host loader is the only component that can resolve them, and every
// Cordis context can reach it through the `loader` service:
//
//     ctx.loader.internal.import(specifier, baseUrl, {})
//
// Passing the host's own installation root as the base URL makes the loader
// resolve the specifier exactly as it does for its own rows, so the module
// instance — and therefore the Service class identity — is shared with the
// host. This is the same mechanism the core composition uses for bare names
// (dsh-app-boot: "bare package names resolve there by default or against an
// explicit `bareModuleBaseUrl` for closed packaged runtimes").

import { pathToFileURL } from 'node:url';

/** Path marker that anchors the host installation inside process.argv[1]. */
const ASAR_MARKER = '/resources/app.asar/';

let cachedBase;

/**
 * Absolute base URL that the host loader resolves bare package names against.
 *
 * The DSH runtime is launched as
 *   <executable> --expose-internals <...>/resources/app.asar/dsh/node_modules/...
 * so argv[1] contains the installation anchor. The returned URL points at a
 * nonexistent file inside the host's own node_modules tree; the loader only
 * needs its directory, and Node's resolver never stats the base itself.
 *
 * @returns the base URL, or undefined when this process is not a packaged DSH.
 */
export function hostBaseUrl() {
  if (cachedBase !== undefined) return cachedBase ?? undefined;
  cachedBase = null;
  const entry = typeof process.argv[1] === 'string' ? process.argv[1].split(String.fromCharCode(92)).join('/') : '';
  const at = entry.indexOf(ASAR_MARKER);
  if (at < 0) return undefined;
  const root = entry.slice(0, at + ASAR_MARKER.length - 1);
  cachedBase = pathToFileURL(root + '/dsh/node_modules/x/y.js').href;
  return cachedBase;
}

/** Host anchor shared by module imports and preset row resolution. */
function hostResolutionBase(ctx) {
  const loader = ctx?.loader;
  return loader?.config?.bareModuleBaseUrl ?? hostBaseUrl() ?? loader?.ctx?.baseUrl ?? loader?.config?.baseUrl;
}

/**
 * Import one module from the host's own module graph.
 *
 * @param ctx - a Cordis context that has `loader` in scope (declare
 *   `inject: ['loader']` on the plugin, or call this after the fiber started).
 * @param specifier - bare package name, optionally with a subpath.
 * @returns the host module namespace.
 * @throws when the host base is unknown or the specifier does not resolve.
 */
export async function hostImport(ctx, specifier) {
  const loader = ctx?.loader;
  // EntryTree imports against its owning context's baseUrl. Prefer that same
  // official anchor: it works for both CLI installs and packaged desktop hosts,
  // unlike argv, and does not resolve against this external preset's location.
  const base = hostResolutionBase(ctx);
  if (base === undefined || base === null) {
    throw new Error('oh-my-dsh-slim: the host loader exposes no module base URL; host module "' + specifier + '" cannot be resolved');
  }
  if (loader?.internal?.import === undefined) {
    throw new Error('oh-my-dsh-slim: the `loader` service is unavailable, so host module "' + specifier + '" cannot be resolved; add "loader" to this plugin\'s inject list');
  }
  return await loader.internal.import(specifier, base, {});
}

/**
 * Import one named export from a host module, with a readable failure.
 * @param ctx - context carrying the `loader` service.
 * @param specifier - bare package name, optionally with a subpath.
 * @param key - exported name to read.
 */
export async function hostExport(ctx, specifier, key) {
  const module = await hostImport(ctx, specifier);
  const value = module?.[key];
  if (value === undefined) {
    throw new Error('oh-my-dsh-slim: host module "' + specifier + '" does not export "' + key + '" on this DSH version');
  }
  return value;
}

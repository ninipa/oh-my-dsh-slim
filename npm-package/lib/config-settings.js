// DSH 0.2 settings are volatile Config fields on a profile entry, not namespaces
// registered by a service. Keep this module independent of preset/config.js.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
const factoryDefaults = JSON.parse(readFileSync(new URL('../preset/defaults.json', import.meta.url), 'utf8'));

export const SETTINGS_NS = 'oh-my-dsh-slim';
const readers = new Map();

/** Config is consumed before apply(), so there is no loader context yet.
 * Resolve from the running host entry rather than the external plugin's
 * node_modules. Electron's Node resolver supports its own app.asar paths.
 * When a host anchor exists, never silently use a profile-local stale copy. */
export async function loadHostSchema({ hostBase, entry = process.argv[1], resolve = (base, name) => createRequire(base).resolve(name), importModule = url => import(url) } = {}) {
  const base = hostBase ?? (entry ? pathToFileURL(entry).href : undefined);
  if (base !== undefined) {
    try {
      const path = resolve(base, '@deepseek-ai/schemastery');
      return (await importModule(pathToFileURL(path).href)).default;
    } catch { return undefined; }
  }
  try { return (await importModule('@deepseek-ai/schemastery')).default; } catch { return undefined; }
}

const isDocument = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Old documents and compact native documents share one editable form. */
export function buildConfigSchema(z) {
  const defaults = JSON.parse(readFileSync(new URL('../preset/defaults.json', import.meta.url), 'utf8'));
  const effort = () => z.string().pattern(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/);
  const role = () => z.object({
    enabled: z.boolean(), provider: z.string(), model: z.string(), effort: effort(),
    temperature: z.number().min(0).max(2), maxTokens: z.number().min(1).step(1),
    tools: z.array(z.string()), deny: z.array(z.string()), mcps: z.array(z.string()),
    personaAppend: z.string(),
  });
  const orchestrator = () => z.object({ effort: effort(), mcps: z.array(z.string()) });
  const preset = () => z.object({
    orchestrator: orchestrator(),
    ...Object.fromEntries(['oracle', 'designer', 'fixer', 'explorer', 'librarian', 'observer'].map(id => [id, role()])),
  });
  return z.object({
    preset: z.string().default(defaults.preset).volatile().description('Named role configuration within presets (not a native session preset).'),
    presets: z.dict(preset()).default(defaults.presets).volatile().description('Legacy named role configurations; existing JSON documents retain their shape.'),
    roles: z.dict(role()).volatile().description('Per-role overrides; compact roles override the selected presets entry.'),
    orchestrator: orchestrator().volatile(),
    mcpServers: z.dict(z.object({
      transport: z.union(['stdio', 'streamable-http']), url: z.string(), command: z.string(),
      args: z.array(z.string()), env: z.dict(z.string()),
    })).default(defaults.mcpServers).volatile().description('MCP connection definitions; role mcps lists choose which connections a role uses.'),
    advanced: z.object({ roles: z.dict(role()) }).volatile(),
    presetId: z.string(), verbose: z.boolean(),
  }).description('oh-my-dsh-slim bundled native preset configuration. Edits persist in the active DSH profile. Select the default preset in native Agent preset settings; named profiles persist in the companion profiles configuration row.');
}

function descriptor(settings) {
  return settings?.describe?.().find(row => row.ns === SETTINGS_NS);
}

/** Read current live values, never a cached snapshot. A host-free caller uses
 * the companion's lifecycle-owned reader; an explicit context never falls back
 * to another host's provider. Returned data is detached from host descriptors. */
export function readHostConfig(ctx) {
  const settings = ctx === undefined ? [...readers.values()].at(-1)?.() : (typeof ctx.get === 'function' ? ctx.get('settings') : ctx.settings);
  const entry = descriptor(settings);
  const value = entry?.value;
  if (!isDocument(value) || Object.keys(value).length === 0) return undefined;
  const userAuthored = isDocument(entry.user) && Object.keys(entry.user).length > 0;
  const document = Object.fromEntries(Object.entries(value).filter(([key, value]) => !['presetId', 'verbose'].includes(key) && value !== undefined));
  if (!userAuthored && isDeepStrictEqual(document, factoryDefaults)) return undefined;
  return structuredClone(value);
}

/** Import user intent only into an empty profile layer. The original JSON is
 * deliberately never renamed or deleted, including after successful import. */
export async function importLegacyConfig(settings, { path, validate, log = {} }) {
  const entry = descriptor(settings);
  if (!entry || typeof settings.update !== 'function' || !existsSync(path)) return false;
  if (isDocument(entry.user) && Object.keys(entry.user).length > 0) return false;
  try {
    const document = JSON.parse(readFileSync(path, 'utf8'));
    validate(document);
    await settings.update(SETTINGS_NS, document, entry.revision);
    log.info?.('oh-my-dsh-slim: imported legacy JSON into the active profile; original file preserved');
    return true;
  } catch (error) {
    log.warn?.(`oh-my-dsh-slim: legacy JSON import skipped; original file preserved (${error?.message ?? error})`);
    return false;
  }
}

/** Bind one settings provider and remove it when its injection scope retires. */
export function wireConfigSettings(ctx, { validate, log = ctx.logger, path } = {}) {
  ctx.inject(['settings'], child => {
    const token = {};
    child.effect(() => {
      readers.set(token, () => child.settings);
      return () => readers.delete(token);
    });
    // SettingsForms only describes active fibers. Wait until the owning entry
    // is active rather than trying to import during its own activation.
    let disposed = false;
    child.effect(() => () => { disposed = true; });
    const ready = child.root?.loader?.await?.() ?? Promise.resolve();
    Promise.resolve(ready).then(() => {
      if (disposed) return;
      return importLegacyConfig(child.settings, {
        path: path ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'oh-my-dsh-slim.json'),
        validate, log,
      });
    }).catch(error => log?.warn?.(`oh-my-dsh-slim: settings import unavailable (${error?.message ?? error})`));
  });
}

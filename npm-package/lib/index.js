// oh-my-dsh-slim — the bundle's companion row.
//
// DSH 0.2.0 replaced directory agent presets (a folder plus preset.yml under
// $DSH_HOME/.agent-presets) with declarative ones: a bundle patch inserts an
// `@deepseek-ai/dsh-agent-preset` row whose `config.plugins` IS the preset's
// plugin list. Everything this package ships is therefore declared in
// `preset/preset.js`, mounted by the loader before any session exists —
// there is nothing left to copy into DSH_HOME, and nothing to clean up on
// uninstall either.
//
// The companion reports registration and declares the native settings form.
// User-document fields are volatile: DSH persists edits into the active profile
// without remounting this row. A legacy JSON document may seed an empty user
// layer, but its original file is never modified. Named native profiles are
// authored through /omds and persisted by the separate nonvolatile registry row.
//
// Config (all optional, so the bundle row mounts with an empty config):
//   presetId: id to report. Default PRESET_ID.
//   verbose:  log the full per-role table on every boot. Default false.

import { homedir } from 'node:os';
import { join } from 'node:path';

import { assertHostCompatible } from './host-version.js';
import { registerProfileTransport } from './profile-transport.js';
import { advertisedRoles, roleIds } from '../preset/roles.js';
import { describeConfig, loadConfig, validateConfigDocument } from '../preset/config.js';
import { buildConfigSchema, loadHostSchema, wireConfigSettings } from './config-settings.js';
import { hostBaseUrl } from '../preset/bridge.js';
import { makeProfileEndpoints } from './profile-registry.js';
export { makeProfileEndpoints, normalizeDisplayName, profileIdForDisplayName } from './profile-registry.js';

// Config is read before a Cordis context exists. Reach the host's own schema
// instance through its Node resolution anchor, never a profile-local duplicate.
const schemastery = await loadHostSchema({ hostBase: hostBaseUrl() });
export const Config = schemastery ? buildConfigSchema(schemastery) : undefined;

export const name = 'omds-seeder';

const PRESET_ID = 'oh-my-dsh-slim';
const CONFIG_FILE_NAME = 'oh-my-dsh-slim.json';

/** Resolve DSH_HOME the way the host does, without importing host code. */
function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  return join(homedir(), '.dsh');
}

/**
 * Log one report line, preferring the row logger over stderr.
 */
function report(ctx, line) {
  ctx.logger?.info?.(line);
}

/**
 * Mount the bundle's companion row.
 * @param ctx - the row context (a profile-plane row, not a preset row).
 * @param config - optional row config as documented above.
 */
export function apply(ctx, config) {
  const verdict = assertHostCompatible({ ctx });
  wireConfigSettings(ctx, { validate: validateConfigDocument });
  ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)));
  ctx.inject(['loader', 'connection', 'webServer', 'agentPresets', 'configEditor', 'settings'], async child => {
    const endpoints = makeProfileEndpoints({ agentPresets: child.agentPresets, getSettings: () => child.settings, getEditor: () => child.configEditor });
    const methods = { 'profile-list': 'list', 'profile-create': 'create', 'profile-save': 'save', 'profile-set-default': 'setDefault', 'profile-migrate': 'migrate' };
    // Reuse the host RPC implementation, but explicitly own the route on the
    // child that injected webServer (not the connection provider's fiber).
    await registerProfileTransport(child, async (endpoint, payload, signal, peer) => {
      try {
        if (signal?.aborted) throw Object.assign(new Error('operation aborted'), { code: 'ABORT_ERR' });
        const method = methods[endpoint];
        if (!method) throw Object.assign(new Error('unknown /omds endpoint: ' + endpoint), { code: 'UNKNOWN_ENDPOINT' });
        return { ok: true, value: await endpoints[method](payload ?? {}) };
      } catch (error) { return { ok: false, error: { code: error?.code ?? 'PROFILE_FAILED', message: error?.message ?? String(error), details: {} } }; }
    });
  });
  if (!Config) ctx.logger?.warn?.('oh-my-dsh-slim: host schemastery could not be resolved; native configuration form unavailable, legacy JSON remains active');
  const presetId = typeof config?.presetId === 'string' && config.presetId.length > 0 ? config.presetId : PRESET_ID;
  const verbose = config?.verbose === true;
  report(ctx, `oh-my-dsh-slim: agent preset "${presetId}" is declared by this bundle (declarative preset; no directory is seeded)`);
  report(ctx, `oh-my-dsh-slim: host DSH ${verdict.host ?? 'unknown'} - ${verdict.status}`);
  const roles = roleIds();
  report(ctx, `oh-my-dsh-slim: ${String(roles.length)} role tools: ${advertisedRoles()}`);
  try {
    const config = loadConfig();
    report(ctx, `oh-my-dsh-slim: ${describeConfig(config)}`);
    if (verbose) {
      const file = process.env.OH_MY_DSH_SLIM_CONFIG ?? join(dshHome(), CONFIG_FILE_NAME);
      report(ctx, `oh-my-dsh-slim: configuration file would be ${file}`);
      for (const roleId of roles) {
        const role = config.roles?.[roleId];
        if (role === undefined) continue;
        const route = `${role.provider ?? '?'}/${role.model ?? '?'}`;
        report(ctx, `oh-my-dsh-slim:   ${roleId}: ${role.enabled === false ? 'disabled' : 'enabled'} ${route} effort=${role.effort ?? '(host default)'}`);
      }
    }
  } catch (error) {
    ctx.logger?.warn?.(`oh-my-dsh-slim: cannot read the configuration (${error instanceof Error ? error.message : String(error)}); the preset falls back to its shipped defaults`);
  }
}

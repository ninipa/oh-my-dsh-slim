// Named native presets, persisted solely through the host ConfigEditor.
import { createHash } from 'node:crypto';
import { validateConfigDocument } from '../preset/config.js';
import { resolvedDefinition } from '../preset/preset.js';
import { loadHostSchema } from './config-settings.js';
import { hostBaseUrl } from '../preset/bridge.js';

export const ENTRY_ID = 'oh-my-dsh-slim-profiles';
export const name = 'omds-profile-registry';
export const inject = ['agentPresets', 'loader', 'configEditor'];
const z = await loadHostSchema({ hostBase: hostBaseUrl() });
export const Config = z ? z.object({ profiles: z.dict(z.object({ displayName: z.string().required(), config: z.any().required() })).default({}) }) : undefined;
export function normalizeDisplayName(value) {
  if (typeof value !== 'string') throw new TypeError('profile display name must be a string');
  const name = value.trim();
  if (!name) throw new TypeError('profile display name must not be empty');
  if (name.length > 64) throw new RangeError('profile display name must be at most 64 characters');
  return name;
}
export function profileIdForDisplayName(value) {
  const name = normalizeDisplayName(value);
  const prefix = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 24) || 'profile';
  return `profile-${prefix}-${createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 12)}`;
}
export const revisionForConfig = config => createHash('sha256').update(JSON.stringify(config ?? {}, null, 2) + '\n').digest('hex').slice(0, 16);
export const profileError = (code, message) => Object.assign(new Error(message), { code });
export function namedDefinition(ctx, id, record) {
  const definition = resolvedDefinition(ctx);
  const consumers = new Set(['roles.js', 'role-mcp.js', 'subagent-roles.js']);
  const transform = rows => rows.map(row => ({ ...row,
    ...(consumers.has(row.name?.split('/').at(-1)) ? { config: { ...row.config, profileId: id } } : {}),
    ...(row.group && Array.isArray(row.config) ? { config: transform(row.config) } : {}),
  }));
  return { ...definition, id, name: record.displayName, plugins: transform(definition.plugins) };
}
export function apply(ctx, config = {}) {
  const profiles = structuredClone(config.profiles ?? {});
  for (const [id, record] of Object.entries(profiles)) {
    if (!id.startsWith('profile-')) throw profileError('PROFILE_UNSUPPORTED', 'custom profile id must start with profile-');
    normalizeDisplayName(record.displayName); validateConfigDocument(record.config);
  }
  // Host-owned service is reread by every consumer; no selected-id singleton.
  ctx.provide('omdsProfiles', { read: id => {
    const editor = ctx.get('configEditor');
    const entry = editor?.entries().find(entry => entry.options.id === ENTRY_ID);
    const live = entry ? (entry.options.config?.profiles ?? {}) : profiles;
    return live[id] === undefined ? undefined : structuredClone(live[id].config);
  } });
  ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)));
  ctx.effect(() => {
    let disposed = false;
    const releases = [];
    const ready = (async () => {
      try {
        for (const [id, record] of Object.entries(profiles)) {
          const release = await ctx.agentPresets.register(namedDefinition(ctx, id, record));
          if (disposed) await release(); else releases.push(release);
        }
        return releases;
      } catch (error) {
        await Promise.allSettled(releases.splice(0).map(release => release()));
        throw error;
      }
    })();
    return async () => { disposed = true; for (const release of await ready) if (release) await release(); };
  });
}

export function makeProfileEndpoints({ agentPresets, getSettings, getEditor }) {
  const editorEntry = () => {
    const editor = getEditor?.();
    const entry = editor?.entries().find(entry => entry.options.id === ENTRY_ID);
    if (!entry) throw profileError('PROFILE_SETTINGS_UNAVAILABLE', 'native profile configuration editor unavailable');
    return { editor, entry };
  };
  const records = () => structuredClone(editorEntry().entry.options.config?.profiles ?? {});
  const checkName = (profiles, name, except) => {
    for (const [id, record] of Object.entries(profiles)) if (id !== except && record.displayName.toLowerCase() === name.toLowerCase()) throw profileError('PROFILE_NAME_CONFLICT', `a profile named "${name}" already exists`);
  };
  const validate = config => { try { validateConfigDocument(config); } catch (error) { throw profileError('PROFILE_INVALID_CONFIG', `profile configuration rejected: ${error.message}`); } };
  return {
    async list() {
      const profiles = [{ id: 'oh-my-dsh-slim', displayName: '极简角色委派', kind: 'bundled', isDefaultForNewSessions: agentPresets.defaultId === 'oh-my-dsh-slim' }];
      for (const [id, record] of Object.entries(records())) profiles.push({ id, displayName: record.displayName, kind: 'custom', isDefaultForNewSessions: agentPresets.defaultId === id, revision: revisionForConfig(record.config), config: record.config, needsMigration: false });
      return { profiles, defaultProfileId: agentPresets.defaultId ?? 'oh-my-dsh-slim' };
    },
    async create({ displayName, config }) {
      const name = normalizeDisplayName(displayName), id = profileIdForDisplayName(name);
      validate(config);
      const { editor, entry } = editorEntry();
      await editor.edit(entry, current => {
        const profiles = { ...(current.profiles ?? {}) }; checkName(profiles, name);
        if (profiles[id]) throw profileError('PROFILE_NAME_CONFLICT', `profile "${id}" already exists`);
        profiles[id] = { displayName: name, config: structuredClone(config ?? {}) };
        return { ...current, profiles };
      });
      return { id, displayName: name, revision: revisionForConfig(config) };
    },
    async save({ id, config, expectedRevision, displayName }) {
      if (typeof expectedRevision !== 'string') throw profileError('PROFILE_CONFLICT', 'expectedRevision is required to save a profile');
      if (!id?.startsWith('profile-')) throw profileError('PROFILE_UNSUPPORTED', 'only custom profiles persist through /omds');
      validate(config);
      let finalName;
      const { editor, entry } = editorEntry();
      await editor.edit(entry, current => {
        const profiles = { ...(current.profiles ?? {}) }, existing = profiles[id];
        if (!existing) throw profileError('PROFILE_NOT_FOUND', `profile "${id}" does not exist`);
        if (revisionForConfig(existing.config) !== expectedRevision) throw profileError('PROFILE_CONFLICT', `profile "${id}" changed since it was loaded`);
        finalName = displayName === undefined ? existing.displayName : normalizeDisplayName(displayName);
        checkName(profiles, finalName, id);
        profiles[id] = { ...existing, displayName: finalName, config: structuredClone(config ?? {}) };
        return { ...current, profiles };
      });
      return { id, displayName: finalName, revision: revisionForConfig(config) };
    },
    async setDefault({ profileId }) {
      if (profileId !== 'oh-my-dsh-slim' && !records()[profileId]) throw profileError('PROFILE_NOT_FOUND', `profile "${profileId}" does not exist`);
      await agentPresets.resolve(profileId);
      const settings = getSettings?.();
      const descriptor = settings?.describe().find(row => row.ns === 'agent-preset-registry');
      if (!descriptor) throw profileError('PROFILE_SETTINGS_UNAVAILABLE', 'native preset settings unavailable');
      await settings.mutate('agent-preset-registry', [{ op: 'set', path: ['selectedDefault'], value: profileId }], descriptor.revision);
      return { profileId, isDefaultForNewSessions: true };
    },
    async migrate({ profileId }) {
      if (!records()[profileId]) throw profileError('PROFILE_NOT_FOUND', `profile "${profileId}" does not exist`);
      // Declarative compositions have no old persona text key to migrate.
      return { profileId, changed: false };
    },
  };
}

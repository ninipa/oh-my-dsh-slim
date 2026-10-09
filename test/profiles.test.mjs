import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProfileEndpoints, profileIdForDisplayName, revisionForConfig, namedDefinition } from '../npm-package/lib/profile-registry.js';
import { bindProfileContext, loadConfig } from '../npm-package/preset/config.js';
import { fitFilterToKnown, resolveRole } from '../npm-package/preset/roles.js';

function fixture() {
  const entry = { options: { id: 'oh-my-dsh-slim-profiles', config: { unrelated: { preserve: true }, profiles: {} } } };
  let lock = Promise.resolve();
  const editor = { entries: () => [entry], edit: (row, change) => {
    const operation = lock.then(() => { row.options.config = change(structuredClone(row.options.config)); });
    lock = operation.catch(() => {}); return operation;
  } };
  const registry = { defaultId: 'oh-my-dsh-slim', resolve: async id => ({ id }) };
  const settings = { describe: () => [{ ns: 'agent-preset-registry', revision: 'r1' }], mutate: async (ns, operations, revision) => { assert.equal(ns, 'agent-preset-registry'); assert.equal(revision, 'r1'); assert.deepEqual(operations[0].path, ['selectedDefault']); registry.defaultId = operations[0].value; } };
  const endpoints = makeProfileEndpoints({ agentPresets: registry, getEditor: () => editor, getSettings: () => settings });
  const context = id => { const ctx = { get: key => key === 'omdsProfiles' ? { read: id => entry.options.config.profiles[id]?.config } : undefined }; bindProfileContext(ctx, id); return ctx; };
  return { entry, endpoints, context, registry };
}

test('profile ids preserve upstream normalized deterministic slug/hash', () => {
  assert.equal(profileIdForDisplayName(' Café '), profileIdForDisplayName('Café'));
  assert.match(profileIdForDisplayName('Café'), /^profile-cafe-[a-f0-9]{12}$/);
  assert.notEqual(profileIdForDisplayName('Café'), profileIdForDisplayName('Cafe'));
});
test('profile authoring preserves unrelated row fields and locked conflicts', async () => {
  const { entry, endpoints } = fixture();
  const first = await endpoints.create({ displayName: 'Example', config: {} });
  const results = await Promise.allSettled([
    endpoints.save({ id: first.id, expectedRevision: first.revision, config: { roles: { oracle: { model: 'a' } } } }),
    endpoints.save({ id: first.id, expectedRevision: first.revision, config: { roles: { oracle: { model: 'b' } } } }),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'PROFILE_CONFLICT');
  assert.deepEqual(entry.options.config.unrelated, { preserve: true });
  assert.equal((await endpoints.list()).profiles.find(row => row.id === first.id).revision, revisionForConfig(entry.options.config.profiles[first.id].config));
  await assert.rejects(endpoints.create({ displayName: 'example', config: {} }), error => error.code === 'PROFILE_NAME_CONFLICT');
});
test('two existing contexts remain profile-isolated and observe live saves', async () => {
  const { endpoints, context } = fixture();
  const a = await endpoints.create({ displayName: 'A', config: { roles: { oracle: { model: 'one' } } } });
  const b = await endpoints.create({ displayName: 'B', config: {} });
  const aCtx = context(a.id), bCtx = context(b.id);
  assert.equal(loadConfig(aCtx).roles.oracle.model, 'one');
  assert.notEqual(loadConfig(bCtx).roles.oracle.model, 'one');
  await endpoints.save({ id: a.id, expectedRevision: a.revision, config: { roles: { oracle: { model: 'new' } } } });
  assert.equal(loadConfig(aCtx).roles.oracle.model, 'new');
  assert.notEqual(loadConfig(bCtx).roles.oracle.model, 'new');
});
test('native default uses selectedDefault mutation revision', async () => {
  const { endpoints, registry } = fixture();
  const a = await endpoints.create({ displayName: 'Default', config: {} });
  await endpoints.setDefault({ profileId: a.id });
  assert.equal(registry.defaultId, a.id);
  assert.equal((await endpoints.list()).defaultProfileId, a.id);
});
test('none does not reach stock child preflight and restrictions exclude unknown/local names', async () => {
  const { endpoints, context } = fixture();
  const a = await endpoints.create({ displayName: 'None', config: { roles: { oracle: { effort: 'none' } } } });
  const role = resolveRole({ definition: { roleId: 'oracle' } }, context(a.id));
  assert.equal(role.agentOptions.reasoningEffort, undefined);
  assert.deepEqual(fitFilterToKnown({ allow: ['read', 'local'], deny: ['skill', 'ask_user_question', 'write'] }, ['read', 'write']), { allow: ['read'], deny: ['write'] });
});
test('named composition identity reaches all config consumers only', () => {
  const definition = namedDefinition({}, 'profile-test', { displayName: 'Test', config: {} });
  const rows = definition.plugins.flatMap(row => row.group ? row.config : [row]);
  const consumers = rows.filter(row => /(?:roles|role-mcp|subagent-roles)\.js$/.test(row.name ?? ''));
  assert.ok(consumers.length > 0);
  for (const row of consumers) assert.equal(row.config.profileId, 'profile-test');
});

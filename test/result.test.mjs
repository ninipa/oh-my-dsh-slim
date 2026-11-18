import test from 'node:test';
import assert from 'node:assert/strict';
import { latestOwnAssistant, resolveSubagentTarget } from '../npm-package/preset/subagent-result.js';
import { childIdForName } from '../npm-package/preset/child-catalog.js';
const message = (seq, text) => ({ seq, type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } });
test('fork result retains upstream full-surface scan including inherited messages', () => {
  assert.deepEqual(latestOwnAssistant({ events: [message(0, 'parent')], inheritedEventCount: 1 }), { kind: 'result', seq: 0, text: 'parent' });
});
test('latest own nonempty assistant message is returned', () => {
  assert.deepEqual(latestOwnAssistant({ events: [message(0, 'parent'), message(1, 'child'), message(2, '')], inheritedEventCount: 1 }), { kind: 'result', seq: 1, text: 'child' });
});

test('subagent target passes a session id through without a lookup', async () => {
  let lookups = 0;
  const ctx = { subagents: { resolveName: async () => { lookups++; return 'other'; } } };
  const id = '11111111-2222-3333-4444-555555555555';
  assert.equal(await resolveSubagentTarget(ctx, { id: 'parent' }, id, undefined), id);
  assert.equal(lookups, 0);
});

test('subagent target resolves a model-facing agent name through the host', async () => {
  const calls = [];
  const ctx = { subagents: { resolveName: async (caller, name, signal) => { calls.push({ caller, name, signal }); return '11111111-2222-3333-4444-555555555555'; } } };
  const parent = { id: 'parent' };
  assert.equal(await resolveSubagentTarget(ctx, parent, 'agent-1', 'signal'), '11111111-2222-3333-4444-555555555555');
  assert.deepEqual(calls, [{ caller: parent, name: 'agent-1', signal: 'signal' }]);
});

test('subagent target keeps the input on hosts without resolveName', async () => {
  assert.equal(await resolveSubagentTarget({ subagents: {} }, { id: 'parent' }, 'agent-1', undefined), 'agent-1');
  assert.equal(await resolveSubagentTarget({}, { id: 'parent' }, 'agent-1', undefined), 'agent-1');
});

const catalogEvent = (childId, name) => ({ type: 'subagent/catalog', data: { version: 3, childId, name, label: 'role · task' } });
const catalogAgent = events => ({ session: { ownEvents: () => events } });

test('child catalog maps a recorded name to the child id without a service', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const agent = catalogAgent([catalogEvent('other-id', 'agent-1'), catalogEvent(id, 'agent-2')]);
  assert.equal(childIdForName(agent, 'agent-2'), id);
  assert.equal(childIdForName(agent, 'agent-9'), undefined);
  assert.equal(childIdForName({ session: { ownEvents: () => [] } }, 'agent-2'), undefined);
  assert.equal(childIdForName(undefined, 'agent-2'), undefined);
});

test('subagent target prefers the parent catalog over resolveName', async () => {
  const id = '11111111-2222-3333-4444-555555555555';
  let lookups = 0;
  const ctx = { subagents: { resolveName: async () => { lookups++; return 'other'; } } };
  assert.equal(await resolveSubagentTarget(ctx, catalogAgent([catalogEvent(id, 'agent-1')]), 'agent-1', undefined), id);
  assert.equal(lookups, 0);
});

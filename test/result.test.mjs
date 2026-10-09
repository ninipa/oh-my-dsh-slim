import test from 'node:test';
import assert from 'node:assert/strict';
import { latestOwnAssistant } from '../npm-package/preset/subagent-result.js';
const message = (seq, text) => ({ seq, type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } });
test('fork result retains upstream full-surface scan including inherited messages', () => {
  assert.deepEqual(latestOwnAssistant({ events: [message(0, 'parent')], inheritedEventCount: 1 }), { kind: 'result', seq: 0, text: 'parent' });
});
test('latest own nonempty assistant message is returned', () => {
  assert.deepEqual(latestOwnAssistant({ events: [message(0, 'parent'), message(1, 'child'), message(2, '')], inheritedEventCount: 1 }), { kind: 'result', seq: 1, text: 'child' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readHostConfig } from '../npm-package/lib/config-settings.js';
const defaults = JSON.parse(readFileSync(new URL('../npm-package/preset/defaults.json', import.meta.url)));
test('factory-only native form does not mask legacy fallback', () => {
 const ctx = { get: () => ({ describe: () => [{ ns: 'oh-my-dsh-slim', user: {}, value: structuredClone(defaults) }] }) };
 assert.equal(readHostConfig(ctx), undefined);
});
test('explicit native row overrides retain priority over legacy', () => {
 const value = structuredClone(defaults); value.presets[value.preset].oracle.model = 'native-row';
 const ctx = { get: () => ({ describe: () => [{ ns: 'oh-my-dsh-slim', user: {}, value }] }) };
 assert.equal(readHostConfig(ctx).presets[value.preset].oracle.model, 'native-row');
});
test('authored native user document remains active even factory-equal', () => {
 const ctx = { get: () => ({ describe: () => [{ ns: 'oh-my-dsh-slim', user: structuredClone(defaults), value: structuredClone(defaults) }] }) };
 assert.deepEqual(readHostConfig(ctx), defaults);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../npm-package/preset/preset.js';

function fixture(register) {
  let cleanup;
  apply({ agentPresets: { register }, logger: { info() {}, warn() {} },
    effect(setup) { cleanup = setup(); } });
  return () => cleanup();
}

test('preset registration releases completed registration on unmount', async () => {
  let released = 0;
  const cleanup = fixture(async () => async () => { released++; });
  await Promise.resolve();
  await cleanup();
  assert.equal(released, 1);
});

test('preset registration releases registration completing after unmount', async () => {
  let resolve;
  let released = 0;
  const cleanup = fixture(() => new Promise(r => { resolve = r; }));
  const pending = cleanup();
  resolve(async () => { released++; });
  await pending;
  assert.equal(released, 1);
});

test('failed registration cleanup does not invent a disposer', async () => {
  const cleanup = fixture(async () => { throw new Error('mount rejected'); });
  await assert.doesNotReject(cleanup);
});

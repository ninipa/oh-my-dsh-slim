import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Original blobs from upstream 1a29e706710b0a967021fa963ba607b0e683029e.
// The existing legacy/v0.5.3 archive preserves docs/scripts, not these sources.
// Pin identities here, independently of the fixtures, so shallow checkouts and
// source tarballs retain the exact baseline without invoking Git at test time.
const blobs = Object.freeze({
  'agent.cordis.yml': 'e12492f8ab2a17718fb8a3cca7c95dd8d06e112c',
  'preset.yml': 'c46793646d115a14b93a47801ab6b5165356a7be',
  'defaults.json': '399fcf8a64cd2e4e5ade95b1296514b0be3134ea',
  'config-loader.js': 'f26bdc199410eca364423035d1cab280ee9c7921',
  'role-subagent.js': 'f81ae913b2dc2c9235f84021581461df60e9604e',
});

export function upstream(name) {
  assert.ok(Object.hasOwn(blobs, name), 'known upstream baseline file: ' + name);
  const bytes = readFileSync(new URL('fixtures/upstream-v0.5.3/' + name, import.meta.url));
  // Verify raw bytes before decoding or any caller's newline normalization.
  const actual = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  assert.equal(actual, blobs[name], 'immutable upstream Git blob: ' + name);
  return bytes.toString('utf8');
}

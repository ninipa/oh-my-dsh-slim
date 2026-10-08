import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const directory = fileURLToPath(new URL('../legacy/v0.5.3/', import.meta.url));
test('all 98 archived upstream files retain their original Git blob identity', () => {
  const manifest = readFileSync(join(directory, 'MANIFEST.git-blob.txt'), 'utf8');
  let count = 0;
  for (const line of manifest.split(/\r?\n/)) {
    const match = /^([0-9a-f]{40})\s+(.+)$/.exec(line);
    if (!match) continue;
    const [, expected, relative] = match;
    assert.ok(!relative.split(/[\\/]/).includes('..'), 'archive path is bounded');
    const bytes = readFileSync(join(directory, relative));
    const actual = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    assert.equal(actual, expected, relative);
    count++;
  }
  assert.equal(count, 98, 'archive inventory cannot silently shrink');
});

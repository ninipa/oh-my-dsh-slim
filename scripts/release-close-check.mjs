#!/usr/bin/env node
// Release close-out check (RELEASE.md stage 5.1).
//
// The dev workspace is part of a release, but nothing else notices when it is
// forgotten: the repo has no remote and no CI, so an uncommitted release looks
// exactly like a finished one. 0.8.5 through 0.8.8 shipped that way and HEAD
// stayed on v0.8.4 for four releases. Run this after the dev commit; it fails
// until the tree is clean and HEAD names the shipped version.
//
// Zero network, zero model calls — it only reads package.json and git.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

let failures = 0;
const check = (ok, message) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
};

const dirty = git('status', '--porcelain');
const dirtyPaths = dirty === '' ? [] : dirty.split('\n');
check(dirtyPaths.length === 0,
  dirtyPaths.length === 0
    ? 'dev working tree is clean (nothing uncommitted left behind)'
    : `dev working tree is clean — ${dirtyPaths.length} path(s) pending, commit them:\n` +
      dirtyPaths.slice(0, 12).map((line) => `          ${line}`).join('\n'));

const subject = git('log', '-1', '--pretty=%s');
const body = git('log', '-1', '--pretty=%b');
check(subject.includes(`v${version}`) || body.includes(`v${version}`),
  `HEAD names v${version} — "${subject}"`);

// A release that only bumped the docs and never committed the client change is
// the failure mode this guard exists for: package.json moved, HEAD did not.
const committedVersion = (() => {
  try {
    return JSON.parse(git('show', 'HEAD:package.json')).version;
  } catch {
    return undefined;
  }
})();
check(committedVersion === version,
  `HEAD:package.json is ${version} (found ${committedVersion ?? 'nothing'})`);

console.log(failures === 0
  ? '\nRELEASE CLOSE: OK — dev repo carries this release'
  : `\nRELEASE CLOSE: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

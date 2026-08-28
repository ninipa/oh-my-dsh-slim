// T0-adjacent unit test for sandbox-strip.js pure helpers.
// Usage: node scripts/test-sandbox-strip.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDelegatedChild, stripEscalationArgs, STRIP_NOTE } from '../sandbox-strip.js';

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };

console.log('\n[sandbox-strip] delegated-child identification');
if (isDelegatedChild({ options: { dshRoleId: 'fixer' } })) pass('role child identified by dshRoleId');
else fail('role child not identified');
if (isDelegatedChild({ options: { dshRoleId: 'fixer', model: 'x' } })) pass('child identified with extra options');
else fail('child not identified with extra options');
if (!isDelegatedChild(undefined)) pass('undefined agent not stripped');
else fail('undefined agent stripped');
if (!isDelegatedChild({ options: {} })) pass('top-level agent (no dshRoleId) not stripped');
else fail('top-level agent stripped');
if (!isDelegatedChild({ options: { dshRoleId: 42 } })) pass('non-string dshRoleId not treated as role child');
else fail('non-string dshRoleId treated as role child');

console.log('\n[sandbox-strip] argument stripping');
const withBoth = { command: 'ls', sandbox_permissions: 'workspace-write', justification: '' };
const stripped = stripEscalationArgs(withBoth);
if (!('sandbox_permissions' in stripped) && !('justification' in stripped) && stripped.command === 'ls') pass('both fields removed, command kept');
else fail('fields not removed correctly');
if (Object.keys(stripped).length === 1) pass('no leftover keys');
else fail(`leftover keys: ${Object.keys(stripped).join(',')}`);
const clean = { command: 'ls' };
if (stripEscalationArgs(clean) === clean) pass('clean args returned by reference (no copy)');
else fail('clean args copied');
if (stripEscalationArgs(null) === null && stripEscalationArgs(undefined) === undefined) pass('null/undefined passthrough');
else fail('null/undefined not passthrough');
if (stripEscalationArgs('nope') === 'nope') pass('non-object passthrough');
else fail('non-object not passthrough');
if ('sandbox_permissions' in withBoth && 'justification' in withBoth) pass('original object untouched (copy semantics)');
else fail('original mutated');

console.log('\n[sandbox-strip] edge shapes (matrix U1-U6)');
// U1: justification only -> both stripped
const justOnly = stripEscalationArgs({ command: 'ls', justification: '' });
if (!('justification' in justOnly) && !('sandbox_permissions' in justOnly) && justOnly.command === 'ls') pass('U1 justification-only stripped, both fields removed');
else fail('U1 justification-only handling wrong');
// U2: sandbox_permissions only -> both stripped
const permOnly = stripEscalationArgs({ command: 'ls', sandbox_permissions: 'workspace-write' });
if (!('sandbox_permissions' in permOnly) && !('justification' in permOnly) && permOnly.command === 'ls') pass('U2 permissions-only stripped, both fields removed');
else fail('U2 permissions-only handling wrong');
// U3: deep-frozen input must not throw and must not be mutated
const frozen = Object.freeze({ command: 'ls', sandbox_permissions: 'workspace-write', justification: '' });
let frozenOut;
let frozenThrew = false;
try { frozenOut = stripEscalationArgs(frozen); } catch { frozenThrew = true; }
if (!frozenThrew && frozenOut !== frozen && !('sandbox_permissions' in frozenOut)) pass('U3 frozen input stripped without throwing');
else fail('U3 frozen input handling wrong');
// U4: unrelated fields (incl. nested objects) survive verbatim
const withNested = { command: 'ls', workdir: '/a/b', meta: { nested: [1, 2, { x: true }] }, justification: 'why', sandbox_permissions: 'danger-full-access' };
const nestedOut = stripEscalationArgs(withNested);
if (JSON.stringify(nestedOut.meta) === JSON.stringify(withNested.meta) && nestedOut.workdir === '/a/b' && !('justification' in nestedOut)) pass('U4 unrelated fields and nested values preserved');
else fail('U4 nested preservation wrong');
// U5: empty object -> same reference
const empty = {};
if (stripEscalationArgs(empty) === empty) pass('U5 empty object returned by reference');
else fail('U5 empty object copied');
// U6: extra host fields (run_in_background/timeoutMs) kept, only the pair removed
const withExtra = { command: 'ls', run_in_background: true, timeoutMs: 10000, sandbox_permissions: 'workspace-write', justification: '' };
const extraOut = stripEscalationArgs(withExtra);
if (extraOut.run_in_background === true && extraOut.timeoutMs === 10000 && !('sandbox_permissions' in extraOut) && !('justification' in extraOut)) pass('U6 host fields kept, only escalation pair removed');
else fail('U6 host field preservation wrong');

console.log('\n[sandbox-strip] plugin surface');
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'sandbox-strip.js'), 'utf8');
if (/tools\/pre-execute/.test(src) && /exec\.arguments =/.test(src)) pass('pre-execute replaces exec.arguments');
else fail('pre-execute replacement missing');
if (/tools\/post-execute/.test(src) && /STRIP_NOTE/.test(src)) pass('post-execute note wiring present');
else fail('post-execute note wiring missing');
if (typeof STRIP_NOTE === 'string' && STRIP_NOTE.length > 40) pass('STRIP_NOTE exported');
else fail('STRIP_NOTE missing or too short');

console.log(failures === 0 ? '\nSANDBOX-STRIP: ALL CHECKS PASSED' : `\nSANDBOX-STRIP: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditHostRows } from '../scripts/audit-host-rows.mjs';

// A controlled reference host: the audit is the guard that would have caught
// 0.6.0-0.6.2 shipping tool-web fetch:false (see scripts/audit-host-rows.mjs),
// so it needs a failing case of its own, not only a green run.
function fixtureHost({ toolWebFetch = 'true', planSection = null, interrupt = undefined } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omds-host-rows-'));
  const base = join(dir, '@deepseek-ai', 'dsh-base');
  const web = join(dir, '@deepseek-ai', 'dsh-web-app');
  mkdirSync(base, { recursive: true });
  mkdirSync(web, { recursive: true });
  const section = planSection ?? ['        section: |', '              Fixture plan text.', '', '              Second paragraph.', ''];
  const baseRows = [
    '- insert:',
    '    - id: tool-web',
    "      name: '@deepseek-ai/dsh-tool-web'",
    '      config:',
    `        fetch: ${toolWebFetch}`,
    '        searchTimeoutMs: 60000',
    '    - id: plan-mode',
    "      name: '@deepseek-ai/dsh-plan-mode'",
    '      config:',
    ...section,
    '    - id: tool-ralph',
    "      name: '@deepseek-ai/dsh-tool-ralph'",
    '      disabled: true',
    '    - id: tool-plugin-manager',
    "      name: '@deepseek-ai/dsh-plugin-manager/tools'",
    '      disabled: true',
    ...interrupt === undefined ? [] : [
      '    - id: tool-subagent-control',
      "      name: '@deepseek-ai/dsh-tool-subagent-control'",
      '      config:',
      `        interrupt: ${interrupt}`,
    ],
    ...['command-goal', 'skill-filesystem', 'tool-skill', 'tool-subagent', 'tool-subagent-fork', 'tool-workflow', 'workflow-ptc']
      .flatMap(id => [`    - id: ${id}`, `      name: '@deepseek-ai/${id}'`]),
  ].join('\n');
  const webRows = [
    ...['tool-web', 'plan-mode', 'tool-ralph', 'tool-plugin-manager', 'command-goal', 'skill-filesystem',
      'tool-skill', 'tool-subagent', 'tool-subagent-fork', 'tool-workflow', 'workflow-ptc']
      .flatMap(id => [`- id: ${id}`, '  disabled: true']),
  ].join('\n');
  writeFileSync(join(base, 'cordis.patch.yml'), baseRows + '\n');
  writeFileSync(join(web, 'cordis.patch.yml'), webRows + '\n');
  return dir;
}

test('host-row audit passes when the preset tracks the host it declares', (t) => {
  const dir = fixtureHost();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = auditHostRows({ referenceDir: dir });
  assert.deepEqual(result.failures, []);
  assert.ok(result.notes.some(note => note.includes('inherited plan-mode section matches')));
});

test('host-row audit fails on a preset value the host base contradicts', (t) => {
  const dir = fixtureHost({ toolWebFetch: 'false' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = auditHostRows({ referenceDir: dir });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /^tool-web: preset config \{"fetch":true,/);
  assert.match(result.failures[0], /differs from host base \{"fetch":false,/);
});

test('host-row audit fails when the host stops shipping the inherited plan-mode block', (t) => {
  const dir = fixtureHost({ planSection: ['        section: "inline text"'] });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = auditHostRows({ referenceDir: dir });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /plan-mode: parsePlanSection\(\) no longer reproduces the host base value/);
});

test('host-row audit accepts the preset interrupt:true divergence only while the host declares it off', (t) => {
  const off = fixtureHost({ interrupt: 'false' });
  t.after(() => rmSync(off, { recursive: true, force: true }));
  const accepted = auditHostRows({ referenceDir: off });
  assert.deepEqual(accepted.failures, []);
  assert.ok(accepted.notes.some(note => note.includes('tool-subagent-control (listed divergence)')));

  const on = fixtureHost({ interrupt: 'true' });
  t.after(() => rmSync(on, { recursive: true, force: true }));
  const stale = auditHostRows({ referenceDir: on });
  assert.equal(stale.failures.length, 1);
  assert.match(stale.failures[0], /tool-subagent-control: listed in DIVERGENCES but there is no live divergence/);
});

test('host-row audit skips loudly without a reference host', () => {
  const result = auditHostRows({});
  assert.equal(typeof result.skipped, 'string');
  assert.deepEqual(result.failures, undefined);
});

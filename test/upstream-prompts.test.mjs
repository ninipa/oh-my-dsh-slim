import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { plugins, definition } from '../npm-package/preset/preset.js';
import { ROLE_TABLE, composeRolePersona, patchedContext, resolveRole } from '../npm-package/preset/roles.js';
import { roleDescription } from '../npm-package/preset/role-wording.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Read the immutable upstream source, never the fork's current copy. Keeping
// this independent of fixture generation prevents accidentally blessing edits.
const upstreamCommit = '1a29e706710b0a967021fa963ba607b0e683029e';
const root = fileURLToPath(new URL('../', import.meta.url));
const upstreamYaml = execFileSync('git', ['show', upstreamCommit + ':agent.cordis.yml'], {
  cwd: root, encoding: 'utf8',
});
const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar', construct: expression => ({ __jsExpr: expression }),
}));
const upstream = yaml.load(upstreamYaml, { schema });
const flatten = rows => rows.flatMap(row => [row, ...(row.group ? flatten(row.config) : [])]);
const current = flatten(plugins);
const row = id => current.find(entry => entry.id === id);
const original = id => upstream.find(entry => entry.id === id);

test('preset metadata exactly matches the upstream preset declaration', () => {
  const metadata = yaml.load(execFileSync('git', ['show', upstreamCommit + ':preset.yml'], {
    cwd: root, encoding: 'utf8',
  }));
  for (const field of ['name', 'description', 'order']) assert.equal(definition[field], metadata[field]);
});

test('native model-facing tool composition matches upstream without optional new tools', () => {
  const isNative = entry => entry.name.startsWith('@deepseek-ai/');
  const normalized = rows => flatten(rows).filter(isNative).map(entry => ({
    id: entry.id, name: entry.name,
    ...(entry.disabled === undefined ? {} : { disabled: entry.disabled }),
    // Persona is checked separately: only its platform-shell suffix is added.
    ...(entry.id === 'persona' || entry.config === undefined ? {} : { config: entry.config }),
  })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(normalized(plugins), normalized(upstream));
  assert.deepEqual(row('tool-web').config, { fetch: false, searchTimeoutMs: 60000 });
  for (const id of ['skill-filesystem', 'tool-skill', 'command-goal', 'present', 'tool-plugin-manager', 'tool-subagent-fork']) {
    assert.equal(row(id), undefined, 'not an upstream tool: ' + id);
  }
  assert.deepEqual(row('tool-bash').disabled, original('tool-bash').disabled);
  assert.deepEqual(row('tool-pwsh').disabled, original('tool-pwsh').disabled);
  assert.deepEqual(row('planning').isolate, original('planning').isolate);
  assert.deepEqual(row('compaction').isolate, original('compaction').isolate);
  assert.deepEqual(row('delegation').isolate, { workflowEngine: true });
});

test('main persona is the exact upstream 0.5.3 text, not a summary', () => {
  assert.equal(row('persona').config.prefix, original('persona').config.prefix);
  assert.equal(row('persona').config.suffix,
    'On Windows, references to bash/Bash above mean the native pwsh tool; elsewhere they mean bash.');
});

for (const roleId of Object.keys(ROLE_TABLE)) {
  test(roleId + ' persona and role description exactly match upstream', () => {
    const id = 'tool-subagent-' + roleId;
    const body = row(id).config.definition.persona;
    assert.equal(body, original(id).config.persona);
    assert.equal(ROLE_TABLE[roleId].description, original(id).config.description);
    assert.equal(composeRolePersona(roleId, body, 'user append'),
      'Internal role id: oh-my-dsh-slim-role:' + roleId + '.\n\n' + original(id).config.persona + '\n\nuser append');
    assert.equal(row(id).config.provider, 'spawn');
    assert.equal(row(id).config.backgroundMode, 'continuable');
    assert.equal(row(id).config.maxDepth, 1);
  });
}

test('user role route and persona append precede row agent options without changing the role body', () => {
  const directory = mkdtempSync(join(tmpdir(), 'omds-upstream-prompts-'));
  const file = join(directory, 'config.json');
  const previous = process.env.OH_MY_DSH_SLIM_CONFIG;
  try {
    writeFileSync(file, JSON.stringify({ roles: { fixer: {
      provider: 'user-provider', model: 'user-model', maxTokens: 1234, personaAppend: 'User appendix.',
    } } }));
    process.env.OH_MY_DSH_SLIM_CONFIG = file;
    const resolved = resolveRole({ ...row('tool-subagent-fixer').config,
      agentOptions: { provider: 'row-provider', model: 'row-model', maxTokens: 9876 },
    });
    assert.equal(resolved.agentOptions.provider, 'user-provider');
    assert.equal(resolved.agentOptions.model, 'user-model');
    assert.equal(resolved.agentOptions.maxTokens, 1234);
    assert.equal(resolved.persona, 'Internal role id: oh-my-dsh-slim-role:fixer.\n\n' +
      original('tool-subagent-fixer').config.persona + '\n\nUser appendix.');
  } finally {
    if (previous === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
    else process.env.OH_MY_DSH_SLIM_CONFIG = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('plan-mode section preserves upstream text including its terminal newline', () => {
  assert.equal(row('plan-mode').config.section, original('planning').config[0].config.section);
});

test('observer optional advertisement preserves original text without advertising an unmounted role', () => {
  assert.equal(row('tool-subagent-observer').config.definition.advertisement,
    original('tool-subagent-observer').config.advertisement);
  assert.equal(row('tool-subagent-observer').disabled, true);
  assert.ok(!row('persona').config.prefix.includes('@observer'));
});

test('role tool uses historical provider-first description rather than the host shortened policy', () => {
  let registered;
  const nativeDescription = 'Native rc.2 lifecycle and routing instructions.';
  const ctx = { tools: { register: definition => { registered = definition; } } };
  const seen = {};
  const role = ROLE_TABLE.fixer;
  patchedContext(ctx, seen, { toolName: role.toolName, description: role.description }).tools.register({
    name: role.toolName, description: nativeDescription,
  });
  assert.equal(registered.description, roleDescription({ description: original('tool-subagent-fixer').config.description }));
  assert.equal(seen.patched, true);
});

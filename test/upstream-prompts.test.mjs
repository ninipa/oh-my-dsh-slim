import assert from 'node:assert/strict';
import test from 'node:test';
import { upstream as readUpstream } from './upstream-baseline.mjs';
import yaml from 'js-yaml';
import { plugins, definition, parsePlanSection } from '../npm-package/preset/preset.js';
import { ROLE_TABLE, composeRolePersona, patchedContext, resolveRole } from '../npm-package/preset/roles.js';
import { UPSTREAM_ROLE_IDS } from '../npm-package/preset/role-ids.js';
import { roleDescription } from '../npm-package/preset/role-wording.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Read the byte-verified immutable upstream source, never the fork's current copy.
const upstreamYaml = readUpstream('agent.cordis.yml');
const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar', construct: expression => ({ __jsExpr: expression }),
}));
const upstream = yaml.load(upstreamYaml, { schema });
const flatten = rows => rows.flatMap(row => [row, ...(row.group ? flatten(row.config) : [])]);
const current = flatten(plugins);
const row = id => current.find(entry => entry.id === id);
const original = id => upstream.find(entry => entry.id === id);

test('preset metadata exactly matches the upstream preset declaration', () => {
  const metadata = yaml.load(readUpstream('preset.yml'));
  for (const field of ['name', 'description', 'order']) assert.equal(definition[field], metadata[field]);
});

test('native model-facing tool composition matches upstream without optional new tools', () => {
  const isNative = entry => entry.name.startsWith('@deepseek-ai/');
  // Persona is asserted separately (only its platform-shell suffix is added).
  // tool-web is asserted separately too: its fetch value deliberately differs
  // from the upstream text, see the assertion below.
  const separatelyAsserted = new Set(['persona', 'tool-web']);
  const normalized = rows => flatten(rows).filter(isNative).map(entry => ({
    id: entry.id, name: entry.name,
    ...(entry.disabled === undefined ? {} : { disabled: entry.disabled }),
    ...(separatelyAsserted.has(entry.id) || entry.config === undefined ? {} : { config: entry.config }),
  })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(normalized(plugins), normalized(upstream));
  // Upstream 0.5.3 carried fetch:false, but that declaration was inert on that
  // host: the host plane's own tool-web row (fetch:true) won, and production ran
  // with web_fetch (measured 18 -> 2 web_search calls per librarian run). A
  // declarative preset row is a definition, not a patch, so the same value now
  // disables web_fetch outright in web mode. Keep the effective 0.5.3 behavior,
  // not the dead declaration.
  assert.deepEqual(row('tool-web').config, { fetch: true, searchTimeoutMs: 60000 });
  for (const id of ['skill-filesystem', 'tool-skill', 'command-goal', 'present', 'tool-plugin-manager', 'tool-subagent-fork']) {
    assert.equal(row(id), undefined, 'not an upstream tool: ' + id);
  }
  assert.deepEqual(row('tool-bash').disabled, original('tool-bash').disabled);
  assert.deepEqual(row('tool-pwsh').disabled, original('tool-pwsh').disabled);
  assert.deepEqual(row('planning').isolate, original('planning').isolate);
  assert.deepEqual(row('compaction').isolate, original('compaction').isolate);
  assert.deepEqual(row('delegation').isolate, { workflowEngine: true });
});

test('main persona follows the 0.2.1 prompt contract, not the 0.5.3 cwd opener', () => {
  // Deliberate override (0.7.0): 0.2.1 removed the `run_in_background`
  // parameter, so the shared prompt describes the behavior instead of naming an
  // argument the tool no longer exposes. 0.2.1 also interpolates prompt text
  // strictly and registers only `provider` and `model`, so the 0.5.3 opener's
  // `{{cwd}}` would abort every turn there; the host now delivers the working
  // directory as required context instead. Everything else stays byte-identical.
  const upstream = original('persona').config.prefix;
  const upstreamOpener =
    'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.';
  const hostOpener = 'You are a coding agent powered by the {{model}} model.';
  const withParameter =
    'Pass run_in_background: false only when the user explicitly asked to wait in place (e.g. "directly wait for it") and you have exactly this one item — a foreground run LOCKS this conversation until the child returns and makes the child one-shot (no send_message follow-up, no carried context).';
  const withoutParameter =
    'Wait in place only when the user explicitly asked to wait (e.g. "directly wait for it") and you have exactly this one item; when the tool offers a foreground/one-shot choice, that run LOCKS this conversation until the child returns and makes the child one-shot (no send_message follow-up, no carried context).';
  assert.ok(upstream.startsWith(upstreamOpener), 'upstream opener moved; update the documented override');
  assert.ok(upstream.includes(withParameter), 'upstream sentence moved; update the documented override');
  assert.equal(row('persona').config.prefix,
    upstream.replace(upstreamOpener, hostOpener).replace(withParameter, withoutParameter));
  assert.equal(row('persona').config.suffix,
    'On Windows, references to bash/Bash above mean the native pwsh tool; elsewhere they mean bash.');
});

test('every prompt variable in the preset is one the 0.2.1 renderer registers', () => {
  // 0.2.1 throws on an unknown `{{name}}` at assembly time, which fails the whole
  // turn; a string copied from an older host (e.g. `{{cwd}}`) is not inert.
  const allowed = new Set(['provider', 'model']);
  const found = [];
  const walk = (value, where) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)) found.push([where, match[1]]);
      return;
    }
    if (Array.isArray(value)) return value.forEach((entry, index) => walk(entry, where + '[' + index + ']'));
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) walk(entry, where + '.' + key);
    }
  };
  walk(plugins, 'plugins');
  assert.ok(found.length > 0, 'the persona interpolates the model id; an empty walk means the scanner broke');
  for (const [where, name] of found) {
    assert.ok(allowed.has(name), `${where} references {{${name}}}, which the 0.2.1 renderer does not register`);
  }
});

// The six upstream roles stay byte-identical to 0.5.3. Council roles are a
// 0.8.0 addition with no upstream row; they get dedicated assertions below.
for (const roleId of UPSTREAM_ROLE_IDS) {
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

for (const roleId of ['councillor-alpha', 'councillor-beta', 'councillor-gamma']) {
  test(roleId + ' is a read-only council seat with its own tool row', () => {
    const id = 'tool-subagent-' + roleId;
    const body = row(id).config.definition.persona;
    assert.ok(body.includes('You are a councillor in a multi-model council.'), roleId + ': councillor persona');
    assert.ok(body.includes('read-only access to the codebase'), roleId + ': read-only facts');
    assert.ok(body.includes('cannot see the other councillors'), roleId + ': independence');
    assert.deepEqual(ROLE_TABLE[roleId].fixedAllow, ['read', 'glob', 'grep'], roleId + ': permission ceiling');
    assert.equal(row(id).config.provider, 'spawn');
    assert.equal(row(id).config.backgroundMode, 'continuable');
    assert.equal(row(id).config.maxDepth, 1);
  });
}

test('council synthesizer is tool-less and fixes the report shape', () => {
  const body = row('tool-subagent-council').config.definition.persona;
  assert.ok(body.includes('You have NO tools'), 'synthesizer declares no tools');
  assert.ok(body.includes('## Council Response'), 'first report section');
  assert.ok(body.includes('## Per-Councillor Details'), 'per-seat section');
  assert.ok(body.includes('## Council Summary'), 'summary section');
  assert.ok(body.includes('Consensus Level: unanimous | majority | split'), 'consensus vocabulary');
  assert.ok(body.includes('single-view report, not a consensus'), 'single-response degradation');
  assert.equal(ROLE_TABLE.council.synthesisOnly, true, 'synthesisOnly flag drives the empty filter');
  assert.equal(row('tool-subagent-council').config.provider, 'spawn');
  assert.equal(row('tool-subagent-council').config.maxDepth, 1);
});

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

// The shipped baseline above is what mounts only when the host base patch
// cannot be read. On a real host the mounted definition carries the host's own
// current text (the host rewrote this prose after 0.5.3), parsed out of the
// base patch block scalar with YAML clip semantics.
test('plan-mode section inheritance parses the base patch block scalar', () => {
  const patch = [
    '    - id: plan-mode',
    "      name: '@deepseek-ai/dsh-plan-mode'",
    '      config:',
    '        section: |',
    '              First line.',
    '',
    '              Second line, indented beyond the key.',
    '',
    '    - id: after-plan-mode',
  ].join('\n');
  assert.equal(parsePlanSection(patch), 'First line.\n\nSecond line, indented beyond the key.\n');
  assert.equal(parsePlanSection('    - id: other\n      name: x\n'), undefined, 'no plan-mode row');
  assert.equal(parsePlanSection('    - id: plan-mode\n      config:\n        section: "inline"\n'), undefined, 'only the block form is inherited');
  assert.equal(parsePlanSection('    - id: plan-mode\n      config:\n        section: |\n'), undefined, 'empty block');
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

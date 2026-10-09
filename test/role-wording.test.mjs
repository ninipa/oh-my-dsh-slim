import assert from 'node:assert/strict';
import test from 'node:test';
import { upstream } from './upstream-baseline.mjs';
import { providerWording, roleDescription, schedulingDescription, backgroundSection, patchRoleTool, patchRoleSection } from '../npm-package/preset/role-wording.js';
import { patchedContext } from '../npm-package/preset/roles.js';
const source = upstream('role-subagent.js').replaceAll('\r\n', '\n');
const originalProvider = new Function(source.match(/function providerWording\(inheritsConversation\) \{[\s\S]*?\n\}/)[0] + ';return providerWording;')();
const evaluate = (params, expression, values) => new Function(...params, 'return ' + expression)(...values);
const options = { toolName: 'subagent_librarian', description: 'Role details.', backgroundMode: 'continuable', mcps: ['context7', 'gh_grep'] };
const originalNote = opts => {
  const block = source.match(/const mcpServerNames = effectiveRoleConfig.mcps \?\? \[\];[\s\S]*?    : undefined;/)[0];
  return new Function('effectiveRoleConfig', 'backgroundEnabled', 'continuable', block + ';return foregroundMcpNote;')(opts, opts.enableRunInBackground !== false, opts.backgroundMode === 'continuable');
};
const originalDescription = opts => {
  const block = source.match(/const description = \[[\s\S]*?\+ \(foregroundMcpNote\?\.description \?\? ''\);/)[0];
  return new Function('wording', 'config', 'backgroundEnabled', 'continuable', 'foregroundMcpNote', block + ';return description;')(originalProvider(opts.inheritsParentContext), opts, opts.enableRunInBackground !== false, opts.backgroundMode === 'continuable', originalNote(opts));
};

test('provider descriptions, lifecycle branches and MCP notes exactly match immutable upstream', () => {
  for (const inherited of [true, false]) {
    assert.deepEqual(providerWording(inherited), originalProvider(inherited));
    for (const backgroundMode of ['continuable', 'one-shot']) for (const enableRunInBackground of [true, false]) for (const mcps of [[], ['context7', 'gh_grep']]) {
      const value = { ...options, inheritsParentContext: inherited, backgroundMode, enableRunInBackground, mcps };
      assert.equal(roleDescription(value), originalDescription(value));
    }
  }
  const expression = source.match(/description: continuable\n\s+(\? 'Whether[\s\S]*?stop with job_kill\.')/)[1];
  for (const continuable of [true, false]) assert.equal(schedulingDescription(continuable), evaluate(['continuable'], 'continuable ' + expression, [continuable]));
  const template = source.match(/: (`Use \$\{toolName\} in the background[\s\S]*?`),/)[1];
  assert.equal(backgroundSection(options.toolName), evaluate(['toolName'], template, [options.toolName]));
});

test('only own tool is patched; execute/schema/concurrency and route field identities remain native', () => {
  const execute = () => ({ kind: 'continuable', subagentId: 'id' });
  const schema = {}; const isConcurrencySafe = () => true;
  const route = { type: 'string', description: 'Native route field.' };
  const tool = { name: options.toolName, description: 'Native. Child LLM selection is optional. Native route contract.',
    execute, isConcurrencySafe, parameters: { prompt: {}, run_in_background: {}, provider: route, model: route },
    output: { schema, render: (_, value) => [{ type: 'text', text: value.kind }] },
  };
  const patched = patchRoleTool(tool, options);
  assert.equal(patched.execute, execute); assert.equal(patched.output.schema, schema);
  assert.equal(patched.isConcurrencySafe, isConcurrencySafe); assert.equal(patched.parameters.provider, route);
  assert.equal(patched.description, originalDescription(options) + ' Child LLM selection is optional. Native route contract.');
  assert.equal(patchRoleTool({ ...tool, name: 'other' }, options).description, tool.description);
  const foreground = { kind: 'foreground', output: [] };
  assert.deepEqual(patched.output.render({}, foreground), [{ type: 'text', text: 'foreground\n' + originalNote(options).result }]);
  assert.deepEqual(foreground, { kind: 'foreground', output: [] });
  for (const kind of ['continuable', 'background']) assert.deepEqual(patched.output.render({}, { kind }), [{ type: 'text', text: kind }]);
  for (const value of [{ ...options, mcps: [] }, { ...options, backgroundMode: 'one-shot' }, { ...options, enableRunInBackground: false }]) assert.equal(patchRoleTool(tool, value).output, tool.output);
});

test('role section preserves native dynamic visibility and every unrelated section', () => {
  const section = { name: 'tool:' + options.toolName, order: 116.5, text: ctx => ctx.visible ? 'Native visible' : '' };
  const patched = patchRoleSection(section, options);
  assert.equal(patched.order, section.order);
  assert.equal(patched.text({ visible: false }), '');
  assert.equal(patched.text({ visible: true }), backgroundSection(options.toolName));
  const other = { ...section, name: 'other' };
  assert.equal(patchRoleSection(other, options), other);
});

test('context exposes matching wording through direct and get systemPrompt paths without requiring mock subagents', () => {
  const sections = []; const registered = [];
  const tools = { register: tool => registered.push(tool) };
  const systemPrompt = { section: section => sections.push(section) };
  const ctx = { tools, systemPrompt, get: name => ({ tools, systemPrompt })[name] };
  const wrapped = patchedContext(ctx, {}, { ...options, stock: { backgroundMode: 'continuable', provider: 'spawn' } });
  assert.equal(wrapped.subagents, undefined);
  for (const service of [wrapped.systemPrompt, wrapped.get('systemPrompt')]) service.section({ name: 'tool:' + options.toolName, text: ctx => ctx.visible ? 'native' : '' });
  for (const section of sections) assert.equal(section.text({ visible: true }), backgroundSection(options.toolName));
  wrapped.tools.register({ name: options.toolName, description: 'Native', parameters: {}, execute() {} });
  assert.equal(registered[0].description, originalDescription(options));
});

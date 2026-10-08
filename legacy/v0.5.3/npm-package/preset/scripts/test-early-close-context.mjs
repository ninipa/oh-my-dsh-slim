// T0-adjacent unit test for early-close-context.js pure helpers.
// Usage: node scripts/test-early-close-context.mjs
import {
  isDelegationTool, renderRows, childIdOf, RUNNING_SECTION_ORDER,
  classifyDeliverySource, deliveriesOf, applyDelivery,
  apply,
  STATUS_RUNNING, STATUS_REPORTED,
} from '../early-close-context.js';

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

console.log('\n[early-close-context] delegation-tool identification');
for (const name of ['subagent_oracle', 'subagent_designer', 'subagent_fixer', 'subagent_explorer', 'subagent_librarian', 'subagent_observer']) {
  if (isDelegationTool(name)) pass(`${name} recognized as delegation`);
  else fail(`${name} not recognized`);
}
if (isDelegationTool('subagent')) pass('stock subagent recognized');
else fail('stock subagent not recognized');
if (isDelegationTool('subagent_fork')) pass('stock subagent_fork recognized');
else fail('stock subagent_fork not recognized');
for (const name of ['subagent_result', 'send_message', 'interrupt_agent', 'list_agents', 'subagent_list_agents', 'subagent_control']) {
  if (!isDelegationTool(name)) pass(`${name} excluded (not a delegation)`);
  else fail(`${name} wrongly treated as delegation`);
}
if (!isDelegationTool(undefined) && !isDelegationTool('read') && !isDelegationTool('')) pass('non-delegation inputs rejected');
else fail('non-delegation inputs wrongly accepted');

console.log('\n[early-close-context] delivery classification (host vocabulary)');
const reportSrc = { kind: 'subagent-report', form: 'relay', senderSessionId: 'child-1' };
const hostReportSrc = { kind: 'agent-message', form: 'relay', senderSessionId: 'child-host' };
const settledSrc = { kind: 'subagent-settled', form: 'notice', summary: 'x', senderSessionId: 'child-2' };
if (classifyDeliverySource(reportSrc) === 'report') pass('subagent-report classified as report');
else fail('subagent-report misclassified');
if (classifyDeliverySource(hostReportSrc) === 'report') pass('agent-message classified as report');
else fail('agent-message misclassified');
if (classifyDeliverySource(settledSrc) === 'settled') pass('subagent-settled classified as settled');
else fail('subagent-settled misclassified');
for (const bad of [undefined, null, {}, { kind: 'user' }, { kind: 'subagent-report' }, { kind: 'subagent-settled', senderSessionId: 42 }]) {
  if (classifyDeliverySource(bad) === void 0) pass(`non-delivery source rejected: ${JSON.stringify(bad)}`);
  else fail(`non-delivery source accepted: ${JSON.stringify(bad)}`);
}

console.log('\n[early-close-context] deliveriesOf extraction');
const splice = {
  type: 'agent/inbox/spliced',
  data: { inserted: [
    { content: [{ type: 'text', text: 'task' }], source: { kind: 'user' } },
    { content: [{ type: 'text', text: 'Background subagent child-1 reported:' }], source: reportSrc },
    { content: [{ type: 'text', text: 'Background subagent child-2 finished' }], source: settledSrc },
  ] },
};
const deliveries = deliveriesOf(splice);
if (deliveries.length === 2 && deliveries[0].childId === 'child-1' && deliveries[0].kind === 'report'
  && deliveries[1].childId === 'child-2' && deliveries[1].kind === 'settled') pass('deliveries extracted in order with ids');
else fail(`deliveries extraction wrong: ${JSON.stringify(deliveries)}`);
if (deliveriesOf({ data: {} }).length === 0 && deliveriesOf(undefined).length === 0 && deliveriesOf({ data: { inserted: [] } }).length === 0) pass('empty splices yield no deliveries');
else fail('empty splices mishandled');

console.log('\n[early-close-context] three-state transitions');
const entry = { role: 'subagent_fixer', label: 'fix images', parentId: 'p', childId: 'c', status: STATUS_RUNNING };
if (entry.status === STATUS_RUNNING) pass('fresh entry starts running');
else fail('fresh entry not running');
applyDelivery(entry, 'report');
if (entry.status === STATUS_REPORTED && typeof entry.reportedAt === 'number') pass('report -> reported');
else fail('report transition failed');
if (!applyDelivery(entry, 'report')) pass('second report is a no-op');
else fail('second report changed status again');
applyDelivery(entry, 'settled');
if (entry.status === 'settled' && typeof entry.settledAt === 'number') pass('settled recorded');
else fail('settled transition failed');
if (!applyDelivery(undefined, 'report') && !applyDelivery(undefined, 'settled')) pass('missing entry is a no-op');
else fail('missing entry mutated');

console.log('\n[early-close-context] running-block rendering (running vs reported)');
if (renderRows([]) === '') pass('empty rows render empty block');
else fail('empty rows rendered non-empty');
const base = { role: 'subagent_oracle', label: 'compare docs', parentId: 'p', childId: 'c1', since: 1, sinceLabel: '10:00:00' };
const runningRow = renderRows([{ ...base, status: STATUS_RUNNING }]);
if (runningRow.includes('仍在运行') && runningRow.includes('10:00:00')) pass('running row rendered with started time');
else fail(`running row rendering wrong: ${runningRow.slice(0, 120)}`);
const reportedRow = renderRows([{ ...base, status: STATUS_REPORTED }]);
if (reportedRow.includes('已回报内容') && reportedRow.includes('reported ≠ 完成')) pass('reported row rendered distinctly');
else fail(`reported row rendering wrong: ${reportedRow.slice(0, 120)}`);
const multi = renderRows([
  { ...base, status: STATUS_REPORTED },
  { ...base, childId: 'c2', role: 'subagent_fixer', status: STATUS_RUNNING },
]);
if (multi.includes('c1') && multi.includes('c2') && multi.includes('state each one')) pass('multi-subagent rows each listed with collective-summary warning');
else fail(`multi-subagent rendering wrong: ${multi.slice(0, 160)}`);
const settledRow = renderRows([{ ...base, status: 'settled' }]);
if (settledRow === '') pass('settled entry excluded from render');
else fail('settled entry still rendered');

console.log('\n[early-close-context] childId extraction');
const withId = { content: [{ type: 'text', text: 'started subagent 3bff539d-084a-4d66-bf55-a5b72089acf2' }] };
const extracted = childIdOf(withId);
if (extracted === '3bff539d-084a-4d66-bf55-a5b72089acf2') pass('uuid extracted from result text');
else fail(`uuid not extracted: ${extracted}`);
if (childIdOf({ content: [{ type: 'text', text: 'no id here' }] }) === void 0) pass('no uuid -> undefined');
else fail('no uuid -> non-undefined');
if (childIdOf({ content: [] }) === void 0 && childIdOf({}) === void 0 && childIdOf(undefined) === void 0) pass('empty/missing result -> undefined');
else fail('empty/missing result mishandled');
if (childIdOf({ content: [{ type: 'image' }] }) === void 0) pass('non-text blocks skipped');
else fail('non-text blocks not skipped');

console.log('\n[early-close-context] section order');
if (RUNNING_SECTION_ORDER === 117) pass('order 117 (after role-subagent 116.5)');
else fail(`unexpected order ${RUNNING_SECTION_ORDER}`);

console.log('\n[early-close-context] live inbox settlement ordering');
function makePluginHarness(listChildren) {
  const listeners = new Map();
  let render;
  const ctx = {
    on(name, callback) {
      listeners.set(name, callback);
      return () => {};
    },
    inject(_dependencies, setup) {
      setup({
        systemPrompt: {
          context(definition) {
            render = definition.text;
          },
        },
      });
    },
    subagents: {
      listChildren: listChildren ?? (() => new Promise(() => {})),
    },
    logger: { warn() {} },
  };
  apply(ctx);
  return { ctx, listeners, render };
}

async function registerChild(harness, parentId, childId, role = 'subagent_explorer') {
  const agent = { id: parentId, session: { id: parentId, events: [] } };
  const exec = { agent, name: role, arguments: { description: 'scan a bounded scope' } };
  await harness.listeners.get('tools/pre-execute')(exec, () => undefined);
  const result = harness.listeners.get('tools/post-execute')(
    exec,
    { isError: false, content: [{ type: 'text', text: `started subagent ${childId}` }] },
    () => undefined,
  );
  return { agent, exec, result };
}

function inboxMessage(parentId, source) {
  return { agent: { id: parentId }, message: { source, content: [] } };
}

{
  const parentId = 'parent-live';
  const childId = '11111111-1111-4111-8111-111111111111';
  const harness = makePluginHarness();
  const { agent } = await registerChild(harness, parentId, childId);
  const context = { agent: { session: agent.session } };
  const running = harness.render(context);
  check(running.includes(childId) && running.includes('仍在运行'), 'delegation appears in live running block');

  harness.listeners.get('agent/inbox/inserted')(inboxMessage(parentId, {
    kind: 'agent-message', form: 'relay', senderSessionId: childId,
  }));
  const reported = harness.render(context);
  check(reported.includes(childId) && reported.includes('已回报内容'), 'live agent-message updates reported state before assembly');

  harness.listeners.get('agent/inbox/inserted')(inboxMessage(parentId, {
    kind: 'subagent-settled', form: 'notice', senderSessionId: childId,
  }));
  check(harness.render(context) === '', 'live settlement removes child before next assembly');
}

{
  const parentId = 'parent-independent-children';
  const firstId = '44444444-4444-4444-8444-444444444444';
  const secondId = '55555555-5555-4555-8555-555555555555';
  const harness = makePluginHarness();
  const first = await registerChild(harness, parentId, firstId);
  await registerChild(harness, parentId, secondId);
  const context = { agent: { session: first.agent.session } };
  harness.listeners.get('agent/inbox/inserted')(inboxMessage(parentId, {
    kind: 'subagent-settled', form: 'notice', senderSessionId: firstId,
  }));
  const remaining = harness.render(context);
  check(!remaining.includes(firstId) && remaining.includes(secondId), 'settling one child preserves another active child');
}

{
  const parentId = 'parent-early-settlement';
  const childId = '22222222-2222-4222-8222-222222222222';
  const harness = makePluginHarness();
  const agent = { id: parentId, session: { id: parentId, events: [] } };
  const exec = { agent, name: 'subagent_explorer', arguments: { description: 'fast scan' } };
  await harness.listeners.get('tools/pre-execute')(exec, () => undefined);
  harness.listeners.get('agent/inbox/inserted')(inboxMessage(parentId, {
    kind: 'subagent-settled', form: 'notice', senderSessionId: childId,
  }));
  harness.listeners.get('tools/post-execute')(
    exec,
    { isError: false, content: [{ type: 'text', text: `started subagent ${childId}` }] },
    () => undefined,
  );
  check(harness.render({ agent: { session: agent.session } }) === '', 'settlement before tool result stays tombstoned');
}

{
  const parentId = 'parent-stale-refresh';
  const childId = '33333333-3333-4333-8333-333333333333';
  let resolveRows;
  const harness = makePluginHarness(() => new Promise((resolve) => { resolveRows = resolve; }));
  const { agent } = await registerChild(harness, parentId, childId);
  const context = { agent: { session: agent.session } };
  harness.render(context);
  harness.listeners.get('agent/inbox/inserted')(inboxMessage(parentId, {
    kind: 'subagent-settled', form: 'notice', senderSessionId: childId,
  }));
  resolveRows([{ kind: 'child', id: childId, activity: 'running' }]);
  await new Promise((resolve) => setImmediate(resolve));
  check(harness.render(context) === '', 'late stale listChildren result cannot reopen settled child');
}

if (failures > 0) {
  console.log(`\nearly-close-context: ${failures} FAILED`);
  process.exit(1);
}
console.log('\nearly-close-context: ALL PASSED');

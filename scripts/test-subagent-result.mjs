// Zero-cost contract test for subagent-result.js (PLAN 方案 4).
// Loads the real plugin with a mocked DSH context and verifies: single
// registration, final-message extraction, parentSession authorization,
// not-found mapping, still-running reporting, and the missing-service error.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

function resolveDshPackage() {
  const roots = [];
  if (process.env.DSH_HOME) {
    roots.push(join(process.env.DSH_HOME, 'profiles', 'node_modules'));
    roots.push(join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules'));
  }
  for (const command of ['npm root -g', 'zsh -lic "npm root -g"']) {
    try { roots.push(execSync(command, { encoding: 'utf8' }).trim()); } catch {}
  }
  try {
    const dshBin = realpathSync(execSync('command -v dsh', { encoding: 'utf8' }).trim());
    roots.push(dirname(dirname(dirname(dirname(dshBin)))));
  } catch {}
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const dshRoot = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!dshRoot) throw new Error('DSH package not found');
  return join(dshRoot, '@deepseek-ai/dsh/package.json');
}

const require = createRequire(resolveDshPackage());
const { SessionId } = require('@deepseek-ai/dsh-session');

function textMessage(text) {
  return {
    type: 'assistant/message',
    seq: 0,
    time: 0,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } },
  };
}

/** Build a plugin context whose sessionQuery serves the given sessions. */
function makeContext({ sessions = {}, services = {} } = {}) {
  const registered = [];
  const ctx = {
    tools: {
      register(definition) {
        registered.push(definition);
        return () => {};
      },
    },
    get(name) {
      if (name in services) return services[name];
      return undefined;
    },
  };
  return { ctx, registered };
}

async function loadPlugin() {
  return import(pathToFileURL(join(root, 'subagent-result.js')).href);
}

const PARENT_ID = 'session-parent';

async function execute(definition, args, parentId = PARENT_ID) {
  return definition.execute(args, { agent: { id: parentId }, signal: undefined });
}

console.log('\n[1] registration');
{
  const plugin = await loadPlugin();
  const { ctx, registered } = makeContext();
  const dispose = plugin.apply(ctx);
  check(registered.length === 1, 'plugin registers exactly one tool');
  check(registered[0]?.name === 'subagent_result', 'tool name is subagent_result');
  check(typeof dispose === 'function', 'apply returns a disposer');
  check(/send_message/.test(registered[0].description), 'description contrasts with send_message');
}

console.log('\n[2] happy path: last assistant message wins');
{
  const plugin = await loadPlugin();
  const childId = SessionId('session-child-1');
  const surface = {
    session: { id: childId, parentSession: PARENT_ID, origin: 'subagent', delegationDepth: 1 },
    capturedThroughSeq: 5,
    events: [
      { type: 'user/message', seq: 3, time: 1, data: { message: { role: 'user', content: [{ type: 'text', text: 'q' }] } } },
      textMessage('intermediate answer'),
      { type: 'tool/result', seq: 5, time: 3, data: { message: { role: 'user', content: [{ type: 'tool_result', output: 'x' }] } } },
    ],
  };
  surface.events[1].seq = 4;
  surface.events[1].data.message.content[0].text = 'intermediate answer';
  // Append the FINAL assistant message after the tool result, as a settled
  // continuable lane would look on the folded surface.
  const finalEvent = textMessage('FINAL ANSWER');
  finalEvent.seq = 6;
  surface.events.push(finalEvent);
  surface.capturedThroughSeq = 6;
  const { ctx, registered } = makeContext({
    services: { sessionQuery: { async readSurface(id) { return id === childId ? surface : undefined; } } },
  });
  plugin.apply(ctx);
  const value = await execute(registered[0], { subagent_id: childId });
  check(value.kind === 'result', 'returns kind result');
  check(value.text === 'FINAL ANSWER', `extracts the LAST assistant message (got: ${JSON.stringify(value.text)})`);
  check(value.seq === 6, 'reports the winning event seq');
}

console.log('\n[3] authorization: only direct children');
{
  const plugin = await loadPlugin();
  const childId = SessionId('session-child-2');
  const surface = {
    session: { id: childId, parentSession: 'session-someone-else', origin: 'subagent' },
    capturedThroughSeq: 1,
    events: [textMessage('secret')],
  };
  const { ctx, registered } = makeContext({
    services: { sessionQuery: { async readSurface() { return surface; } } },
  });
  plugin.apply(ctx);
  let threw = '';
  try {
    await execute(registered[0], { subagent_id: childId });
  } catch (error) {
    threw = error.message;
  }
  check(threw.includes('not a direct child'), `rejects foreign children (got: ${threw})`);
  check(!threw.includes('secret'), 'error does not leak foreign content');
}

console.log('\n[4] unknown id maps to a friendly error');
{
  const plugin = await loadPlugin();
  const { ctx, registered } = makeContext({
    services: {
      sessionQuery: {
        async readSurface() {
          const error = new Error('session "x" not found');
          error.code = 'SESSION_QUERY_SESSION_NOT_FOUND';
          throw error;
        },
      },
    },
  });
  plugin.apply(ctx);
  let threw = '';
  try {
    await execute(registered[0], { subagent_id: 'session-x' });
  } catch (error) {
    threw = error.message;
  }
  check(threw.includes('no session') && threw.includes('check the id'), `friendly not-found error (got: ${threw})`);
}

console.log('\n[5] no assistant message yet → still-running report');
{
  const plugin = await loadPlugin();
  const childId = SessionId('session-child-3');
  const surface = {
    session: { id: childId, parentSession: PARENT_ID, origin: 'subagent' },
    capturedThroughSeq: 2,
    events: [{ type: 'user/message', seq: 1, time: 1, data: { message: { role: 'user', content: [{ type: 'text', text: 'q' }] } } }],
  };
  const { ctx, registered } = makeContext({
    services: { sessionQuery: { async readSurface() { return surface; } } },
  });
  plugin.apply(ctx);
  const value = await execute(registered[0], { subagent_id: childId });
  check(value.kind === 'no-assistant-message', 'reports no-assistant-message');
  check(value.capturedThroughSeq === 2, 'reports capture boundary');
}

console.log('\n[6] missing sessionQuery service fails loud');
{
  const plugin = await loadPlugin();
  const { ctx, registered } = makeContext({});
  plugin.apply(ctx);
  let threw = '';
  try {
    await execute(registered[0], { subagent_id: 'session-any' });
  } catch (error) {
    threw = error.message;
  }
  check(threw.includes('sessionQuery is not mounted'), `fails loud without the service (got: ${threw})`);
}

console.log(failures === 0 ? '\nSUBAGENT-RESULT: ALL CHECKS PASSED' : `\nSUBAGENT-RESULT: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

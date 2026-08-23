// subagent-result.js — oh-my-dsh-slim companion plugin (PLAN-BACKGROUND-DELEGATION 方案 4).
//
// A single read-only tool `subagent_result`: return the final assistant
// message of an already-settled subagent WITHOUT resuming it. The stock
// alternatives both cost a model turn: `send_message` wakes the child and
// starts a new turn, and the settlement notice only delivers once. OMO's
// equivalent is its `task_result` tool.
//
// This file MUST stay a standalone singleton row in agent.cordis.yml. It must
// never be folded into role-subagent.js: that file is applied once per role
// row (6x), and registering the same globally-named tool twice throws
// `tool "..." is already registered` (dsh-tools NamedEntries), which fails the
// whole preset mount.
//
// Data path (verified by scripts/probe-session-query.js, 2026-08-21):
// ctx.get('sessionQuery') is mounted by dsh-base (session-query-sqlite,
// openAt: never) — exact reads work everywhere, only full-text search is
// disabled. readSurface(id) resolves live-preferred and falls back to session
// persistence after the child left the store; sessions are never auto-deleted.
// Authorization compares the header's parentSession against the calling
// agent's own session id, so a session can only read lanes it spawned itself.
//
// Dependency resolution mirrors ../role-subagent.js: a preset directory cannot
// bare-import @deepseek-ai/*, so resolve them from the global DSH install.
// Top-level require() is safe here for dsh-tools/dsh-session (both are fully
// loaded before any preset row applies — role-subagent.js ships the same
// pattern); do NOT copy this pattern for packages loaded late in boot.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const root = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!root) throw new Error('subagent-result: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return join(root, '@deepseek-ai/dsh/package.json');
}

const require = createRequire(resolveDshPackage());
const { defineTool } = require('@deepseek-ai/dsh-tools');
const { SessionId } = require('@deepseek-ai/dsh-session');

const name = 'subagent-result';
const inject = ['tools'];

function assistantText(event) {
  const content = event?.data?.message?.content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

function apply(ctx) {
  let disposed = false;
  const disposeTool = ctx.tools.register(defineTool({
    name: 'subagent_result',
    description: [
      'Read-only retrieval of a background subagent\'s final message.',
      'Returns the last assistant message the subagent produced, without waking it up and without starting a new model turn (unlike send_message, which resumes the child).',
      'Use it after a settlement notice to re-read a finished lane\'s outcome, or to collect several finished lanes one by one.',
      'Only direct children of your own session can be read.',
      'If the subagent has not produced any assistant message yet, it is still running — wait for its settlement notice instead of polling.',
    ].join(' '),
    parameters: {
      subagent_id: {
        type: 'string',
        required: true,
        description: 'The durable subagent id returned when you started the background subagent.',
      },
    },
    output: {
      schema: { oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'result' },
            subagentId: { type: 'string', required: true },
            seq: { type: 'number', required: true },
            text: { type: 'string', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'no-assistant-message' },
            subagentId: { type: 'string', required: true },
            capturedThroughSeq: { type: 'number', required: true },
          },
        },
      ] },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'result'
          ? `final message of ${value.subagentId}:\n${value.text}`
          : `${value.subagentId} has not produced any assistant message yet (log captured through seq ${value.capturedThroughSeq}); it is likely still running`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent) throw new Error('subagent_result requires a calling agent (exec.agent was undefined)');
      const query = ctx.get('sessionQuery');
      if (query === void 0) {
        throw new Error('subagent_result: ctx.sessionQuery is not mounted (load @deepseek-ai/dsh-session-query-sqlite)');
      }
      let snapshot;
      try {
        snapshot = await query.readSurface(SessionId(args.subagent_id));
      } catch (error) {
        if (error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
          throw new Error(`subagent_result: no session "${args.subagent_id}" — check the id recorded when the subagent started`);
        }
        throw error;
      }
      // Authorization: only lanes this session spawned itself. The header is
      // immutable creation metadata, so parentSession is the spawn-time truth.
      if (snapshot.session.parentSession !== parent.id) {
        throw new Error(`subagent_result: session "${args.subagent_id}" is not a direct child of this session`);
      }
      for (let i = snapshot.events.length - 1; i >= 0; i--) {
        const event = snapshot.events[i];
        if (event.type !== 'assistant/message') continue;
        const text = assistantText(event);
        if (text === '') continue;
        return { kind: 'result', subagentId: args.subagent_id, seq: event.seq, text };
      }
      return {
        kind: 'no-assistant-message',
        subagentId: args.subagent_id,
        capturedThroughSeq: snapshot.capturedThroughSeq ?? 0,
      };
    },
  }));
  return () => {
    if (disposed) return;
    disposed = true;
    disposeTool();
  };
}

export { name, inject, apply };

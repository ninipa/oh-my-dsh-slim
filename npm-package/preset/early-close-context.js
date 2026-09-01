// early-close-context.js — first-phase mitigation for the "orchestrator closes
// early" failure: the main model emits a final conclusion while a background
// subagent it delegated is still running (and never integrates its result).
//
// Mechanism research (HANDOFF §5, 2026-08-29): DSH is turn-based — the model
// either outputs or ends; there is no mechanism-level "wait" barrier
// (turn-stopping is serial-readonly, pre-step reject discards claimed
// messages). The fix therefore supplies the model with FACTS, not rules:
//   1. a live "currently running background subagents" block injected into the
//      system prompt (same dynamic `systemPrompt.context` mechanism as the
//      host's `sandbox:policy` — re-rendered on every prompt assembly, so the
//      model sees current state, not memory);
//   2. an `additionalContexts` decision-point reminder attached to every
//      successful delegation tool result ("you will be notified; do not
//      conclude before it settles").
//
// A light ledger (childId -> {role,label,parentId,status}) feeds both. Status
// is three-state, mirroring the host's own delivery vocabulary
// (dsh-subagent: `subagent-report` relay vs `subagent-settled` notice):
//   running  — started, nothing reported back yet;
//   reported — the child relayed content ("Background subagent X reported:"),
//              but a report neither concludes its turn nor changes its
//              Activation lifetime — it may keep working, and only its
//              finish notice (unconditional for every established child,
//              incl. failure/cancel/token-ceiling paths) settles it;
//   settled  — finish notice seen (or listChildren no longer reports the
//              child running — the fallback that also covers a lost notice).
// The ledger is updated from two sources: delegation tool results
// (post-execute, sync) and an incremental scan of the parent session's
// inbox-splice events (async, on render; source.kind is authoritative, no
// text matching). listChildren refresh stays as the settle fallback.
//
// Scope: preset-only composition (like sandbox-strip); non-preset sessions
// never load it. In-process continuation provider required (listChildren).
//
// Compat: 0.1.1-rc.2 .. 0.1.2-alpha.1 — subagents API unchanged (checked in
// the 2026-08-29 source survey; UPGRADE-CHECKLIST §7.1).

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
  const probeOptions = { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] };
  for (const command of ['npm root -g', 'zsh -lic "npm root -g"']) {
    // zsh -lic sources the user's login+interactive shell config, which can hang
    // (reported on Linux); every probe is bounded and silent on stderr.
    try {
      roots.push(execSync(command, probeOptions).trim());
      break; // first reachable npm root wins; the zsh fallback only runs when plain sh lacks npm
    } catch {}
  }
  try {
    const dshBin = realpathSync(execSync('command -v dsh', probeOptions).trim());
    const packageDir = dirname(dirname(dshBin));
    roots.push(dirname(dirname(packageDir)));
  } catch {}
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const root = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!root) throw new Error('early-close-context: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return join(root, '@deepseek-ai/dsh/package.json');
}

const require = createRequire(resolveDshPackage());

const { createUserMessage } = require('@deepseek-ai/dsh-llm');

export const name = 'early-close-context';
export const inject = ['systemPrompt', 'subagents'];

/** Prompt order: right after role-subagent's delegation-policy section (116.5). */
export const RUNNING_SECTION_ORDER = 117;

/** Ledger child statuses. */
export const STATUS_RUNNING = 'running';
export const STATUS_REPORTED = 'reported';

/** One delegated background child in the ledger. */
// childId -> { role, label, parentId, since, sinceLabel, childId, status }

/**
* Classify one inbox-splice message source as a child delivery.
* The host's own vocabulary (dsh-subagent lib):
*   - {kind: 'subagent-report', senderSessionId} — relayed content; the child
*     keeps running (report does not conclude its turn or change lifetime);
*   - {kind: 'subagent-settled', senderSessionId} — unconditional finish
*     notice (completed/failed/cancelled/token-ceiling all deliver one).
* @param source - a message source object.
* @returns 'report' | 'settled' | undefined.
*/
export function classifyDeliverySource(source) {
  if (typeof source !== 'object' || source === null) return void 0;
  if (source.kind === 'subagent-report' && typeof source.senderSessionId === 'string') return 'report';
  if (source.kind === 'subagent-settled' && typeof source.senderSessionId === 'string') return 'settled';
  return void 0;
}

/**
* Extract child deliveries from one agent/inbox/spliced event's inserted
* messages. Pure — testable without a live session.
* @param spliceEvent - an event whose `data.inserted` are messages.
* @returns [{childId, kind}] in insertion order.
*/
export function deliveriesOf(spliceEvent) {
  const inserted = spliceEvent?.data?.inserted;
  if (!Array.isArray(inserted)) return [];
  const out = [];
  for (const msg of inserted) {
    const kind = classifyDeliverySource(msg?.source);
    if (kind !== void 0) out.push({ childId: msg.source.senderSessionId, kind });
  }
  return out;
}

/**
* Apply one delivery to a ledger entry's status.
* @param entry - the ledger entry, mutated in place.
* @param kind - 'report' (running -> reported) or 'settled' (remove).
* @returns true when the entry changed (report) or was removed (settled).
*/
export function applyDelivery(entry, kind) {
  if (entry === void 0) return false;
  if (kind === 'report') {
    if (entry.status !== STATUS_REPORTED) {
      entry.status = STATUS_REPORTED;
      entry.reportedAt = Date.now();
      return true;
    }
    return false;
  }
  if (kind === 'settled') {
    entry.status = 'settled';
    entry.settledAt = Date.now();
    return true;
  }
  return false;
}

/**
* Render the running-children block for one parent's ledger rows (sync).
* Rows must already be filtered to the parent and sorted.
* @param rows - ledger entries for one parent.
* @returns the prompt block text, or '' when nothing is running/reported.
*/
export function renderRows(rows) {
  const active = (rows ?? []).filter((entry) => entry !== void 0 && entry.status !== 'settled');
  if (active.length === 0) return '';
  const lines = active.map((entry) => entry.status === STATUS_REPORTED
    ? `- ${entry.role} "${entry.label}" (${entry.childId}) — 已回报内容，等待正式完成通知（reported ≠ 完成）`
    : `- ${entry.role} "${entry.label}" (${entry.childId}) — 仍在运行（started ${entry.sinceLabel}）`);
  return 'Currently running background subagents delegated by you (they have NOT settled yet):\n'
    + lines.join('\n')
    + '\nA subagent report is not its completion: only its finish notice settles it. Do not output a final conclusion while any of them is unsettled; with multiple subagents, state each one\'s status individually — never summarize them as "the subagent is done" collectively.';
}

/** Extract the first UUID from a delegation result text (childId). */
export function childIdOf(result) {
  if (typeof result !== 'object' || result === null || !Array.isArray(result.content)) return void 0;
  const text = result.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  return match?.[0];
}

/** Non-delegation tools whose names collide with the subagent_ prefix. */
const NOT_DELEGATION = new Set([
  'subagent_result',       // read-only retrieval of a settled child (subagent-result.js)
  'send_message',          // follow up with a continuable child (tool-subagent-control)
  'interrupt_agent',       // cancel a running child
  'list_agents',           // inventory children
  'subagent_list_agents', 'subagent_control',
]);

/** Whether a tool call actually starts a (possibly background) subagent. */
export function isDelegationTool(name) {
  if (typeof name !== 'string') return false;
  if (NOT_DELEGATION.has(name)) return false;
  return name === 'subagent' || name === 'subagent_fork' || name.startsWith('subagent_');
}

export function apply(ctx, config) {
  /** childId -> { role, label, parentId, since, sinceLabel, childId, status } */
  const ledger = new Map();
  /** Pending delegation calls awaiting their tool result (WeakMap on exec). */
  const pending = new WeakMap();
  /** Per-parent last scanned session seq (incremental inbox-splice scan). */
  const lastScanSeq = new Map(); // parentId -> seq
  /** Per-parent refresh throttle (avoid stacking listChildren on hot prompts). */
  const lastRefreshAt = new Map(); // parentId -> timestamp
  const REFRESH_MIN_INTERVAL_MS = 800;

  /** Incremental scan: apply child deliveries from inbox-splice events. */
  function scanSessionEvents(session, parentId) {
    const from = lastScanSeq.get(parentId) ?? 0;
    let last = from;
    for (const event of session.events ?? []) {
      const seq = typeof event.seq === 'number' ? event.seq : 0;
      if (seq <= from) continue;
      if (seq > last) last = seq;
      if (event.type !== 'agent/inbox/spliced') continue;
      for (const { childId, kind } of deliveriesOf(event)) {
        const entry = ledger.get(childId);
        if (entry === void 0 || entry.parentId !== parentId) continue;
        if (kind === 'settled') {
          ledger.delete(childId);
        } else {
          applyDelivery(entry, kind);
        }
        if (process.env.ECC_DEBUG === '1') console.error(`[ecc] delivery ${kind} for ${childId} (parent ${parentId})`);
      }
    }
    lastScanSeq.set(parentId, last);
  }

  // Track role delegations at the pre-execute waterfall (works for both the
  // preset's role tools and any stock subagent tool that may be enabled).
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec?.agent && isDelegationTool(exec.name)) {
      pending.set(exec, {
        role: exec.name,
        label: typeof exec.arguments?.description === 'string' ? exec.arguments.description : exec.name,
        parentId: exec.agent.session?.id,
      });
    }
    return next();
  });

  // Successful delegation -> ledger + decision-point reminder on the result.
  ctx.on('tools/post-execute', (exec, result, next) => {
    const info = pending.get(exec);
    pending.delete(exec);
    if (info === void 0 || result.isError) return next();
    const childId = childIdOf(result);
    if (childId === void 0 || info.parentId === void 0) return next();
    ledger.set(childId, {
      role: info.role,
      label: info.label,
      parentId: info.parentId,
      since: Date.now(),
      sinceLabel: new Date().toLocaleTimeString(),
      childId,
      status: STATUS_RUNNING,
    });
    // Waterfall decision: return it directly (next() drops arguments in the
    // cordis waterfall). additionalContexts are spliced into the agent inbox
    // for the next step, so each item must be a full message
    // ({role, content, source}) — not a bare text object.
    return {
      kind: 'accept',
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: `Decision point: background ${info.role} "${info.label}" (${childId}) is now running and has NOT settled. A report from this subagent may arrive before its finish notice — treat the finish notice, not the report, as completion. Do not output a final conclusion until you receive its settle notice (or explicitly report it as still running); you may continue other work meanwhile.` }],
        source: { kind: 'plugin', plugin: 'early-close-context' },
      })],
    };
  });

  // Lazy async ledger refresh: keep only children the host still reports
  // running (the settle fallback — covers a lost/dropped finish notice).
  async function refreshLedger(parentId) {
    const now = Date.now();
    const last = lastRefreshAt.get(parentId) ?? 0;
    if (now - last < REFRESH_MIN_INTERVAL_MS) return;
    lastRefreshAt.set(parentId, now);
    try {
      const signal = new AbortController().signal;
      const rows = await ctx.subagents.listChildren(parentId, signal);
      const running = new Set(rows
        .filter((row) => row?.kind === 'child' && row.activity === 'running')
        .map((row) => row.id));
      for (const childId of [...ledger.keys()]) {
        const entry = ledger.get(childId);
        if (entry !== void 0 && entry.parentId === parentId && !running.has(childId)) ledger.delete(childId);
      }
    } catch (error) {
      const msg = `early-close-context: listChildren refresh failed: ${error instanceof Error ? error.message : String(error)}`;
      if (process.env.ECC_DEBUG === '1') console.error(`[ecc] ${msg}`);
      ctx.logger?.warn?.(msg);
    }
  }

  // Dynamic system-prompt block — same mechanism as host `sandbox:policy`.
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'subagents:running',
      order: RUNNING_SECTION_ORDER,
      text: (context) => {
        const session = context.agent?.session;
        if (session === void 0) return '';
        scanSessionEvents(session, session.id);
        void refreshLedger(session.id);
        const rows = [...ledger.values()]
          .filter((entry) => entry.parentId === session.id && entry.status !== 'settled')
          .sort((a, b) => a.since - b.since);
        const rendered = renderRows(rows);
        if (process.env.ECC_DEBUG === '1') console.error(`[ecc] text() rendered for ${session.id}: ${JSON.stringify(rendered.slice(0, 160))}`);
        return rendered;
      },
    });
  });
}

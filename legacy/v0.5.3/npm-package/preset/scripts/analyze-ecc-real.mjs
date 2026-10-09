// analyze-ecc-real — judge the real-headless ECC probe (run-ecc-real):
// reads the probe's stdout report (run.out) and the stderr sequence log
// (run.err), which interleaves
//   [ecc] text() rendered for <session>: "<running-block>"   (per prompt assembly,
//         '' = empty block; ECC_DEBUG=1)
//   [ecc-real] delegation reminder child=...
//   [ecc-real] inbox relay kind=...
//   [ecc-real] inbox settle child=...
// Verdict: the ledger must display the child in some render BEFORE its settle
// notice, and every render AFTER the settle notice must be an empty block.
// Usage: node scripts/analyze-ecc-real.mjs <run.out> <run.err>
import { readFileSync } from 'node:fs';

const [, , outPath, errPath] = process.argv;
if (!outPath || !errPath) {
  process.stderr.write('usage: node scripts/analyze-ecc-real.mjs <run.out> <run.err>\n');
  process.exit(2);
}

const outText = readFileSync(outPath, 'utf8');
const report = JSON.parse(outText.slice(outText.indexOf('{'), outText.lastIndexOf('}') + 1));
const lines = readFileSync(errPath, 'utf8').split('\n');
const childId = report.delegationChild;

const childPrefix = childId === null ? null : childId.slice(0, 18);
const renders = [];
const events = [];
for (const [idx, raw] of lines.entries()) {
  const render = raw.match(/^\[ecc\] text\(\) rendered for (\S+): (.*)$/);
  if (render !== null) {
    let content = render[2];
    try { content = JSON.parse(content); } catch {}
    // ECC_DEBUG prints only the first 160 chars of the block, so the status
    // suffix may be truncated; the child's UUID prefix is enough to identify
    // the row (the full block head always precedes the status text).
    renders.push({
      idx,
      session: render[1],
      empty: typeof content === 'string' && content.length === 0,
      hasRunning: content.includes('仍在运行'),
      hasReported: content.includes('已回报内容'),
      hasChild: childPrefix !== null && content.includes(childPrefix),
    });
    continue;
  }
  const event = raw.match(/^\[ecc-real\] (delegation reminder|inbox relay|inbox settle)(.*)$/);
  if (event !== null) events.push({ idx, kind: event[1], rest: event[2] });
}

// Role agents also mount ECC (their own empty block renders are expected
// noise); the running-block sequence that matters is the PARENT's.
const parentRenders = renders.filter((r) => r.session === report.parentId);
const settle = events.find((e) => e.kind === 'inbox settle');
const reminder = events.find((e) => e.kind === 'delegation reminder');
const settleIdx = settle?.idx ?? -1;
const before = parentRenders.filter((r) => r.idx < settleIdx);
const after = parentRenders.filter((r) => r.idx > settleIdx);

const checks = {
  runPassed: report.delegationChild !== null && report.settleSeen === true,
  eccDebugActive: report.eccDebugActive === true,
  delegationReminderSeen: reminder !== undefined,
  settleSeenInLog: settle !== undefined,
  childShownBeforeSettle: before.some((r) => r.hasRunning || r.hasReported || r.hasChild),
  postSettleAssemblyExists: after.length > 0,
  // Assemblies whose text() evaluation raced ahead of the notice insertion may
  // legitimately still show the child (that prompt was already stale). The fix
  // guarantees monotone clearing: once a post-settle assembly renders empty,
  // no later assembly may show the child again, and the run ends empty.
  postSettleConvergesEmpty: (() => {
    if (after.length === 0) return false;
    const firstEmpty = after.findIndex((r) => r.empty);
    if (firstEmpty === -1) return false;
    return after.slice(firstEmpty).every((r) => r.empty && !r.hasRunning && !r.hasReported);
  })(),
};
const summary = {
  childId,
  childPrefix,
  parentRenders: parentRenders.length,
  childRenders: renders.length - parentRenders.length,
  rendersBeforeSettle: before.map((r) => (r.empty ? '<empty>' : r.hasReported ? '<reported>' : r.hasRunning ? '<running>' : r.hasChild ? '<hasChild>' : '<other>')),
  rendersAfterSettle: after.map((r) => (r.empty ? '<empty>' : r.hasReported ? '<reported>' : r.hasRunning ? '<running>' : r.hasChild ? '<hasChild>' : '<other>')),
  eventKinds: events.map((e) => e.kind),
};

process.stdout.write(`${JSON.stringify({ checks, summary }, null, 2)}\n`);
const pass = checks.runPassed && checks.eccDebugActive && checks.delegationReminderSeen
  && checks.settleSeenInLog && checks.childShownBeforeSettle
  && checks.postSettleAssemblyExists && checks.postSettleConvergesEmpty;
process.stdout.write(`ECC_ORDER_VERDICT: ${pass ? 'PASS' : 'FAIL'}\n`);
process.exit(pass ? 0 : 1);

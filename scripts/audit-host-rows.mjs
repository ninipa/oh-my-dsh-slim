// Host-row audit: every preset row that shares an id with an installed host's
// base bundle must match that host's own value, unless it is listed below with
// a reason. This exists because a declarative preset row is a DEFINITION, not a
// patch: 0.6.0-0.6.2 shipped `tool-web: { fetch: false }` copied verbatim from
// the 0.5.3 agent plane, where the host plane's own fetch:true row won and the
// value was inert. On 0.2.0 the same value silently dropped web_fetch from every
// preset session, and no test noticed — the fidelity test pinned the dead value
// as if it were intent.
//
// Usage: DSH_HOST_REFERENCE_DIR=<installed host node_modules> node scripts/audit-host-rows.mjs
// T0 imports auditHostRows() and runs the same checks when a reference host is
// present; without one the whole audit reports SKIP rather than passing quietly.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { plugins, parsePlanSection } from '../npm-package/preset/preset.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Rows whose preset value may differ from the host base value. Every entry must
 * name what keeps the divergence honest; an unlisted divergence fails the audit.
 */
const DIVERGENCES = [
  {
    id: 'plan-mode',
    reason: 'the section text is inherited from the host base patch at mount time '
      + '(preset.js hostPlanSection → parsePlanSection); the shipped string is the 0.5.3 baseline '
      + 'used only when that read fails. The block-scalar cross-check below proves the inherited '
      + 'text is byte-identical to the host loader\'s own parse.',
  },
];

/**
 * Rows the host base ENABLES and dsh-web-app disables in web mode, which this
 * preset deliberately does not compose. For these the host hands the row to the
 * agent plane, so an omission removes the feature from every preset session and
 * must be a decision. Rows the base itself ships disabled (tool-ralph,
 * tool-plugin-manager) are the host's own default-off and need no entry here.
 */
const ABSENCES = [
  { id: 'command-goal', reason: 'the /goal command stays off; the goal tools themselves are composed' },
  { id: 'skill-filesystem', reason: 'the skill layer stays off, as in the 0.5.3 agent plane' },
  { id: 'tool-skill', reason: 'the skill layer stays off, as in the 0.5.3 agent plane' },
  { id: 'tool-subagent', reason: 'generic spawn stays off; only the six specialist role tools are exposed' },
  { id: 'tool-subagent-fork', reason: 'fork stays off; only the six specialist role tools are exposed' },
  { id: 'tool-workflow', reason: 'the workflow engine stays off, as in the 0.5.3 agent plane' },
  { id: 'workflow-ptc', reason: 'the workflow engine stays off, as in the 0.5.3 agent plane' },
];

/** Reference host node_modules root, or undefined when none is installed here. */
export function referenceHostDir() {
  if (process.env.DSH_HOST_REFERENCE_DIR) return resolve(process.env.DSH_HOST_REFERENCE_DIR);
  const sibling = join(root, '..', 'dsh-host-reference', 'dsh', 'node_modules');
  return existsSync(join(sibling, '@deepseek-ai')) ? sibling : undefined;
}

/** The `!!js` tag means the same thing to this audit as it does to the loader. */
const jsSchema = yaml.JSON_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: d => ({ __jsExpr: d }) }));

/** Rows of one bundle patch, flattened through `insert` and group children. */
function rowsOf(text) {
  const parsed = yaml.load(text, { schema: jsSchema });
  const out = [];
  const walk = (rows) => {
    for (const row of rows ?? []) {
      if (!row || typeof row !== 'object') continue;
      if (row.insert) { walk(row.insert); continue; }
      if (row.id) out.push(row);
      if (row.group && Array.isArray(row.config)) walk(row.config);
    }
  };
  walk(parsed);
  return out;
}

/** Flatten the preset's own rows the same way, without mutating the module data. */
function presetRows() {
  const out = [];
  const walk = (rows) => {
    for (const row of rows ?? []) {
      if (row.id) out.push(row);
      if (row.group && Array.isArray(row.config)) walk(row.config);
    }
  };
  walk(plugins);
  return out;
}

const sameConfig = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Compare the preset against an installed host's base and web-app bundles.
 * @param options.referenceDir - host node_modules root holding @deepseek-ai.
 * @returns { skipped } or { failures: string[], notes: string[] }.
 */
export function auditHostRows({ referenceDir } = {}) {
  if (!referenceDir) return { skipped: 'no reference host (set DSH_HOST_REFERENCE_DIR)' };
  const baseFile = join(referenceDir, '@deepseek-ai', 'dsh-base', 'cordis.patch.yml');
  const webFile = join(referenceDir, '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml');
  for (const file of [baseFile, webFile]) {
    if (!existsSync(file)) return { skipped: `reference host lacks ${file}` };
  }
  const failures = [];
  const notes = [];
  const summary = { same: 0, known: 0, off: 0, hostOff: 0, added: 0 };
  const baseText = readFileSync(baseFile, 'utf8');
  const base = rowsOf(baseText);
  const preset = presetRows();
  const baseById = new Map(base.map(row => [row.id, row]));
  const presetById = new Map(preset.map(row => [row.id, row]));
  const divergenceIds = new Set(DIVERGENCES.map(entry => entry.id));
  const absenceIds = new Set(ABSENCES.map(entry => entry.id));

  // 1. Shared ids: the preset must not silently re-value a host-owned row.
  for (const [id, hostRow] of baseById) {
    const own = presetById.get(id);
    if (!own) continue;
    if (sameConfig(hostRow.config, own.config)) {
      summary.same += 1;
      notes.push(`same    ${id}`);
      continue;
    }
    if (divergenceIds.has(id)) { summary.known += 1; notes.push(`known   ${id} (listed divergence)`); }
    else failures.push(`${id}: preset config ${JSON.stringify(own.config ?? null)} differs from host base ${JSON.stringify(hostRow.config ?? null)} — add it to DIVERGENCES with a reason, or adopt the host value`);
  }

  // 2. Rows the host hands to the agent plane in web mode: the base enables
  //    them, dsh-web-app disables them, and only a preset row can compose them.
  //    Rows the base already ships disabled stay the host's own default-off.
  const webDisabled = new Set(rowsOf(readFileSync(webFile, 'utf8')).filter(row => row.disabled === true).map(row => row.id));
  const handedOver = new Set();
  for (const id of webDisabled) {
    const hostRow = baseById.get(id);
    if (!hostRow) continue;
    if (hostRow.disabled === true) {
      summary[presetById.has(id) ? 'added' : 'hostOff'] += 1;
      notes.push(`${presetById.has(id) ? 'added ' : 'host-off'} ${id} (base ships it disabled)`);
      continue;
    }
    handedOver.add(id);
    if (presetById.has(id)) continue;
    if (absenceIds.has(id)) { summary.off += 1; notes.push(`off     ${id} (listed absence)`); }
    else failures.push(`${id}: the host hands this row to the agent plane in web mode and the preset does not compose it — add it to ABSENCES with a reason, or compose the row`);
  }

  // 3. The inherited plan-mode text must stay byte-identical to the host's own
  //    parse; a host that changes the YAML form must fail here, not silently
  //    fall back to the baseline.
  const hostSection = baseById.get('plan-mode')?.config?.section;
  const inherited = parsePlanSection(baseText);
  if (typeof hostSection !== 'string' || hostSection.trim() === '') {
    failures.push('plan-mode: the reference host base patch carries no plan-mode section to inherit');
  } else if (inherited !== hostSection) {
    failures.push('plan-mode: parsePlanSection() no longer reproduces the host base value — the inheritance would silently mount the 0.5.3 baseline');
  } else {
    notes.push(`inherited plan-mode section matches the host parse (${createHash('sha256').update(inherited).digest('hex').slice(0, 12)})`);
  }

  // 4. A listed absence or divergence that no longer exists is stale bookkeeping.
  for (const entry of ABSENCES) {
    if (!handedOver.has(entry.id) || presetById.has(entry.id)) {
      failures.push(`${entry.id}: listed in ABSENCES but the host no longer hands it to the agent plane (or the preset now composes it) — drop the entry`);
    }
  }
  for (const entry of DIVERGENCES) {
    const own = presetById.get(entry.id);
    if (!own || !baseById.has(entry.id) || sameConfig(baseById.get(entry.id).config, own.config)) {
      failures.push(`${entry.id}: listed in DIVERGENCES but there is no live divergence — drop the entry`);
    }
  }

  return { failures, notes, summary, base, preset };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const result = auditHostRows({ referenceDir: referenceHostDir() });
  if (result.skipped) {
    console.log(`SKIP host-row audit: ${result.skipped}`);
  } else {
    for (const note of result.notes) console.log('  ' + note);
    const shared = result.base.filter(row => result.preset.some(own => own.id === row.id)).length;
    console.log(`\nhost rows ${result.base.length}, preset rows ${result.preset.length}, shared ids ${shared}`);
    for (const failure of result.failures) console.log('FAIL ' + failure);
    console.log(result.failures.length === 0 ? '\nHOST ROW AUDIT OK' : `\nHOST ROW AUDIT FAILED (${result.failures.length})`);
    process.exit(result.failures.length === 0 ? 0 : 1);
  }
}

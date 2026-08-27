// Zero-cost test for the settings-namespace schema (settings-schema.js),
// built with the REAL host schemastery (resolved through the dev-time
// node_modules symlink). Locks the contract the seeder registers and the
// legacy-JSON import relies on.
import { readFileSync } from 'node:fs';
import z from '@deepseek-ai/schemastery';

import { SETTINGS_NS, buildSettingsSchema } from '../settings-schema.js';
import { ROLE_IDS } from '../config-loader.js';

const schema = buildSettingsSchema(z);
let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

if (SETTINGS_NS === 'oh-my-dsh-slim') check(true, 'namespace is the kebab-case id the seeder registers');
else check(false, `unexpected namespace: ${SETTINGS_NS}`);

console.log('\n[accepts the documented user-intent shape]');
const valid = schema({
  presets: {
    'my-dsh-normal': {
      librarian: { model: 'user-model', effort: 'medium', mcps: ['context7'] },
      observer: { enabled: true },
    },
  },
  advanced: { roles: { librarian: { maxTokens: 12345, temperature: 0.25 } } },
  mcpServers: {
    custom: { transport: 'streamable-http', url: 'https://example.test/mcp' },
  },
});
check(valid.presets['my-dsh-normal'].librarian.model === 'user-model', 'valid document resolves');
check(valid.advanced.roles.librarian.maxTokens === 12345, 'advanced role overrides resolve');

console.log('\n[value domains]');
const attempts = [
  [{ presets: { x: { oracle: { effort: 'bogus' } } } }, /effort/, 'effort enum enforced'],
  [{ presets: { x: { oracle: { deny: ['not-a-tool'] } } } }, /deny|expected/, 'tool names validated in deny'],
  [{ mcpServers: { x: { transport: 'carrier-pigeon' } } }, /transport/, 'MCP transport enum enforced'],
  [{ presets: { x: { oracle: { maxTokens: 'lots' } } } }, /maxTokens|number|expected/, 'maxTokens must be a number'],
];
for (const [doc, match, label] of attempts) {
  try {
    schema(doc);
    check(false, `${label} (accepted a bad document)`);
  } catch (error) {
    check(match.test(error.message), `${label}: ${error.message.split('\n')[0]}`);
  }
}

console.log('\n[forward compatibility and layer semantics]');
const extra = schema({ futureSection: { anything: true }, presets: { x: { oracle: { brandNewField: 1 } } } });
check(extra.presets.x.oracle.brandNewField === 1, 'extra keys pass through (forward-compatible)');
// Schemastery resolves container-typed keys to EMPTY containers and leaves
// scalar keys absent. Both are merge-safe: config-loader only reads
// user.preset / user.presets?.[name] / user.mcpServers / user.advanced?.roles,
// and every one of those treats an empty container as "no overrides".
const empty = schema({});
check(
  Object.keys(empty).every((key) => ['presets', 'mcpServers', 'advanced'].includes(key))
    && empty.presets && Object.keys(empty.presets).length === 0
    && empty.preset === undefined,
  'empty document resolves to merge-safe empty containers (no injected scalar defaults)',
);
const observerDoc = schema({ presets: { x: { observer: { enabled: true } } } });
check(observerDoc.presets.x.observer.enabled === true, 'observer enabled:true passes the SCHEMA (force-lock lives in config-loader, not here)');

console.log('\n[every default role has a schema slot]');
const defaults = JSON.parse(readFileSync(new URL('../defaults.json', import.meta.url), 'utf8'));
const roster = Object.keys(defaults.presets[defaults.preset]).filter((id) => id !== 'orchestrator');
check(
  ROLE_IDS.every((id) => roster.includes(id)) && roster.length === ROLE_IDS.length,
  `defaults roster matches ROLE_IDS: ${roster.join(', ')}`,
);
for (const roleId of roster) {
  const role = defaults.presets[defaults.preset][roleId];
  try {
    schema({ presets: { [defaults.preset]: { [roleId]: { model: role.model, effort: role.effort, enabled: role.enabled } } } });
    check(true, `${roleId}: bundled defaults satisfy the schema`);
  } catch (error) {
    check(false, `${roleId}: bundled defaults rejected by schema: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nSETTINGS SCHEMA: ALL CHECKS PASSED' : `\nSETTINGS SCHEMA: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

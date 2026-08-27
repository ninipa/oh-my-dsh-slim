// Zero-cost configuration loader test. Verifies user overrides are merged by
// role id and that hidden runtime defaults remain available after model/token
// changes.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resetConfigForTests } from '../config-loader.js';

const home = mkdtempSync(join(tmpdir(), 'oh-my-dsh-slim-config-'));
const path = join(home, 'oh-my-dsh-slim.json');
writeFileSync(path, JSON.stringify({
  preset: 'custom',
  presets: {
    custom: {
      librarian: {
        model: 'user-model',
        effort: 'medium',
        mcps: ['context7'],
        tools: ['read', 'glob', 'grep', 'web_search']
      },
      observer: {
        enabled: true
      }
    }
  },
  advanced: { roles: { librarian: { maxTokens: 12345, temperature: 0.25 } } }
}));

const previous = process.env.OH_MY_DSH_SLIM_CONFIG;
process.env.OH_MY_DSH_SLIM_CONFIG = path;
resetConfigForTests();
try {
  const config = loadConfig();
  const librarian = config.roles.librarian;
  if (librarian.model !== 'user-model' || librarian.effort !== 'medium' || librarian.maxTokens !== 12345 || librarian.temperature !== 0.25) {
    throw new Error(`override did not merge by role id: ${JSON.stringify(librarian)}`);
  }
  if (config.roles.oracle.maxTokens !== 128000 || config.roles.oracle.temperature !== 0.1) {
    throw new Error('unmodified roles lost bundled runtime defaults');
  }
  // Soft-disable: observer is force-locked off even when a user flips it on.
  if (config.roles.observer.enabled !== false) {
    throw new Error(`observer force-disable broken: ${JSON.stringify(config.roles.observer.enabled)}`);
  }
  for (const roleId of ['oracle', 'designer', 'fixer', 'explorer', 'librarian']) {
    if (config.roles[roleId].enabled !== true) {
      throw new Error(`role "${roleId}" lost default enabled=true`);
    }
  }
  console.log('observer force-lock + enabled defaults verified');
  console.log('CONFIG LOADER: ALL CHECKS PASSED');
} finally {
  if (previous === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
  else process.env.OH_MY_DSH_SLIM_CONFIG = previous;
  resetConfigForTests();
  rmSync(home, { recursive: true, force: true });
}

// Error paths fail loud with actionable messages.
function expectLoadError(label, body, match) {
  const errHome = mkdtempSync(join(tmpdir(), 'oh-my-dsh-slim-err-'));
  const errPath = join(errHome, 'oh-my-dsh-slim.json');
  writeFileSync(errPath, body);
  const prevEnv = process.env.OH_MY_DSH_SLIM_CONFIG;
  process.env.OH_MY_DSH_SLIM_CONFIG = errPath;
  resetConfigForTests();
  try {
    loadConfig();
    throw new Error(`${label}: expected loadConfig to throw`);
  } catch (error) {
    if (!match.test(error.message)) throw new Error(`${label}: unexpected error: ${error.message}`);
    console.log(`  PASS  ${label}`);
  } finally {
    if (prevEnv === undefined) delete process.env.OH_MY_DSH_SLIM_CONFIG;
    else process.env.OH_MY_DSH_SLIM_CONFIG = prevEnv;
    resetConfigForTests();
    rmSync(errHome, { recursive: true, force: true });
  }
}
console.log('\n[error paths]');
try {
  expectLoadError('malformed user JSON', '{oops', /invalid JSON configuration/);
  expectLoadError('unknown preset name', JSON.stringify({ preset: 'nope' }), /unknown preset "nope"/);
  expectLoadError(
    'mcps references unknown server',
    JSON.stringify({ presets: { 'my-dsh-normal': { librarian: { mcps: ['ghost'] } } } }),
    /unknown MCP server/,
  );
} finally {
  resetConfigForTests();
}

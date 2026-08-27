// Diagnostic: exercise the shareable role-subagent plugin with a mock DSH
// context and capture the request sent to startContinuable. This validates the
// JSON/roleId path without starting an LLM run or connecting to an MCP server.
// Usage: node scripts/diag-subagent-config.mjs

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Expected route comes from the bundled defaults.json (single source of truth).
const bundledDefaults = JSON.parse(readFileSync(join(projectRoot, 'defaults.json'), 'utf8'));
const expectedRoute = bundledDefaults.presets[bundledDefaults.preset].librarian;

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function resolveDshPackage() {
  const roots = [];
  const dshHome = process.env.DSH_HOME;
  if (dshHome) {
    roots.push(join(dshHome, 'profiles', 'node_modules'));
    roots.push(join(dshHome, 'profiles', 'web', 'node_modules'));
  }

  // The profile install is the authoritative dependency source for GUI DSH;
  // global roots cover CLI-only installs and shareable preset development.
  for (const root of [
    commandOutput('npm', ['root', '--global']),
    commandOutput('zsh', ['-lic', 'npm root --global']),
  ]) {
    if (root) roots.push(root);
  }

  const dshCommand = commandOutput('command', ['-v', 'dsh']);
  if (dshCommand) {
    try {
      const bin = realpathSync(dshCommand);
      // .../@deepseek-ai/dsh/lib/bin.js -> .../node_modules
      roots.push(dirname(dirname(dirname(dirname(bin)))));
    } catch {
      // Continue with the explicit roots below.
    }
  }
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');

  const uniqueRoots = [...new Set(roots.filter(Boolean))];
  const root = uniqueRoots.find((candidate) => existsSync(join(candidate, '@deepseek-ai', 'dsh', 'package.json')));
  if (!root) {
    throw new Error([
      'Cannot locate @deepseek-ai/dsh.',
      'Set DSH_HOME to a DSH home or run this script on a host with DSH installed.',
      `Searched: ${uniqueRoots.join(', ') || '(no roots)'}`,
    ].join(' '));
  }
  return join(root, '@deepseek-ai', 'dsh', 'package.json');
}

const dshPackage = resolveDshPackage();
const dshRequire = createRequire(dshPackage);
const rolePlugin = await import(pathToFileURL(join(projectRoot, 'role-subagent.js')).href);

let capturedRequest;
let capturedTool;
let capturedChildSetup;
const mockProvider = {
  name: 'spawn',
  capabilities: { depthLimit: true },
  inheritsParentContext: true,
  prepareContinuable: async () => ({ seed: [] }),
};

const ctx = {
  tools: {
    register(definition) {
      capturedTool = definition;
      return () => {};
    },
    get() { return undefined; },
  },
  subagents: {
    getProvider(name) { return name === 'spawn' ? mockProvider : undefined; },
    registerContinuableSetup(setup) { capturedChildSetup = setup; return () => {}; },
    async startContinuable(spec) {
      capturedRequest = spec.request;
      return { childId: 'mock-child' };
    },
    async start() { throw new Error('unexpected foreground start'); },
  },
  systemPrompt: { section() {} },
  on() {},
  logger: { info() {}, warn() {} },
  get() { return undefined; },
};

rolePlugin.apply(ctx, {
  provider: 'spawn',
  roleId: 'librarian',
  toolName: 'subagent_librarian',
  description: 'Diagnostic librarian role.',
  backgroundMode: 'continuable',
  maxDepth: 1,
  // This fallback is intentionally different from the JSON role defaults. The
  // plugin must resolve the model, token budget, and deny policy by stable roleId.
  agentOptions: { provider: 'custom-provider', model: 'custom-model', maxTokens: 12345 },
  persona: 'You are a diagnostic librarian.',
  toolFilter: { deny: ['skill'] },
});

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

assert(capturedTool, 'role-subagent tool was not registered');
assert(typeof capturedChildSetup === 'function', 'Librarian MCP child setup was not registered');

const result = await capturedTool.execute(
  { description: 'diag', prompt: 'Capture the custom role request.' },
  { agent: { id: 'parent-agent' }, signal: new AbortController().signal },
);

assert(result.kind === 'continuable', `unexpected execute result: ${JSON.stringify(result)}`);
assert(capturedRequest?.agentOptions?.dshRoleId === 'librarian', 'stable dshRoleId was not forwarded');
assert(capturedRequest?.agentOptions?.provider === expectedRoute.provider, 'role provider did not come from JSON defaults');
assert(capturedRequest?.agentOptions?.model === expectedRoute.model, 'role model did not come from JSON defaults');
assert(capturedRequest?.agentOptions?.maxTokens === 48000, 'role maxTokens did not come from JSON defaults');
assert(capturedRequest?.toolFilter?.allow === undefined, 'role toolFilter should use deny-only OMO semantics');
assert(capturedRequest?.toolFilter?.deny?.includes('edit'), 'role deny filter did not come from JSON defaults');
assert(capturedRequest?.persona?.includes('oh-my-dsh-slim-role:librarian'), 'stable role marker missing from persona');

console.log('DSH package:', dshPackage);
console.log('execute result kind:', result.kind);
console.log('captured request keys:', Object.keys(capturedRequest ?? {}).join(', '));
console.log('request.agentOptions:', JSON.stringify(capturedRequest?.agentOptions));
console.log('request.toolFilter:', JSON.stringify(capturedRequest?.toolFilter));
console.log('request.maxDepth:', capturedRequest?.maxDepth);
console.log('PASS: custom role-subagent request resolved by roleId');

// Keep the imported require available in diagnostics so an installation with a
// profile-only dependency tree is exercised before the script exits.
assert(typeof dshRequire.resolve === 'function', 'DSH package resolver is unusable');

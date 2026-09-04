// probe-profile-snapshots — zero-model-cost smoke for multi-preset profiles.
//
// Replaces the stock headless runner; NEVER sends a model request. Boots the
// composed tree (agent-presets inserted by the matching patch), then for every
// preset directory in the probe home: (1) composes it as a standing mount — a
// profile directory with a broken composition or missing plugin fails HERE —
// and (2) reads the preset's OWN config-loader and prints its effective role
// configuration. Custom profiles must show the snapshot channel; the bundled
// preset must show its original channel (settings/bundled) and the bundled
// defaults must never leak into a profile or vice versa.
//
// The verdict is a single JSON document on stdout; the exit code is 0 when the
// driver's expectations (see scripts/smoke-profile-presets.mjs) hold.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Same dependency resolution as ../role-subagent.js: a plugin file outside the
// harness tree cannot bare-import @deepseek-ai/*, so resolve them from the
// installed DSH package (the same install the `dsh` CLI runs).
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
    roots.push(dirname(dirname(dirname(dirname(dshBin)))));
  } catch {}
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));
  roots.push('/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules');
  const root = roots.find((candidate) => existsSync(join(candidate, '@deepseek-ai/dsh/package.json')));
  if (!root) throw new Error('probe-profile-snapshots: cannot locate the DSH node_modules; set DSH_HOME or run inside DSH');
  return join(root, '@deepseek-ai/dsh/package.json');
}

const require = createRequire(resolveDshPackage());

export const name = 'probe-profile-snapshots';
export const inject = ['agentPresets', 'settings'];

export function apply(ctx) {
  const exit = ctx.get('appExit');
  if (exit === void 0) throw new Error('probe-profile-snapshots: the launcher must provide ctx.appExit');
  run(ctx).then(
    (code) => exit(code),
    (error) => {
      process.stderr.write(`probe-profile-snapshots failed: ${error?.stack ?? String(error)}\n`);
      exit(1);
    },
  );
}

async function run(ctx) {
  await ctx.get('loader')?.await();
  const presets = ctx.get('agentPresets');
  if (presets === void 0) {
    process.stderr.write('probe-profile-snapshots: agentPresets service not mounted (patch missing?)\n');
    return 1;
  }
  const report = { presets: [], errors: [] };
  const rows = await presets.list();
  // Only presets this package owns carry config-loader.js + profile.json;
  // the roster also contains DSH's own shipped presets (standard/code/…),
  // which must not be judged here — they are not ours to configure.
  const owns = (id) => id === 'oh-my-dsh-slim' || id.startsWith('profile-');
  report.presets = [];
  for (const preset of rows.filter((preset) => owns(preset.id))) {
    const dir = dirname(preset.path);
    const entry = {
      id: preset.id,
      name: typeof preset.name === 'string' ? preset.name : preset.id,
      isDefault: preset.id === presets.defaultId,
      mountable: false,
    };
    try {
      const standing = await presets.standingKeyFor(preset.id);
      entry.mountable = standing !== void 0;
    } catch (error) {
      entry.mountError = error?.message ?? String(error);
      report.errors.push(`${preset.id}: mount failed: ${entry.mountError}`);
    }
    try {
      const mod = await import(pathToFileURL(join(dir, 'config-loader.js')).href);
      const config = mod.loadConfig(ctx);
      entry.source = config.source;
      entry.fixerModel = config.roles.fixer.model;
      entry.fixerEffort = config.roles.fixer.effort;
      entry.profileId = config.profileId;
    } catch (error) {
      entry.loadError = error?.message ?? String(error);
      report.errors.push(`${preset.id}: config load failed: ${entry.loadError}`);
    }
    report.presets.push(entry);
  }
  console.log(JSON.stringify(report, null, 2));
  return report.errors.length > 0 ? 1 : 0;
}

// Locate the js-yaml the installed DSH profile uses, so the layout tests parse
// bundle patches with the same dialect (JSON schema plus the `!!js` tag) the
// host itself uses.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const candidates = [];
try { candidates.push(require.resolve('js-yaml')); } catch {}
if (process.env.DSH_PROFILE_DIR) candidates.push(join(process.env.DSH_PROFILE_DIR, 'node_modules', 'js-yaml', 'index.js'));
if (process.env.DSH_HOME) candidates.push(join(process.env.DSH_HOME, 'profiles', 'desktop', 'node_modules', 'js-yaml', 'index.js'));
if (process.env.USERPROFILE) candidates.push(join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'node_modules', 'js-yaml', 'index.js'));

const found = candidates.find((candidate) => existsSync(candidate));
if (found === undefined) {
  throw new Error('js-yaml was not found; set DSH_PROFILE_DIR to an installed DSH profile to run the layout tests');
}
export default (await import(pathToFileURL(found).href)).default;

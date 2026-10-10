// Declarative-line host probe (0.6.x): what a real host actually exposes.
//
// This is a row module, not a standalone script: the loader mounts it, so it
// runs inside the host process with real services. Insert it through a profile
// patch and read its one JSON line from the host log:
//
//   # profiles/<name>/cordis.patch.yml
//   - insert:
//       - id: probe-declarative-host
//         name: 'file:///absolute/path/to/scripts/probe-declarative-host.mjs'
//
//   DSH_HOME=<scratch> dsh web --no-open --host 127.0.0.1 --port 0
//
// It reports the preset roster (and any `broken` row), whether this package's
// native settings entry is described, and how many client-module sources the
// host composes for the package (a full web host must see exactly one).
// Reading through `ctx.inject([...])` is deliberate: cordis resolves services
// through the caller's isolate map, so `ctx.get(name)` alone returns undefined.
// Declarations activate asynchronously (the companion has a top-level await), so
// the probe waits before reading; an early read reports an empty roster.
export const name = 'probe-declarative-host';

const NS = 'oh-my-dsh-slim';

function methodsOf(service) {
  if (service === null || service === undefined) return [];
  const found = new Set();
  let proto = Object.getPrototypeOf(service);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof service[key] === 'function') found.add(key);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...found].sort();
}

export function apply(ctx) {
  setTimeout(() => {
    ctx.inject(['agentPresets', 'settings', 'clientModules'], async (child) => {
      const out = { package: NS };
      try {
        const roster = await child.agentPresets.list();
        out.roster = roster.map((row) => `${row.id}${row.broken ? '!BROKEN' : ''}`);
        out.presetPresent = roster.some((row) => row.id === NS && !row.broken);
      } catch (error) { out.rosterError = String(error?.message ?? error); }
      try {
        const rows = await child.settings.describe();
        const mine = rows.find((row) => (row?.ns ?? row?.id) === NS);
        out.settingsRows = rows.length;
        out.settingsEntry = mine ? Object.keys(mine.value ?? {}).slice(0, 8) : null;
      } catch (error) { out.settingsError = String(error?.message ?? error); }
      try {
        const graph = child.clientModules.graph();
        const matches = [];
        const visit = (value, path) => {
          if (typeof value === 'string') {
            if (value.includes(NS)) matches.push(`${path}=${value.slice(0, 120)}`);
            return;
          }
          if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${path}[${index}]`));
          if (value && typeof value === 'object') {
            for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`);
          }
        };
        visit(graph, 'graph');
        out.clientEntries = matches.filter((line) => line.includes('.id=')).length;
        out.clientSources = matches;
      } catch (error) { out.clientModulesError = String(error?.message ?? error).slice(0, 200); }
      out.clientModulesMethods = methodsOf(child.clientModules).length;
      console.log('PROBE_DECLARATIVE_HOST ' + JSON.stringify(out, null, 1));
    });
  }, Number(process.env.OMDS_PROBE_DELAY_MS ?? 12000));
}

// Host-line shapes shared by the opt-in smokes.
//
// DSH 0.2.2-rc.2 flattened the activation spec: `parent`, `prompt`, and
// `maxDepth` moved out of `spec.request` to the top level. The same release
// renamed the model-facing delegation result from a Session id to an agent
// name. The smokes run once per verified host line, so they build the spec for
// the host under test instead of pinning either shape.

/** Parse a version and report whether activations use the flat spec. */
function flatActivation(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version ?? '');
  if (match === null) return false;
  const core = [Number(match[1]), Number(match[2]), Number(match[3])];
  const floor = [0, 2, 2];
  for (let i = 0; i < 3; i++) {
    if (core[i] !== floor[i]) return core[i] > floor[i];
  }
  if (match[4] === undefined) return true; // 0.2.2 stable and later patches
  const rc = /^rc\.(\d+)$/.exec(match[4]);
  return rc !== null && Number(rc[1]) >= 2; // 0.2.2-rc.2+
}

/**
 * Read the installed host version and return the matching spec shaper.
 * @param requireHost - createRequire() anchored at the host entry.
 */
function hostShapes(requireHost) {
  let version;
  try { version = requireHost('@deepseek-ai/dsh/package.json').version; } catch { version = undefined; }
  const flat = flatActivation(version);
  return {
    version,
    flat,
    activationSpec: spec => flat
      ? { provider: spec.provider, label: spec.label, ...spec.request, signal: spec.signal, delivery: spec.delivery }
      : spec,
  };
}

module.exports = { flatActivation, hostShapes };

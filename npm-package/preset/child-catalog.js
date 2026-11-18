// child-catalog.js — map a model-facing child name back to its Session id.
//
// DSH 0.2.2-rc.2 started naming children (`agent-1`) and returning that name
// from the delegation tool instead of the Session id. The parent-owned
// `subagent/catalog` event records both identities at creation
// (`{ version, childId, childCreatedAt, label, name, ... }`), so the mapping is
// available from the live parent Session without the `sessionQuery` service.
// Reading it here keeps the running-lane ledger and `subagent_result` working
// in profiles that disable session-query; hosts that predate names simply have
// no matching entry and keep their id-shaped path.

/**
 * Read the child Session id recorded for one model-facing name.
 * @param agent - the exact parent Agent that owns the catalog.
 * @param name - the name the delegation result carried.
 * @returns the child Session id, or undefined when the catalog has no match.
 */
export function childIdForName(agent, name) {
  if (typeof name !== 'string' || name.length === 0) return void 0;
  const session = agent?.session;
  const events = typeof session?.ownEvents === 'function' ? session.ownEvents()
    : typeof session?.snapshotEvents === 'function' ? session.snapshotEvents(session.inheritedEventCount ?? 0)
      : Array.isArray(session?.events) ? session.events.slice(session.inheritedEventCount ?? 0) : [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type !== 'subagent/catalog') continue;
    const { childId, name: entryName } = event.data ?? {};
    if (entryName === name && typeof childId === 'string') return childId;
  }
  return void 0;
}

export default { childIdForName };

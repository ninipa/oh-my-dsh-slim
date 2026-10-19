// preset/role-ids.js — the single role roster.
//
// Dependency-free on purpose: preset/config.js, preset/roles.js and
// lib/config-settings.js all import it, and config-settings.js is imported by
// config.js, so a shared module is what keeps the settings schema from
// drifting behind the roles the preset actually mounts.
//
// The client bundle cannot import Node modules; it keeps a literal copy and
// test/package.test.mjs pins the two lists together.

/** Specialist roles shipped since the 0.1.x line. */
export const UPSTREAM_ROLE_IDS = Object.freeze(['oracle', 'designer', 'fixer', 'explorer', 'librarian', 'observer']);

/** Council seats. Fixed roster in 0.8.0; dynamic seats are a later plan. */
export const COUNCILLOR_ROLE_IDS = Object.freeze(['councillor-alpha', 'councillor-beta', 'councillor-gamma']);

/** The synthesis-only council agent. Active when >= 2 seats are enabled. */
export const COUNCIL_ROLE_ID = 'council';

/** The council family: three seats plus the synthesizer. */
export const COUNCIL_ROLE_IDS = Object.freeze([...COUNCILLOR_ROLE_IDS, COUNCIL_ROLE_ID]);

/** Every role, in presentation and registration order. */
export const ROLE_IDS = Object.freeze([...UPSTREAM_ROLE_IDS, ...COUNCILLOR_ROLE_IDS, COUNCIL_ROLE_ID]);

/** Minimum enabled seats for a council: one seat is an ordinary delegation. */
export const MIN_COUNCIL_SEATS = 2;

export function isCouncillorRoleId(roleId) {
  return COUNCILLOR_ROLE_IDS.includes(roleId);
}

export function isCouncilRoleId(roleId) {
  return roleId === COUNCIL_ROLE_ID || isCouncillorRoleId(roleId);
}

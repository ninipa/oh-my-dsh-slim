# Changelog

All notable changes to oh-my-dsh-slim. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions match npm
package releases where applicable.

## [0.1.1] — 2026-08-24

### Added

- npm package (`oh-my-dsh-slim`) with a preset seeder: installing via
  `dsh plugin --profile web add oh-my-dsh-slim` (or the plugin marketplace)
  materializes the full preset into `$DSH_HOME/.agent-presets/oh-my-dsh-slim`
  automatically, with timestamped backups on upgrade
- Runtime model validation: at delegation time the configured model id is
  checked against the providers imported in **Settings → Models**; unknown
  models fail loud listing every imported model and the vision-capable subset
- `enabled` flag per role (soft-disable): roles can be turned off from the user
  JSON without deleting any code; disabled roles mount nothing and their
  routing blurb disappears from the system prompt
- `examples/omo-probe-baseline` — baseline project used by the T3 acceptance task
- Upgrade probes: `probe-capabilities` (model-modality overview) and
  `probe-session-query` (composition boot + per-role filter validation), both
  zero-cost, intended as a pre-GUI checklist after every DSH upgrade

### Fixed

- Compatibility with DSH 0.1.1-rc.2: `tools.restrict()` now rejects unknown
  filter names, so role filters are fitted against the live registry at
  delegation time (previously shipped deny lists could break every child spawn)
- Cold-resumed subagents keep their role temperature/effort (previously
  classified as top-level and reset to defaults)

### Changed

- observer role is reserved but force-disabled in this release (pasted images
  cannot reach subagents yet — see README "Known limits")
- Documentation: bilingual README (English default, 简体中文), CLI install
  caveat for custom-home deployments, marketplace install instructions

## [0.1.0] — 2026-08-22

### Added

- Initial public release: orchestrator + 5 specialist roles
  (oracle/designer/fixer/explorer/librarian), background-first continuable
  delegation with settlement notices, `subagent_result` read-only retrieval,
  librarian-scoped context7/gh_grep MCP, deny-only tool permissions,
  JSON-driven configuration with schema

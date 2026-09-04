# Changelog

All notable changes to oh-my-dsh-slim. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions match npm
package releases where applicable.

## [0.5.0] — 2026-09-04

> **Requires DSH 0.1.2-rc.1 or newer.** DSH changed substantially in 0.1.2; this release is
> **not compatible with older DSH versions** — on DSH 0.1.1 or below, stay on 0.4.0.
> **Upgrading requires a DSH restart** (plugin code mounts once per host process).

### Changed

- **Target DSH 0.1.2**: adapt to the removal of `registerContinuableSetup` (agent/created
  observer rework), retire the preset's own `web_fetch` layer and the `web-fetch-gate` plugin
  (the host ships `web_fetch` with SSRF protection since 0.1.2), and read the settings card's
  model list from the host's remote model catalog
- **Delegation discipline tightened from real-session observations** (multi-model GUI runs):
  delegation ownership rule (`self-first`/`delegate-first`, no overlapping re-work inside a
  running lane's scope), foreground runs only on explicit user request, end the turn with a
  brief status note after dispatching background lanes, treat interim reports as "not settled"
- **Delegation lifecycle driven by live host events**: the early-close ledger is updated
  synchronously from `agent/inbox/inserted` (host vocabulary `agent-message` relay vs
  `subagent-settled` notice) with settled-child tombstones; the render scan remains only for
  cold recovery
- **Orchestrator persona aligned with oh-my-opencode-slim 2.2.18**: adds Todo continuity,
  Scope check before writing (compare running-lane scopes before dispatching writers or editing
  locally; interrupt is not rollback; a cancelled generation does not cancel required
  validation), a Delegation contract (every delegation names a validation owner and scope),
  a Verify step (reconcile all writer lanes before final validation; reuse still-valid
  evidence), and a Communication section (clarity over assumptions, concise execution,
  no flattery, honest pushback)
- **"Decision point" reminder rewritten**: after dispatching, end the turn with a brief status
  note; keep the turn only to dispatch further independent lanes — never redo the delegated
  scope
- **`run_in_background` parameter schema aligned with the strict foreground rule**: the host
  stock wording ("Set false when your next action depends on it") intermittently pulled models
  into foreground runs against the discipline; the schema now repeats the strict rule and is
  guarded by unit tests. Note: plugin code changes require a **DSH restart** to take effect
- **Effort dropdown scoped to the selected model's declared reasoning efforts** (from the host
  model catalog): unsupported levels are hidden, explicit mismatches warn inline and block save
  (the DeepSeek adapter accepts `off/low/high/max`; `medium` is rejected upstream)
- **GUI-TEST-TASKS.md rewritten as a user-facing self-test list** (T1–T7: routing, scheduling
  and integration scenarios with prompts and expected behavior; T3 uses the bundled
  `examples/omo-probe-baseline`)

### Added

- **Old-host compatibility guards** (0.5.0-14): the npm package declares `engines.dsh` and
  optional lockstep `peerDependencies` on every touched `@deepseek-ai/dsh-*` package (the
  marketplace and dsh-market render these as the plugin's DSH requirement and can filter
  mismatches); the seeder detects the running DSH version and, below the floor, stays fully
  inert — it never touches an existing preset directory, keeps the settings channel alive, and
  registers a compatibility notice page under Settings → Plugins; the preset plugins fail fast
  with a readable error instead of mounting half-working on old hosts
- **Host-contract probe battery** (`scripts/run-host-probes.mjs`): 8 probes / 9 phases against
  a real DSH 0.1.2 host with the real preset mounted — zero model calls, no credentials;
  the standing smoke after every DSH upgrade (see `scripts/TEST-INVENTORY.md` for the pinned
  host facts)
- New unit suites: settings schema, sandbox-strip helpers, early-close ledger state machine,
  preset seeder state machine, `/omds` profile RPC endpoints, and the settings-card client
  bundle (including the per-model effort regression)

## [0.4.0] — 2026-09-02

### Added

- **Multiple named configurations (multi-preset)**. The settings card's top
  row is now a **Delegation configuration** dropdown managing named
  configurations; each configuration is a real native agent preset created
  through the seeder's `/omds` profile RPCs (`profile-list` /
  `profile-create` / `profile-save` / `profile-set-default`):
  - "＋ New configuration" edits an in-place draft copied from the
    configuration being edited; nothing is persisted until **Save**, which
    asks for a display name only (the internal id is derived from the name and
    never changes).
  - A saved configuration materializes as
    `$DSH_HOME/.agent-presets/profile-<prefix>-<hash>/` (whole-directory copy
    of the bundled preset) plus its own `profile.json` snapshot, so
    configurations are isolated from each other and from the bundled one; the
    per-preset snapshot is the sole config source for that preset (verified by
    unit tests and a real-host standing-mount smoke with two profiles).
  - **Set as default for new sessions** writes DSH's native agent-presets
    default setting — the same write the Agent preset picker performs, so the
    card and the picker always agree. Only new sessions are affected.
  - Bundle: the bundled profile (`极简角色委派`) keeps its settings-namespace
    channel unchanged; custom profiles never read the global channels.
  - Failure safety: a profile creation that fails validation or writing rolls
    the copied directory back (no half-authored roster entries); saves carry
    an `expectedRevision` fence so two concurrent writers cannot silently
    overwrite each other.
- **Profile RPC endpoints unit-tested end to end**
  (`scripts/test-profile-rpc.mjs`: list/create/save/rename/set-default, plus
  every failure path) and the card helpers/extensions covered by the client
  card test (roster normalization, name validation, snapshot serialization,
  RPC adapter, sentinel dropdown).

### Fixed

- **A profile created FROM another profile silently inherited the bundled
  defaults except the edited field.** The create flow serialized the draft
  against the *source profile's* effective values, so every field it inherited
  was dropped as "no difference"; the new profile then resolved against the
  bundled defaults (its actual base) and showed only the one edited field
  (reported on the GUI as "saved flash-fixer, got default content"). The
  create snapshot now serializes against the new profile's own base
  (`bundled defaults ⊕ {}`), fixing the snapshot to the full copied
  configuration. A regression test asserts the old baseline drops inherited
  fields (it fails against the old code).
- **Settings card opened on the bundled profile instead of the new-session
  default.** The dropdown now opens on the new-session default once the roster
  is loaded, never overriding a manual selection, and falls back to the
  bundled profile when the roster is unavailable.
- **The bundled profile had no "Set as default for new sessions" entry** (the
  action was shown only for non-default custom profiles), making it impossible
  to switch the default back; the action now appears for every non-default
  profile (including the bundled one) but never for the new-config draft.
- **Redundant selected-name badge** beside the dropdown removed (the dropdown
  already shows the selection, including the "new-session default" marker).

## [0.3.5] — 2026-09-01

### Fixed

- **Preset could hang at load when zsh is installed (`zsh -lic "npm root -g"`
  probe)**. All five preset plugins resolve the host DSH install by probing
  `npm root -g`, falling back to `zsh -lic "npm root -g"`. A login+interactive
  zsh sources the user's shell config and can hang (reported on Linux,
  zsh 5.5.1-6.el8.2: the 极简角色委派 preset mode became unusable while
  standard mode kept working — these probes only run inside the preset
  plugins). `execSync` had no timeout, so a hanging zsh blocked the plugin
  mount indefinitely. Fix: every probe is now bounded (2 s timeout, child
  killed on expiry), silent on stderr (the `/bin/sh: zsh: 未找到命令` noise
  when zsh is absent is gone), and the zsh fallback only runs when plain
  `npm root -g` fails (first success wins). The same hardening applies to the
  `command -v dsh` probe and the shipped diagnostic scripts. Verified:
  timeout kills a hung child (ETIMEDOUT at ~2 s), T0 gained a static guard
  (bounded probes enforced for all five plugins), full unit battery green.


## [0.3.4] — 2026-09-01

### Added

- **`effort: "none"` — per-role opt-out of the `reasoningEffort` parameter**
  (settings card + schema + runtime). Local LLMs (e.g. Llama/Qwen served
  without a reasoning-effort field) reject `reasoningEffort` and break
  delegation (reported as issue #2). Previously every role shipped a default
  effort and the preset always injected it. `none` means "do not send
  `reasoningEffort` at all" — deliberately distinct from `off`, which still
  sends `reasoningEffort: "off"` (explicitly disabling reasoning on models
  that support the parameter). The GUI effort select gained a `none` option
  (first item) with an inline explanation; the settings schema, the editor
  schema (`oh-my-dsh-slim.schema.json`) and the runtime injector
  (`effort-by-role.js`) all accept it; `temperature` injection is unaffected.
  Defaults are unchanged (`high`), so existing configurations behave
  identically. Verified: runtime injection test (`none` omits
  `reasoningEffort`, keeps role temperature), settings-schema acceptance,
  GUI write-plan tests (set / no-op / reset), and production GUI acceptance.
- **Fixer card description updated**: "定向修复" → "代码实现、修复与重构" /
  "Targeted fixes" → "Code implementation, fixes, and refactoring" — the role
  covers bounded implementation, bug fixes and refactoring, not only fixes.

### Changed

- Settings card wording: "思考档" → "思考强度" (reasoning effort) in zh, en
  and the effective-effect hint; the card no longer shows a placeholder
  option labelled "思考档" in the effort select (the select now always shows
  a real value, `none` included).
- Docs: effort vocabulary (incl. `none`) documented in the public/npm
  READMEs; zh public README gained the missing "early close" known-limit
  entry (parity with en).


## [0.3.3] — 2026-08-31

### Changed

- **`early-close-context` three-state ledger — reported ≠ finished**.
  Real-project usage exposed a boundary: the orchestrator treated a child's
  **report** ("Background subagent X reported:") as its completion and
  announced "the subagent is done" before the finish notice arrived (up to
  tens of seconds early). The host's own vocabulary separates the two:
  `subagent-report` (a relayed content message that neither concludes the
  child's turn nor changes its Activation lifetime — the child may keep
  working and report again) vs `subagent-settled` (the unconditional finish
  notice every established child eventually gets, covering completion,
  failure, cancellation and token-ceiling paths alike).
  The plugin now tracks three states — `running` → `reported` → `settled` —
  driven by an incremental scan of the parent session's inbox-splice events
  keyed on the message `source.kind` (authoritative, no text matching):
  - the injected system-prompt block renders reported children distinctly
    ("已回报内容，等待正式完成通知（reported ≠ 完成）") and warns against
    collectively summarizing multiple subagents;
  - the delegation Decision-point reminder now states that a report may
    arrive before the finish notice, and only the finish notice settles the
    child;
  - the persona clause gains "a report is not completion" + per-subagent
    status reporting;
  - the `listChildren` refresh stays as the settle fallback, so a lost
    finish notice can never pin the ledger.
  Verified: unit tests extended to 20 cases (delivery classification /
  extraction / three-state transitions / distinct rendering) — all green;
  headless run confirms `report` and `settled` deliveries are recognized by
  `source.kind` and the ledger clears on settle. Production GUI (real
  project, after restart): the delegation turn now says "已提交报告，但还
  没有正式结束；我会把它视为仍在运行" and defers network work until the
  finish notice ("已正式结束"), in direct contrast to the pre-0.3.3
  early-close behaviour; a multi-report session (report ×2 → integrate →
  finish → confirm) also behaves correctly.


## [0.3.2] — 2026-08-31

### Added

- **`early-close-context` preset plugin — first-phase mitigation for the
  "orchestrator closes early" failure**: a main model can emit a final
  conclusion while a background subagent it delegated is still running
  (claiming "done" without integrating the child's result). DSH offers no
  mechanism-level wait barrier (turn-based loop; mechanism research in the
  repo's HANDOFF §5), so the plugin supplies the model with FACTS instead:
  1. a live **"currently running background subagents" block** injected into
     the system prompt on every assembly (same dynamic `systemPrompt.context`
     mechanism as the host's `sandbox:policy`), fed by a light ledger of
     delegated children (`ctx.subagents.listChildren`, lazy refresh — async
     refresh, sync render, at most one turn of staleness);
  2. a **`Decision point` reminder** attached to every successful delegation
     tool result ("do not output a final conclusion until you receive its
     settle notice").
  Plus a persona clause: never claim completion while a delegated subagent is
  unsettled.
  Verified headless (intelalloc gpt-5.6-luna: induced-scenario control 3/3
  claimed-done vs fixed 3/3 honest "still running / waiting for the settle
  notice"; natural scenario 2/3 claimed-done vs 2/2 honest; fast-subagent
  delivery → wake-up → integration intact; parallel multi-subagent boundary
  fixed) and on the production GUI (gpt-5.6-sol/medium: the delegation turn
  now says "still running; cannot output a final conclusion yet" and waits
  for the settle notice instead of closing early).
  Known boundary: the model may still end its turn while the child runs
  (turn-based constraint — no force-wait), but it no longer misreports
  completion; the settle notice wakes it to integrate the result.


## [0.3.1] — 2026-08-29

### Added

- **`sandbox-strip` top-level handling**: the plugin now also strips DOOMED
  escalation shapes (empty justification, single-field pairs, non-widening
  modes — judged with the host's WIDER_MODES table) from top-level tool calls
  in this preset's own sessions. Legitimate escalation requests (strictly
  wider mode + non-empty justification) are kept and still prompt for
  approval. Non-preset sessions never load the plugin (unchanged behavior).
  Verified headless with gpt-5.6-luna (natural injection stripped + note),
  a legitimate-escalation control (kept, approval path intact) and a stock
  preset control (zero stripping).

## [0.3.0] — 2026-08-28

### Added

- **`sandbox-strip` preset plugin — workaround for stray sandbox escalation
  fields on delegated children**: DSH fixes a delegated child's file policy and
  approval state at startup, but the `bash`/`edit`/`write` tool schemas still
  expose optional `sandbox_permissions` / `justification` fields. Some models
  fill them unprompted, producing `invalid justification` /
  `not strictly wider` parameter-validation errors. The plugin removes the two
  fields from role-subagent child tool calls at the `tools/pre-execute`
  waterfall and appends a `[sandbox: stripped ...]` note to the tool result
  (visible to the model, diagnosable in logs). Top-level sessions are
  untouched. Scope guard: `agent.options.dshRoleId` (role-subagent-spawned
  children only); if a future DSH version lets children escalate, revisit the
  guard. This is a preset-level workaround — the real fix is upstream (DSH
  should not expose escalation fields to children with a fixed permission
  scope). A persona-level wording of the same rule was first shipped and then
  removed: headless testing showed gpt-5.6-luna ignores the instruction
  (14/14 calls still carried the fields), so the rule no longer pollutes role
  personas; T0 keeps the strip plugin's presence and logic assertions instead.

## [0.2.1] — 2026-08-27

### Added

- **`web_fetch` GUI toggle** (`webFetch` setting on the settings namespace) with
  the accompanying `web-fetch-gate` preset plugin: when enabled and a fetch
  provider is registered, the real `web_fetch` tool mounts for preset sessions
  via the host's own `applyWebFetchTool`; when no provider is detected the
  toggle is disabled with an install hint (README "Advanced configuration").
  The seeder's read-only `/omds` RPC endpoint reports provider status to the
  card. Takes effect after restarting DSH (gate evaluates once when the preset
  composition mounts; role-model/effort/temperature settings remain
  apply-immediately). Provider stays a host-level opt-in (SSRF primitive — see
  README).
- Settings card UX: header re-aligned with built-in cards (two-line layout,
  15px title, chevron on the right); save/reset actions moved to the top of the
  expanded card (persistent, dirty state shows an unsaved note and enables
  Save); new description text.

### Fixed

- **Empty `tools` from the settings namespace no longer hides every inherited
  tool from subagents.** The host settings service resolves user documents
  through schemastery, whose omitted array fields default to `[]`; the
  resolved snapshot therefore carried `tools: []` for any role whose user
  layer omitted it, and role-subagent turned that into `allow: []` — DSH's
  `tools.restrict()` treats an existing allow list as exhaustive, so delegated
  children lost every inherited tool (only self-registered report/MCP
  survived) and surfaced `unknown tool` errors for prompted-but-absent tools.
  config-loader now normalizes empty `tools` back to unset (empty allow list =
  not configured = deny-only). Regression test locked in
  `scripts/test-config-loader.mjs`.
- **Preset-scope plugins could not read the settings namespace.** Standing mounts
  resolve a settings instance whose `get(ns)` sees no namespace (registrations
  live on the host plane), so config-loader silently fell back to the legacy
  JSON channel — GUI-card overrides (models, effort) never reached delegated
  roles. config-loader now backstops with the raw published settings document
  (`settings.document[ns]`, schema-validated at write time; the default-merge
  stays idempotent). Locked by a regression test.
- **Provider status RPC envelope unwrap.** The client-side `rpc.call()` returns
  the already-unwrapped `RpcResult`, not the transport envelope; the card
  previously read `response.result`, always landing in "unknown" state.
  Unwrap is now `response.ok === true ? response.value : undefined`.

## [0.2.0] — 2026-08-26

### Added

- Host settings namespace `oh-my-dsh-slim` as the primary configuration channel
  (hot-updated; a legacy `oh-my-dsh-slim.json` is imported once into the
  namespace and archived automatically). Channel priority: `OH_MY_DSH_SLIM_CONFIG`
  test file > settings namespace > legacy JSON fallback.
- GUI configuration card under **Settings → Plugins → Plugin configuration**
  (ships with the npm package): per-role enable toggles, per-role model
  selection from the same catalog as the composer's model picker, reasoning
  effort, advanced maxTokens/temperature behind a warning sub-section, and
  reset-to-defaults (user layer only — hand-edited keys such as `mcpServers`
  are preserved).
- `settings-schema.js`: the schemastery schema is generated from defaults.json
  at runtime (role ids / effort levels / tool names keep one source of truth).

### Changed

- Effort and temperature apply to the current session immediately; model,
  token budget and role toggles apply to new sessions (running sessions stay
  locked at creation-time composition, unchanged).
- The seeder registers the namespace with the shipped defaults as the BASE
  layer: fields written back equal to the default are unset (inherit), so the
  user section only ever carries genuine overrides.

### Fixed

- Preset plugin mounts fail loud on hosts where an undeclared service is
  accessed (`inject: ['settings']` declared on role plugins).
- The npm packaging no longer embeds the repository's own `npm-package/`
  subfolder inside `preset/`.

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

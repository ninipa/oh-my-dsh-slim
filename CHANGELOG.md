# Changelog

All notable changes to oh-my-dsh-slim. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions match npm
package releases where applicable.

## [0.6.1-native.3] — continuable tool-filter fix

Second PR review follow-up (same unreleased version):
- Fix `/omds` route ownership: call the exported native connection registration method with the injected companion child as explicit owner, preserving the host authentication fence, RPC protocol and route cleanup. The former `rpc.handle` captured a provider context without `webServer` injection.
- Add focused transport lifecycle tests and opt-in full web-composition HTTP smoke; the former base-only smoke called profile endpoints directly and did not validate the transport layer.
- Give the unchanged preset/profile-registry plugins exported package subpaths and keep only the companion on the package-root entry. rc.2 client-module discovery rejects multiple path-based Loader sources for one `dsh.client` package during a full web restart; explicit non-client subpaths avoid duplicate client ownership without changing plugin implementations.
- Pin development-only `semver` and require its npm-acceptance cross-check on clean checkouts; remove remaining canonical-repository fork wording.

First PR review follow-up (same unreleased version):
- Admit the bounded DSH 0.2 compatibility line instead of pinning rc.2; only rc.2 is currently host-tested.
- Raise the runtime host floor to rc.2 with actionable guidance for older hosts before native registry access.
- Replace development-branch installation examples with pinned official release instructions, explicitly pending publication.
- Vendor byte-verified upstream baseline fixtures so tests work without Git history; preserve all historical archives.

- Fix unknown tool names surviving the background delegation path: rc.2 `startContinuable` carries the filter under `spec.request.toolFilter`, not on the top-level spec. Filter both direct and nested request shapes without mutating stock requests or removing valid restrictions.
- Correct the restrictable-tool lookup to the real rc.2 `tools.view(scope).restrictableNames` API. The former nonexistent `tools.restrictableNames()` call silently disabled filtering, and the test double incorrectly supplied it.
- Extend actual rc.2 stock-tool execution regressions (direct and injected scopes, foreground and background starts) to exercise unknown `skill` entries in both allow and deny lists, plus actual ToolRuntime view/restrict execution and empty-allow preservation. The original native.2 acceptance did not cover this nested filter path; its successful smoke tests were not live delegation acceptance.
- Verified 89/89 regressions with zero skipped. Isolated installed-ASAR smoke passes five explicit sentinels, including `NATIVE_TOOL_FILTER_START_PASS`, exercising the real installed ToolRuntime restriction API and scoped adapter request. This does not invoke a live provider.
- The user installed native.3, retested a Chinese todo-page task without delegation instructions, and accepted the desktop result as successful. This is user acceptance, not a full tool-trace audit or live MCP validation. The implementation checks did not modify desktop files.

## [0.6.1-native.2] — compatibility-only correction

Verified: 88/88 regression tests, zero skipped; installed rc.2 isolated-host smoke passes all four success sentinels. Independent final runtime review found no new confirmed blocking defect. No desktop installation was updated.

- Restore exact 0.5.3 orchestrator/role personas, plan-mode text and role descriptions instead of shortened rewrites.
- Restore upstream deepseek-v4-flash defaults, configuration merge behavior, orchestrator values, temperature/effort semantics and full-history result scanning.
- Preserve the original force-disabled observer rule; this is not a new restriction.
- Preserve 98 original developer scripts, examples, historical documents and custom-client source in the isolated `legacy/v0.5.3` archive with verified Git blob ids.
- Add immutable-baseline persona/config/tool-wording regression tests and raw-byte archive checks; expanded tests also cover named-profile conflicts, live reads and native settings priority.
- Correct desktop installation instructions: the desktop profile is managed only by its plugin manager, not CLI profile commands.
- Retract the unverified claim that the native settings schema automatically renders the old GUI. Restore the historical custom card via rc.2 configForms/slots and revision-fenced settings writes; restore `/omds` named-profile authoring with host ConfigEditor persistence and native default selection. Isolated installed-host validation passes create/save/conflict/live-read/isolation/default/reboot contracts; browser rendering is not claimed tested.
- Named records now use the active profile patch rather than copied directories. Uninstall stops their definition registration; legacy directories remain untouched and are not automatically imported. The persona-rewrite migration is a no-op for new declarative records, not a directory importer.
- Restore baseline MCP mode selection and first-assembly startup semantics: continuable only, a 20-second bounded first wait, failure-open, and refreshed first tool snapshot. The eight scoped lifecycle regressions pass; live remote MCP connectivity remains unverified.
- Protect archived source bytes from Windows line-ending conversion and test all 98 Git blob identities directly, without clean-filter normalization.
- Do not automatically update the user's installed desktop plugin. Earlier provider tests do not substitute for corrected-release acceptance; live MCP remains unverified.

## [0.6.1-native.1] — Henry-916 native fork

> Historical migration entry below: superseded claims about autogenerated UI and complete behavior preservation are corrected above. This migration changed more than required host compatibility.

> Branch: `feat/dsh-0.2-native`. **Tested target only: DSH 0.2.0-rc.2.**
> Install from `github:Henry-916/oh-my-dsh-slim#feat/dsh-0.2-native`, not upstream npm.
> A later installation or update requires a full DSH restart. No installation into the running
> user's desktop/profile was performed during this work. **Real-provider and live-MCP E2E have
> not been performed.**

### Added / restored

- Native configuration form autogenerated by DSH from the companion's volatile `Config` fields
  under the `oh-my-dsh-slim` namespace; edits persist in the active profile. This replaces the
  file-only user-facing configuration claim, without restoring the obsolete custom GUI card or
  `/omds` profile-authoring RPC.
- Validated, revision-checked legacy JSON import **only into an empty native user layer**.
  Existing native user settings are not overwritten. The source JSON is never modified, renamed,
  archived or deleted, including on successful import.
- Role-scoped MCP through the host's official `@deepseek-ai/dsh-mcp-client`, mounted in each
  selected role Agent context. Readiness failures are surfaced before its model step; native
  lifecycle disposal and role-scope isolation replace the old "declared but not mounted" limit.
  Agent-local MCP tools are exempt from inherited `toolFilter`: read-only built-in-tool policies
  do not make arbitrary configured MCP servers read-only. Added an explicit server/tool trust warning.
- Expanded unit/contract suites for settings, migration safety, role routing, request/result
  handling, lifecycle and MCP scope. Mocked provider/MCP behavior is not real-provider E2E.

### Changed / provenance

- Configuration precedence: explicit test/CI file, legacy profile snapshot, native plugin settings,
  legacy JSON fallback, then bundled defaults. No custom named native-profile creation is claimed.
- Host imports use official loader module resolution, packaged ASAR anchoring and host-owned module
  instances; stock composition rows resolve to absolute host URLs before native registration.
- E2E-AK-OI native-foundation changes incorporated by cherry-pick, with original attribution
  preserved. Lyrissonare's discovery workaround was studied as a reference, **not introduced as a
  dependency**. The upstream ninipa port and original alvinunreal persona attribution remain.
- Bilingual documentation now identifies this fork, branch installation and restart requirement;
  replaces stale MCP/file-only-settings claims; separates unit tests from packaged-host smoke and
  unperformed provider/MCP E2E.

### Validation scope

- Actual packaged **DSH 0.2.0-rc.2 no-network smoke passed** using the installed ASAR under
  Electron 44 / Node 24 and an isolated `DSH_HOME`. dsh-base, native preset registry, companion and
  full preset composition loaded; role roster and `registry.resolve` were healthy with no broken
  rows. No desktop user profile changes or LLM/provider/MCP network calls were made.
- This smoke is separate from repository unit/contract tests. It is not a live plugin installation,
  real-provider acceptance run, or remote MCP transport/tool verification. Those E2E checks remain
  outstanding; compatibility with other DSH versions is not asserted.

## Historical upstream releases

The entries below preserve upstream release history and its original reported results. They do
**not** establish validation for the Henry-916 native fork. In particular, old custom GUI,
file-only configuration, namespace removal and missing role-MCP statements describe those older
releases, not 0.6.1-native.1.

## [0.6.0] — 2026-09-30

> **Upstream reported target: DSH 0.2.0-rc.2** — upstream reported end-to-end verification;
> not independently repeated for this fork.
> **This release needs DSH ≥ 0.2.0-rc.2, and DSH 0.2.0 needs this release.** DSH 0.2.0 replaced
> directory agent presets with **declarative** ones, so 0.5.x installs there and then never appears,
> and 0.6.x cannot run on the 0.1.x lines at all. On DSH ≤ 0.1.5-rc.2 stay on 0.5.3; the 0.1.6–0.1.x
> line is supported by neither — 0.6.0 targets the *released* declarative seam.
> **Upgrading requires a DSH restart** (plugin code mounts once per host process).

### Changed

- **The preset is declarative — the directory preset is gone.** `cordis.patch.yml` (shipped at the
  repo root and inside `npm-package/`) now inserts two loader rows: `preset-oh-my-dsh-slim` →
  `preset/preset.js`, an `@deepseek-ai/dsh-agent-preset` row whose `config.plugins` **is** the whole
  agent plane (the six role tools, the orchestrator persona, the planning and compaction rows and
  the delegation group — 19 top-level rows), plus `omds-seeder` (`lib/index.js`) as the bundle's
  reporting companion. Nothing is seeded into `$DSH_HOME` any more, so there is nothing left to
  clean up on uninstall.
- **Install, update and uninstall are `dsh plugin`.** `dsh plugin --profile <name> add
  oh-my-dsh-slim` pnpm-installs the package into the profile and reconciles it into the profile's
  `dsh.profile.bundles` layer list, which is what makes the loader read this package's bundle
  patch. `engines.dsh` and the eight optional peer ranges are `"0.2.0-rc.2 || 0.2.0"`.
- **Configuration is file-based again.** DSH 0.2.0 removed the 0.1.x settings-namespace API, so the
  channels are `$OH_MY_DSH_SLIM_CONFIG` (tests/CI) → `profile.json` beside the mounted copy →
  `$DSH_HOME/oh-my-dsh-slim.json` → the bundled `defaults.json`. All four share one document shape
  and one merge rule (user values win key by key; arrays replace whole).
- **The default role models follow the 0.2.0 `deepseek-official` catalog**: `deepseek-v4-flash` →
  `deepseek-flash` for designer, fixer, explorer, librarian and observer; oracle keeps
  `deepseek-v4-pro`.
- **Per-role model parameters come from a standing listener.** `effort-by-role.js` is replaced by
  `preset/subagent-roles.js`: one `agent/request` listener covering all six roles. It identifies the
  role from the persona marker the child persists in its `subagent/descriptor` event (written before
  the child's first request), re-reads the configuration on **every** delegation, and validates a
  configured effort against the model's declared list through `llm.resolveModelInfo` — naming the
  role, the model and the fix, before the host would reject it at dispatch time.
- **`omds-seeder` reports instead of gating.** A thrown row now aborts the whole preset mount, so the
  row logs the host verdict (warning on `older` / `directory` / `legacy-preset-model`) instead of
  calling `assertHostCompatible()`.

### Fixed

- **Relative row names silently never started.** A row name resolves against the *declaring patch's*
  `baseUrl`, not the preset's directory, so all nine package-local rows — the five role rows behind
  `./roles.js` plus `./subagent-result.js`, `./subagent-roles.js`, `./early-close-context.js` and
  `./sandbox-strip.js` — audited as `never started` while the preset still reported itself mounted.
  Every package-local row now carries an absolute `file:` URL built from `import.meta.url`, and a
  test forbids relative row names outright.
- **`defaults.json` was read from the wrong directory.** `readDefaults()` joined the package root
  while the file ships in `preset/`, so every host without a user config file failed with
  `oh-my-dsh-slim: invalid JSON configuration at …/npm-package/defaults.json: ENOENT`.
- **The bundled role table was discarded whenever no user file existed.** `selectUserRoles()` read
  only `user.presets[<name>]` and ignored `defaults.presets[<name>]`, where the shipped table
  actually lives — leaving every role with nothing but the temperature/maxTokens floor: no provider,
  no model, no effort, no deny list. The three role layers now merge key by key, so a user file that
  overrides only `model` keeps the shipped `deny` list instead of erasing it.
- **Per-role `effort` never reached the host.** `resolveRole()` set `agentOptions.model`,
  `.provider` and `.maxTokens` but never `.reasoningEffort`, so every shipped effort value was dead
  configuration. It is now forwarded, and the host's own delegation preflight resolves it through
  `llm.resolveCallConfig`.
- **The role wrapper did not declare the services the host implementation reads.** It declared only
  `inject = ['loader']` while delegating straight into `@deepseek-ai/dsh-tool-subagent`, which reads
  `ctx.tools`, `ctx.subagents`, `ctx.systemPrompt` and `ctx.sessionProjections`; the mount threw
  `cannot get property "tools" without inject` and not one role tool registered. The wrapper now
  declares all five and reads `tools` through `ctx.get('tools')` with a `Reflect` fallback.
- **The role wrapper dropped `toolName`.** The stock plugin registers a tool named `config.toolName`,
  and the stock-shaped config the wrapper handed back omitted it — so every role row registered the
  default `subagent` tool instead of `subagent_oracle` / `subagent_designer` / …, and the role name
  never reached the orchestrator model. `toolName` is now forwarded.
- **The effort-mismatch error pointed at a card that no longer exists.** It told the user to open
  *Settings → Plugins → oh-my-dsh-slim*; it now names the configuration file that was actually read.

### Added

- `test/package.test.mjs` (`npm test`) — eight structural tests that need no DSH install: the two
  bundle patches agree row for row; the patch declares exactly one agent-preset row and it points at
  `preset/preset.js`; no preset row may name a relative path, and every package-local row resolves
  to an existing absolute `file:` URL under `npm-package/preset/` that is not YAML; the six role rows
  are found through the shared `roles.js` URL and their personas round-trip through
  `composeRolePersona` → `roleIdFromEvents`; the wrapper declares the five services and hands back a
  stock config that keeps `toolName` and leaks no `definition`; the bundled `defaults.json` reaches
  every role with no user file present; a *partial* user override keeps the shipped `provider`,
  `effort`, `deny` and `maxTokens`; and every role carries its shipped route into the host's
  `agentOptions`.
- `npm-package/preset/bridge.js` — the one way these rows reach the host's own module instances
  (`ctx.loader.internal.import` under the host's base URL), because a bare `@deepseek-ai/*` import
  from a preset row resolves a stale copy out of the user's global `node_modules`.
- `npm-package/package.json` gained a `prepare` step that copies the repository README and
  CHANGELOG into the published package. The docs keep a single source of truth (the repository root)
  while `npm publish` from `npm-package/` still ships a complete tarball; the generated copies are
  gitignored.

### Removed

- The entire directory-preset path: `agent.cordis.yml` and `preset.yml`, `preset/` at the repo root,
  `config-loader.js`, `settings-schema.js`, `oh-my-dsh-slim.schema.json`, `GUI-TEST-TASKS.md`,
  `examples/omo-probe-baseline/`, the whole `scripts/` probe and self-test kit, `npm-package/client/`
  (the GUI settings card), the duplicated `npm-package/preset/` copies of the docs, patch, manifest
  and LICENSE-adjacent files, and the 0.1.x modules that only made sense there: the tool-subagent
  fork `role-subagent.js` and `effort-by-role.js`.
- The 0.1.x host settings namespace, the GUI settings card, the `/omds` RPC routes and the
  multi-preset profile directories (`$DSH_HOME/.agent-presets/profile-<prefix>-<hash>/`). DSH 0.2.0
  has no seam for any of them: its preset registry neither scans directories nor accepts preset
  paths.
## [0.5.3] — 2026-09-28

> **Supported DSH: 0.1.2-rc.1 … 0.1.5-rc.2** — both host lines are verified end to end.
> **DSH 0.1.6 and newer are refused** (see below): 0.1.7 replaced directory agent presets with
> declarative ones, which this release does not implement yet.
> **Upgrading requires a DSH restart** (plugin code mounts once per host process).

### Changed

- **DSH 0.1.6 and newer are refused up front (ceiling added).** DSH 0.1.7 replaced directory agent
  presets with **declarative** ones declared by plugin bundles, and the host design explicitly
  rejected keeping both sources ("preset 不再有独立路径"). This preset line delivers a directory
  preset, so on such a host it would install cleanly and then never appear — a silent no-op. The
  host gate now carries a ceiling beside its floor — the whole 0.1.6 line is refused, prereleases
  included, since it was never verified: plugin rows refuse to mount, the seeder seeds nothing and
  leaves existing files untouched, and the reason plus the fix appears on the
  **oh-my-dsh-slim-compat** settings page. `engines.dsh` and the optional peer ranges were
  tightened to match. A release for the declarative preset model is in development; compatibility
  probing on a newer host can set `OMDS_ALLOW_NEW_HOST=1`.

### Fixed

- **A prerelease → release upgrade now re-seeds the bundled preset directory.** The seeder decided
  with its own `compareVersions` that parsed only major.minor.patch, so a marker left at `<v>-0` by
  a local transition package compared EQUAL to the released `<v>` and the "up to date" branch won.
  On 2026-09-18 that was cosmetic (the directory's code was byte-identical to the release; only its
  docs and version strings lagged), but an rc→final step that carries changes would have left the
  preset directory silently on the older plugin code while the package reported the new version.
  The decision now uses the prerelease-aware `compareSemver` the seeder already imports for the DSH
  floor, and `test-preset-seeder` covers the prerelease case.

## [0.5.2] — 2026-09-18

> **Supported DSH: 0.1.2-rc.1 … 0.1.5-rc.2** — both host lines are verified end to end
> (the 0.1.5 line re-verified on rc.2; no host-facing contract changed in this release).
> **Upgrading requires a DSH restart** (plugin code mounts once per host process).

### Fixed

- **A reasoning-effort level a model genuinely declares can now be saved.** The settings card
  derives the effort dropdown from the live model catalog, while the configuration paths
  validated the value against a fixed vocabulary (`none/off/low/medium/high/max`) — so a level
  outside that list (e.g. `xhigh`, which `intelalloc/gpt-5.6-sol` declares) was selectable in the
  GUI but rejected on save with `effort is invalid`, and on the bundled profile the host's
  settings schema rejected it the same way.

### Changed

- **Effort values are shape-checked, not vocabulary-checked.** Effort ids are adapter-owned and
  open-ended, so the writers now reject only malformed tokens; the question "does this model
  accept this level" moved to where it can actually be answered — `llm.resolveModel` at the first
  delegation, which fails with a readable error naming the model's declared levels and adapter
  default. Unavailable metadata (provider not imported, model unknown, host still starting) fails
  open and is re-checked later, so a configuration stays readable and writable offline and on
  another machine.

## [0.5.1] — 2026-09-10

> **Supported DSH: 0.1.2-rc.1 … 0.1.5-rc.1** — both host lines are verified end to end.
> **Upgrading requires a DSH restart** (plugin code mounts once per host process).

### Added

- **One-click migration for custom configurations on DSH 0.1.5.** DSH 0.1.3-alpha.2 renamed the
  persona configuration field (`text` → `prefix`). A configuration directory copied before that
  change carries the old field alone, and DSH 0.1.5 rejects the whole preset mount. The settings
  card now flags such a configuration and rewrites the row in place — the original
  `agent.cordis.yml` is kept as a backup beside it, and re-running the migration is a no-op.
- `scripts/run-real-models.mjs`: one-command real-model acceptance whose model is a flag
  (`--provider/--model/--effort`); `scripts/probe-omds-web.mjs`: web-mode transport probe;
  `scripts/test-omds-rpc.mjs`: transport unit test.

### Fixed

- **DSH 0.1.5: the preset could not mount at all.** The persona row now carries both the `text`
  and `prefix` keys, so one preset artifact serves the 0.1.2 and 0.1.5 host lines; previously
  every new 0.1.5 session failed its preset mount.
- **DSH 0.1.5: the settings card's configuration list is back.** The card's `/omds` channel was
  registered through an API that 0.1.5 resolves differently, so it silently never appeared — the
  card still rendered (with working model pickers) while reporting "Failed to read the
  configuration list" and disabling save.
- **Coded profile-API errors now reach the card as their real message** (name conflicts and
  stale-revision conflicts included) instead of an opaque envelope parse failure.

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

# oh-my-dsh-slim

**oh-my-dsh-slim · 0.8.5 · DSH 0.2 compatibility line**

A port of [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)'s specialist
subagent delegation for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):
an orchestrator plus five enabled specialist roles, delivered as a **declarative native agent
preset**. It mounts from the plugin bundle; it is not a standalone application or a preset
directory to copy.

> **Host range: `>=0.2.0-rc.2 <0.3.0-0`; tested hosts: DSH 0.2.0-rc.2 and 0.2.1-rc.2.** The gate is
> a per-core allowlist: 0.2.0 and 0.2.1 prereleases, stable releases and later patches are admitted;
> prereleases of a higher patch or minor core (for example `0.2.2-rc.1`) are refused until a release
> admits them. Upgrade policy: retain compatibility within the 0.2 line while the required APIs
> remain available; verify new host releases before claiming support.
> The 0.3 line requires a separate review.
> **DSH ≤0.1.5: stay on `oh-my-dsh-slim@0.5.3`.** Hosts between that line and rc.2 must upgrade DSH.
> 0.6.1 passed 101 automated tests, six base-composition installed-host smoke sentinels, and the five
> web-composition transport sentinels; the web smoke was independently reproduced on a plain npm/CLI
> host. The user accepted a desktop todo-page delegation retest as successful; full tool-trace,
> browser rendering and live MCP acceptance are not established. Updating requires a **full DSH
> restart**.

Persona text is adapted from oh-my-opencode-slim (MIT © 2025 alvinunreal), with attribution
retained. See [LICENSE](./LICENSE). 中文版见 [README.zh.md](./README.zh.md).

> **0.8.5 (2026-10-28): roles inherit the session model by default.** The package no longer
> pins provider/model or a fixed effort for the six roles: a subagent follows the session's main
> model and effort unless you pick one for that role. The model dropdown's first entry, "Inherit
> session model", clears both route halves and switches the effort back to follow. A route needs
> both halves; a half route is ignored with a startup notice. **Following is live**: switching a
> role back to inherit inside a running conversation applies to its next request — model, effort
> and output cap — without starting a new session. Fixes
> [#11](https://github.com/ninipa/oh-my-dsh-slim/issues/11). See [CHANGELOG.md](./CHANGELOG.md).

> **0.8.4 (2026-10-23): effort compatibility when a role model changes.** The effort dropdown no
> longer shows a level the saved configuration does not contain: an unsupported stored level renders
> the "Select…" placeholder, the error names it, and re-picking a level takes effect in one click. A
> switched-off role no longer blocks saving, and a stored level the mounted model does not offer is
> dropped with a warning at request time instead of failing the delegation. Fixes
> [#9](https://github.com/ninipa/oh-my-dsh-slim/issues/9). See [CHANGELOG.md](./CHANGELOG.md).

## Roles and delegation

| Role | Tool | Model | Effort | Permissions |
|---|---|---|---|---|
| oracle | subagent_oracle | inherit session model | follow session | read-only |
| designer | subagent_designer | inherit session model | follow session | writable |
| fixer | subagent_fixer | inherit session model | follow session | writable |
| explorer | subagent_explorer | inherit session model | follow session | read-only |
| librarian | subagent_librarian | inherit session model | follow session | read-only + role-scoped MCP |

- oracle handles architecture, debugging and review; designer handles UI/UX; fixer handles
  bounded implementation; explorer handles codebase reconnaissance; librarian handles external research.
- **The model follows the session's main model by default** (0.8.5): no provider/model is shipped.
  Picking a model in the card pins that role; the first dropdown entry, "Inherit session model",
  switches it back. `provider` and `model` must be configured as a pair — half a route is ignored
  and inherits instead. Following re-reads the main conversation's current configuration on every
  request, so switching a role back to inherit (or changing the main model) applies to the next
  delegation without starting a new session. Real model calls require the relevant provider
  credentials.
- **Effort follows the session by default too**: no level is shipped; picking one in the card is an
  override. An override the next main model does not declare never fails the delegation — it falls
  back to the session's own level when that model declares it, then to the model default, with one
  warning. The dropdown shows `none` as "Follow session (unspecified)" and `off` as "Thinking off";
  switching a role back to inherit clears its fixed level in the same edit. A role with a pinned
  model keeps validating against that model.
- **The output-token cap follows the route too**: with an inherited model the session/model decides
  it, so the advanced "Max tokens" field is disabled (pin a model to set it) — a role budget could
  exceed the new main model's output limit. Temperature, tools, prompts and MCP stay per role:
  they describe the specialist, not the route.
- Roles inherit global tools. Read-only roles deny `edit`/`write`; all roles deny control tools
  (`skill`, `job_kill`, `job_list`, `job_output`, `todo_write`, `ask_user_question`).
  Further delegation is disabled (`maxDepth: 1`).
- **observer is reserved and force-disabled**: delegation prompts are text-only, and the host
  gates pasted images by the main model's vision capability. Use a vision-capable main model
  directly until attachment forwarding is supported.

Delegation is background-first and continuable. Independent lanes are dispatched together;
the orchestrator must not redo a running lane's work or claim completion from an interim report.
A report is not a settlement. The runtime settlement notice allows integration; `subagent_result`
reads a finished child's final message without waking it or consuming another model turn.

## Council

Three read-only seats plus one tool-less synthesizer: the same question goes to
several independent models and comes back as one report with a consensus level.
Everything ships disabled; a council is active only when **at least two seats**
are enabled, and a single enabled seat is an ordinary read-only delegation.

| Role | Tool | Permission | Default |
|---|---|---|---|
| councillor-alpha / beta / gamma | subagent_councillor_alpha / … | read-only (read/glob/grep ceiling, narrowable only) | off |
| council | subagent_council | no tools (synthesis only) | derived from the seats |

- Give each seat its own provider/model/effort in the card's Council group;
  different models are what make the council worth its cost.
- **A seat without provider/model inherits the session model.** If every seat inherits, the
  council is a repeat sample of one model; the card warns about it.
- The synthesizer has no switch: it mounts when two or more seats are enabled,
  and the whole council disappears (tools and prompt section) with the seats.
- Council roles cannot use MCP servers (validation rejects `mcps`); the
  orchestrator fetches external material and puts it in the seat prompts.
- A seat prompt can be appended under the seat's Advanced section
  (`personaAppend`); it renders literally, so do not write `{{variables}}`.
- Usage: ask explicitly ("use council to evaluate …", "let a few models look at
  this"). The orchestrator dispatches every seat in one parallel step, waits for
  all settlements, then calls the synthesizer. Ordinary questions never trigger
  it; say "don't use council" to opt out.
- Cost: at least four model sessions (three seats + synthesis) per run — the
  most expensive path in the preset; use it deliberately.
- Limits: fixed three seats, no fallback chains, no `@council` mention routing;
  the section is injected only into the top-level agent, and a cold-resumed seat
  stays read-only.
- Troubleshooting: if the card says Council is active but a new session has no
  `subagent_councillor_*` / `subagent_council` tools, first confirm it is a new session; the
  host log's `omds-council-mode` warning names the missing seat or synthesizer tool.
- Other boundaries: one council occupies three seats plus the synthesizer and shares the host's
  `maxActiveSubagents` pool (default 8); there is no code-level timeout or kill switch (abort the
  run manually if a seat hangs); per-seat MCP is **intentionally disabled** (MCP tools bypass
  `tools.restrict`).

## Install a released version (then restart)

The desktop App exclusively manages its `desktop` profile. Install/update/remove through its plugin manager, **not** `dsh plugin --profile desktop`. Enter this pinned package spec:

```text
oh-my-dsh-slim@0.8.5
```

Install by exact version from the release notes rather than a moving tag, and never substitute a
moving development branch. 0.6.1 is the DSH 0.2 line; DSH ≤0.1.5 users stay on 0.5.3. Official
source and release tags: [ninipa/oh-my-dsh-slim](https://github.com/ninipa/oh-my-dsh-slim/releases).

The CLI commands below apply only to non-desktop-managed profiles:

```bash
dsh plugin --profile <profile> add oh-my-dsh-slim@0.8.5
```

For a local checkout instead, install the repository root — its export map serves the same modules
as the published package:

```bash
dsh plugin --profile <profile> add /path/to/oh-my-dsh-slim
```

`dsh plugin` installs into `$DSH_HOME/profiles/<profile>/` and reconciles the package into the
profile's `dsh.profile.bundles` layer list. Set `DSH_HOME` to your deployment's actual home before
using the CLI; the desktop app may use an isolated home rather than `~/.dsh`.

**Restart DSH after installation or any later update**, then create a session with **极简角色委派**
in the native **Settings → Agent Presets** picker. Plugin code mounts once per host process;
creating another session alone does not load changed code. The command above is an instruction,
not a claim that the running installation was changed during this work.

- **Update:** choose a published version from the official release notes and install that exact
  version. In rc.2, the desktop manager may require uninstall/reinstall; back up settings first,
  retain configuration when removing the package, and restart DSH.
- **Uninstall:** `dsh plugin --profile <profile> remove oh-my-dsh-slim`, then restart DSH.
  No preset directory is seeded; user settings and the preserved legacy JSON are not promised
  to be deleted by package removal.
- **DSH ≤0.1.5:** use `oh-my-dsh-slim@0.5.3` and its historical installation instructions.
  This 0.6.x line requires DSH ≥0.2.0-rc.2; 0.1.6/0.1.7 users must upgrade the host.

## Repository layout

- repository root: the package manifest used when installing a local checkout; its export map
  serves the same modules as the published package;
- `npm-package/`: the published package content — what npm receives;
- `test/`: unit/contract suites plus the two opt-in installed-host smokes;
- `legacy/v0.5.3/`: the historical directory-preset line, kept for comparison fixtures.

## Native preset and settings

The bundle patch declares `preset-oh-my-dsh-slim`, an `@deepseek-ai/dsh-agent-preset` row,
and the profile-plane companion `omds-seeder`. The preset's `config.plugins` is its plugin list.
Rows name exported package subpaths (`oh-my-dsh-slim/preset`, `oh-my-dsh-slim/profile-registry`,
`oh-my-dsh-slim`), so the host resolves them through the package's export map; only the package
root entry contributes the browser client module. No `$DSH_HOME/.agent-presets/` directory is
created.

The companion declares a host-native `Config` schema with volatile editable fields. The settings
service describes these fields and persists updates in the active profile. **This does not establish
that the desktop renders an autogenerated role form**: the host documentation says no shipped client
uses `autoGenerate` yet. The historical custom card has instead been restored through rc.2
`configForms` and the settings shell's `settings.section` slot (the page the 0.2 desktop renders
for plugin configuration), with revision-fenced writes and its original editing helpers. It opens
expanded, and its model dropdowns come from the host's own model catalog.
The `/omds` named-profile workflow is implemented with persisted records in an owned configuration
row and native registry registration. Isolated installed-host tests cover create/save, revision
conflicts, existing-context isolation, native default selection, and persistence after reboot.
The card also deletes a configuration: only a persisted custom profile offers the action, the
removal is confirmed in its own dialog, and the host endpoint refuses the bundled preset, a
foreign native id, the current new-session default, and a stale revision. Deleting removes the
record from the profile patch, so the preset disappears from the host's registry as well.
Browser rendering and live provider/MCP acceptance have not been revalidated for this correction.
Select the default session preset in the native Agent Presets settings. See the
[compatibility audit](./COMPATIBILITY-AUDIT.md).

Named records now live in the active profile's patch instead of copied preset directories.
Removing the package stops registering their definitions; this does not delete the old JSON or
old copied directories. Those legacy directories are not imported or rewritten automatically.
The old persona-rewrite migration is unnecessary for new declarative records and returns an
unchanged result; it is not a legacy-directory importer.

### Configuration precedence

Zero configuration uses bundled defaults. Override sources, highest priority first:

1. `OH_MY_DSH_SLIM_CONFIG` explicit file (tests/CI).
2. The current named preset's persisted document (including an empty snapshot), or a legacy `profile.json` snapshot beside the mounted copy.
3. Native DSH plugin settings: `oh-my-dsh-slim`.
4. Legacy `$DSH_HOME/oh-my-dsh-slim.json` fallback when no native settings document is available.
5. Bundled defaults and runtime floors.

The legacy JSON importer **only seeds an empty native user layer**. Existing native user
settings are never overwritten. Import is validated and revision-checked; on failure it is
skipped with a warning. The original JSON is **never renamed, archived, deleted or modified**,
even after a successful import. An explicit test file or old profile snapshot can take precedence
above the native form; remove that override if you expect GUI edits to be authoritative.

Both named legacy configurations and compact role overrides remain accepted:

```json
{
  "preset": "my-dsh-normal",
  "roles": {
    "oracle": { "provider": "deepseek-official", "model": "deepseek-v4-pro", "effort": "max" },
    "librarian": { "mcps": ["context7", "gh_grep"] }
  },
  "mcpServers": {
    "context7": { "transport": "streamable-http", "url": "https://mcp.context7.com/mcp" },
    "gh_grep": { "transport": "streamable-http", "url": "https://mcp.grep.app" }
  }
}
```

- Compact `roles` wins over `presets[<name>]`; `advanced.roles.<roleId>` merges last.
  Partial overrides preserve shipped role fields. Arrays replace at document selection;
  role deny entries are combined to preserve restrictions.
- Per-role keys include `enabled`, `provider`, `model`, `effort`, `temperature`, `maxTokens`,
  `tools`, `deny`, `mcps`, and `personaAppend`. A nonempty `tools` list is exhaustive; an empty
  list means unconfigured, not "deny all".
- `provider` and `model` must be configured as a pair. The route in the example above is only an
  example — none ships any more; omitting both, or setting one half, inherits the session model
  (a half route is dropped with a startup notice).
- Effort tokens are shape-checked, not limited to the shipped `off`/`low`/`high`/`max` vocabulary.
  Delegation checks model metadata when changing effort and reports mismatches; metadata lookup
  failure retains the upstream fail-open behavior. `none` preserves the host-resolved effort.
- Model, effort and temperature are re-read on delegated requests: saving the card reroutes the
  next child request, so a model change applies to the current conversation. Token budget and role
  toggles still apply to new sessions. This does not make plugin installation live.

## Official, role-scoped MCP restored

The native role MCP row mounts the host's own **`@deepseek-ai/dsh-mcp-client`** in the exact
role Agent context. Each role's `mcps` list selects entries from `mcpServers`; shipped defaults
select context7 and gh_grep for librarian. These are real scoped native client mounts, **not
merely persona hints or declarations**. The official client owns transports, tools, resources,
prompts and reconnection. The preset owns scope selection, readiness and disposal.

Startup semantics match the baseline: mount only for continuable background children, wait
at most 20 seconds on first prompt assembly, and proceed if a connection fails. The initial
snapshot is refreshed with registered MCP tools; later turns do not repeat the wait. Eight
scoped lifecycle regressions pass, including first-snapshot refresh and failure/timeout handling.
**Live remote MCP connectivity and provider/MCP E2E remain untested**. Availability,
authentication and pricing are not guaranteed.

**MCP trust boundary:** Agent-local MCP registrations are exempt from the inherited `toolFilter`.
The read-only role policy restricts inherited built-in tools; it does **not** automatically make
arbitrary configured MCP servers read-only. The approved shipped context7/gh_grep defaults are
research tools. Trust the server and inspect its tools before adding mutation-capable MCPs to a
read-only role; do not treat the role label as universal protection against remote side effects.

## Validation and known boundaries

```bash
npm test
```

This runs the repository's `node --test test/*.test.mjs` **unit/contract suites**, including
packaging, settings/import safety, role routing, request/result handling, lifecycle and MCP scope.
Mocked host/provider/MCP behavior is not a real-provider acceptance run.
Historical comparison fixtures are vendored under `test/fixtures/upstream-v0.5.3/` and checked
against pinned raw Git blob hashes; the suite does not require `.git` or full clone history.
Installed-host integration cases skip with an explicit reason when their reference fixture is absent.
`semver` is a pinned development dependency: its version-range cross-check does not depend on npm's bundled copy.

The base smoke directly invokes profile endpoints and **does not validate `/omds` HTTP registration**.
For opt-in transport acceptance, run `test/web-host-smoke.cjs` with `DSH_HOST_ANCHOR` set to an
absolute installed DSH JS entry, using that host's Node runtime (packaged Electron needs
`ELECTRON_RUN_AS_NODE=1` and `--expose-internals`). It mounts the real `dsh-web-app` bundle with
an isolated home/profile and a loopback ephemeral port; it does not replace the running GUI.
The installed rc.2 web smoke passed all six sentinels: authentication and Host/Origin fencing,
all six profile RPC methods (delete included) and conflict handling, invalid wire envelopes,
persistence across full restart, and route disposal. Both boots assert every enabled host row is
active.
It uses the actual published patch; exported non-client subpaths prevent duplicate client-module
ownership. Visual browser rendering, actual browser client execution and in-flight cancellation
are not acceptance-tested.

An **actual packaged DSH 0.2.0-rc.2 no-network smoke passed separately**: Electron 44 / Node 24
from the installed ASAR, with an isolated `DSH_HOME`, booted dsh-base, the native preset registry,
companion and preset. The role roster and full-composition `registry.resolve` were healthy, with
no broken rows. No desktop user installation was changed and no LLM, provider or MCP network
requests were made. This validates package loading and native host composition, not real-provider
E2E or remote context7/gh_grep tools. Provider routing, model responses and live MCP transport/tool
calls still require a later E2E run with credentials, network access and an explicitly
installed/restarted target profile.

Additional limits:

- `sandbox-strip` removes doomed escalation fields in fixed-permission delegated children.
  Legitimate top-level escalation remains subject to host approval; this is a preset workaround,
  not an upstream permission-model change.
- `early-close-context` supplies running/reported/settled facts and delegation reminders. It
  cannot force the model to wait or guarantee model compliance.
- `web_search` uses the host search service and may incur independent auxiliary-model charges;
  `web_fetch` uses the host fetcher and costs no model call.
- Host imports use the host loader's own module base and module instances, including packaged
  desktop resolution. The Lyrissonare discovery workaround was studied as a reference;
  **it is not a dependency** of this package.

## Attribution and history

- [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) (MIT © 2025
  alvinunreal): role system and persona source.
- [ninipa/oh-my-dsh-slim](https://github.com/ninipa/oh-my-dsh-slim): upstream DSH port (this repository).
- [E2E-AK-OI/oh-my-dsh-slim](https://github.com/E2E-AK-OI/oh-my-dsh-slim): native-foundation
  changes incorporated by cherry-pick, with original attribution preserved. This credit is
  provenance, not a claim of E2E validation by this compatibility update.
- [Lyrissonare/oh-my-dsh-slim](https://github.com/Lyrissonare/oh-my-dsh-slim): host discovery
  workaround studied; no runtime or package dependency introduced.
- [Henry-916/oh-my-dsh-slim](https://github.com/Henry-916/oh-my-dsh-slim): contributor of the
  0.6.x native-compatibility update (merged as PR #3).
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): host platform.

See [CHANGELOG.md](./CHANGELOG.md) for current compatibility changes and explicitly historical upstream
release notes. License: [MIT](./LICENSE).

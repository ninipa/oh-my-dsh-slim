# oh-my-dsh-slim

**oh-my-dsh-slim · 0.6.2 · DSH 0.2 compatibility line**

A port of [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)'s specialist
subagent delegation for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):
an orchestrator plus five enabled specialist roles, delivered as a **declarative native agent
preset**. It mounts from the plugin bundle; it is not a standalone application or a preset
directory to copy.

> **Host range: `>=0.2.0-rc.2 <0.3.0-0`; tested host: DSH 0.2.0-rc.2.** The gate follows npm range
> semantics: later 0.2.0 prereleases (rc.3) and stable 0.2.x are admitted without a tested claim,
> while prereleases of later patch versions — for example `0.2.1-alpha.2`, the current host `alpha`
> tag — are refused until a release admits them. Upgrade policy: retain compatibility within the 0.2
> line while the required APIs remain available; verify new host releases before claiming support.
> The 0.3 line requires a separate review.
> **DSH ≤0.1.5: stay on `oh-my-dsh-slim@0.5.3`.** Hosts between that line and rc.2 must upgrade DSH.
> 0.6.1 passed 101 automated tests, six base-composition installed-host smoke sentinels, and the five
> web-composition transport sentinels; the web smoke was independently reproduced on a plain npm/CLI
> host. The user accepted a desktop todo-page delegation retest as successful; full tool-trace,
> browser rendering and live MCP acceptance are not established. Updating requires a **full DSH
> restart**.

Persona text is adapted from oh-my-opencode-slim (MIT © 2025 alvinunreal), with attribution
retained. See [LICENSE](./LICENSE). 中文版见 [README.zh.md](./README.zh.md).

## Roles and delegation

| Role | Tool | Default model | Effort | Permissions |
|---|---|---|---|---|
| oracle | subagent_oracle | deepseek-v4-pro | max | read-only |
| designer | subagent_designer | deepseek-v4-flash | high | writable |
| fixer | subagent_fixer | deepseek-v4-flash | high | writable |
| explorer | subagent_explorer | deepseek-v4-flash | low | read-only |
| librarian | subagent_librarian | deepseek-v4-flash | high | read-only + role-scoped MCP |

- oracle handles architecture, debugging and review; designer handles UI/UX; fixer handles
  bounded implementation; explorer handles codebase reconnaissance; librarian handles external research.
- Shipped models route through `deepseek-official`; configure an imported provider/model to use
  another route. Real model calls require the relevant provider credentials.
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

## Install a released version (then restart)

The desktop App exclusively manages its `desktop` profile. Install/update/remove through its plugin manager, **not** `dsh plugin --profile desktop`. Enter this pinned package spec:

```text
oh-my-dsh-slim@0.6.1
```

Install by exact version from the release notes rather than a moving tag, and never substitute a
moving development branch. 0.6.1 is the DSH 0.2 line; DSH ≤0.1.5 users stay on 0.5.3. Official
source and release tags: [ninipa/oh-my-dsh-slim](https://github.com/ninipa/oh-my-dsh-slim/releases).

The CLI commands below apply only to non-desktop-managed profiles:

```bash
dsh plugin --profile <profile> add oh-my-dsh-slim@0.6.1
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
- Effort tokens are shape-checked, not limited to the shipped `off`/`low`/`high`/`max` vocabulary.
  Delegation checks model metadata when changing effort and reports mismatches; metadata lookup
  failure retains the upstream fail-open behavior. `none` preserves the host-resolved effort.
- Model, token and tool composition changes should be used in a new session. Effort and
  temperature are re-read on delegated requests; this does not make plugin installation live.

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
The installed rc.2 web smoke passed all five sentinels: authentication and Host/Origin fencing,
all five profile RPC methods and conflict handling, invalid wire envelopes, persistence across
full restart, and route disposal. Both boots assert every enabled host row is active.
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
- `web_search` uses the host search service and may incur independent auxiliary-model charges.
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

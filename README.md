# oh-my-dsh-slim

**Henry-916 fork · 0.6.1-native.1 · branch `feat/dsh-0.2-native`**

A port of [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)'s specialist
subagent delegation for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):
an orchestrator plus five enabled specialist roles, delivered as a **declarative native agent
preset**. It mounts from the plugin bundle; it is not a standalone application or a preset
directory to copy.

> **Tested target only: DSH 0.2.0-rc.2.** Other host versions are not verified by this fork.
> Unit/contract tests and an actual packaged-host, no-network smoke are distinct validation
> layers. After installing native.1, the user verified read-only delegation and settlement through
> CPA with explorer/Qwen low, fixer/Gemini medium and oracle/GPT xhigh. **That is not regression
> acceptance of this corrected release, nor proof of upstream reasoning levels or live MCP.**
> This correction does not update the running desktop installation. Updating requires a **full DSH restart**.

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

## Install this fork (later, then restart)

The desktop App exclusively manages its `desktop` profile. Install/update/remove through its plugin manager, **not** `dsh plugin --profile desktop`. Enter this installation spec in the desktop plugin manager:

```text
github:Henry-916/oh-my-dsh-slim#feat/dsh-0.2-native
```

The CLI commands below apply only to non-desktop-managed profiles. Use the **fork GitHub branch**, not the upstream npm package or marketplace entry:

```bash
dsh plugin --profile <profile> add github:Henry-916/oh-my-dsh-slim#feat/dsh-0.2-native
```

For a local checkout instead:

```bash
dsh plugin --profile <profile> add ./oh-my-dsh-slim
```

`dsh plugin` installs into `$DSH_HOME/profiles/<profile>/` and reconciles the package into the
profile's `dsh.profile.bundles` layer list. Set `DSH_HOME` to your deployment's actual home before
using the CLI; the desktop app may use an isolated home rather than `~/.dsh`.

**Restart DSH after installation or any later update**, then create a session with **极简角色委派**
in the native **Settings → Agent Presets** picker. Plugin code mounts once per host process;
creating another session alone does not load changed code. The command above is an instruction,
not a claim that the running installation was changed during this work.

- **Update:** add the same fork branch again, then restart DSH. Do not use upstream `@latest`
  to update this fork.
- **Uninstall:** `dsh plugin --profile <profile> remove oh-my-dsh-slim`, then restart DSH.
  No preset directory is seeded; user settings and the preserved legacy JSON are not promised
  to be deleted by package removal.
- This native fork is not a compatibility promise for DSH 0.1.x. Older upstream releases are a
  separate historical line, not the installation path for this branch.

## Native preset and settings

The bundle patch declares `preset-oh-my-dsh-slim`, an `@deepseek-ai/dsh-agent-preset` row,
and the profile-plane companion `omds-seeder`. The preset's `config.plugins` is its plugin list.
Package-local rows use absolute `file:` URLs constructed from `import.meta.url`, avoiding
relative-path resolution against the declaring patch. No `$DSH_HOME/.agent-presets/` directory
is created.

The companion declares a host-native `Config` schema with volatile editable fields. The settings
service describes these fields and persists updates in the active profile. **This does not establish
that the desktop renders an autogenerated role form**: the host documentation says no shipped client
uses `autoGenerate` yet. The historical custom card has instead been restored through rc.2
`configForms` and `plugins.item`, with revision-fenced writes and its original editing helpers.
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
  **it is not a dependency** of this fork.

## Attribution and history

- [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) (MIT © 2025
  alvinunreal): role system and persona source.
- [ninipa/oh-my-dsh-slim](https://github.com/ninipa/oh-my-dsh-slim): upstream DSH port.
- [E2E-AK-OI/oh-my-dsh-slim](https://github.com/E2E-AK-OI/oh-my-dsh-slim): native-foundation
  changes incorporated by cherry-pick, with original attribution preserved. This credit is
  provenance, not a claim of E2E validation by this fork.
- [Lyrissonare/oh-my-dsh-slim](https://github.com/Lyrissonare/oh-my-dsh-slim): host discovery
  workaround studied; no runtime or package dependency introduced.
- [Henry-916/oh-my-dsh-slim](https://github.com/Henry-916/oh-my-dsh-slim): this native fork.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): host platform.

See [CHANGELOG.md](./CHANGELOG.md) for current fork changes and explicitly historical upstream
release notes. License: [MIT](./LICENSE).

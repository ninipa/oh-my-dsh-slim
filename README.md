# oh-my-dsh-slim

A port of [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)'s specialist
subagent delegation for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):
**an orchestrator + 5 specialist roles**, each with its own persona, model, tool permissions
(toolFilter), reasoning effort, and MCP access. Delivered as a shareable **DSH agent preset**
(with bundled configuration plugins), not a standalone application.

> Persona text adapted from oh-my-opencode-slim (MIT © 2025 alvinunreal), attribution retained —
> see [LICENSE](./LICENSE). 中文版见 [README.zh.md](./README.zh.md).

## What it solves

DSH's default orchestration is "one model does everything". This preset splits work into
specialist lanes, and the orchestrator plans, dispatches, and integrates:

- **oracle** — architecture decisions, complex debugging, code review. Read-only.
- **designer** — UI/UX design and visual polish. Writable.
- **fixer** — bounded mechanical implementation. Writable.
- **explorer** — fast codebase reconnaissance. Read-only.
- **librarian** — external research via official docs / GitHub (context7 + gh_grep MCP). Read-only.

Delegation is **background-first** (continuable): the orchestrator dispatches lanes and ends its
turn; the runtime wakes it with a settlement notice when a lane finishes, so it can integrate
results. The `subagent_result` tool reads a finished subagent's final message **without waking it**
(zero extra model turns).

## Role matrix

| Role | Tool | Default model | Effort | Permissions |
|---|---|---|---|---|
| oracle | subagent_oracle | deepseek-v4-pro | max | read-only |
| designer | subagent_designer | deepseek-v4-flash | high | writable |
| fixer | subagent_fixer | deepseek-v4-flash | high | writable |
| explorer | subagent_explorer | deepseek-v4-flash | low | read-only |
| librarian | subagent_librarian | deepseek-v4-flash | high | read-only + MCP |

- All roles inherit global tools; read-only roles deny `edit/write`; all roles deny control tools
  (OMO-style deny-only policy)
- Roles cannot delegate further (`maxDepth: 1`); librarian exclusively mounts context7/gh_grep in
  its own child scope
- **observer (visual analysis) is reserved but disabled in this release**: DSH's send-time gate
  blocks image attachments based on the *main model's* vision capability, and delegation prompts
  are text-only, so pasted images cannot reach a subagent yet. It will be re-enabled when the
  harness supports forwarding message attachments into subagent contexts.

## Install

Requires DSH ≥ 0.1.1-rc.2 and a DeepSeek API key (default models route through
deepseek-official).

**Option A — plugin marketplace (recommended):**

```bash
dsh plugin --profile web add oh-my-dsh-slim
```

Also listed in the DSH plugin marketplace GUI and the
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) catalog.
The package ships a seeder that materializes the preset into
`$DSH_HOME/.agent-presets/oh-my-dsh-slim` automatically (updates come with plugin upgrades;
your previous copy is backed up).

**Option B — CLI:**

```bash
dsh plugin --profile web add oh-my-dsh-slim
```

> ℹ️ This uses the default harness home (`~/.dsh`). If your deployment uses a
> custom home (e.g. an isolated desktop-app environment), set `DSH_HOME` to it
> first — the marketplace GUI (Option A) resolves this automatically.

**Option C — git clone:**

```bash
git clone https://github.com/ninipa/oh-my-dsh-slim "$DSH_HOME/.agent-presets/oh-my-dsh-slim"
```

Done — the preset appears immediately. Create a new session and pick **极简角色委派** in
**Settings → Agent Presets**.

- **Update**: `cd "$DSH_HOME/.agent-presets/oh-my-dsh-slim" && git pull`
- **Rollback**: `git checkout <old-tag>` or just delete the directory. Presets are locked per
  session at creation time; running sessions are unaffected.

## Configuration

Zero configuration required (sensible defaults ship with the preset). User intent is read in
descending priority:

1. The file pointed to by the `OH_MY_DSH_SLIM_CONFIG` env var (test/CI channel)
2. **The host settings namespace `oh-my-dsh-slim`** (recommended): the bundled seeder registers
   this namespace, so configuration lives under the `oh-my-dsh-slim:` section of the host's
   `settings.yaml`. Effort/temperature are re-read on every delegation (edits apply immediately);
   model/maxTokens apply to new sessions
3. The legacy `$DSH_HOME/oh-my-dsh-slim.json` file (fallback for hosts without a settings
   service). On hosts with the npm package installed, the file is imported into the settings
   namespace on first boot and archived as `oh-my-dsh-slim.json.imported-<timestamp>`

All three channels share one document shape (schema:
[oh-my-dsh-slim.schema.json](./oh-my-dsh-slim.schema.json)):

```json
{
  "preset": "my-dsh-normal",
  "presets": {
    "my-dsh-normal": {
      "fixer": { "model": "kimi-k3", "effort": "high" },
      "librarian": { "mcps": ["context7", "gh_grep"] }
    }
  }
}
```

- Per-role overrides: `enabled` / `model` / `effort` / `deny` / `mcps`; `temperature` / `maxTokens`
  are advanced keys (`advanced.roles.<roleId>`)
- **Model validation**: at delegation time the configured model id is checked against the
  providers you imported in **Settings → Models**. An unknown model fails loud on the first
  delegation, listing every imported model (including the vision-capable subset) — no silent
  breakage
- **observer is locked**: `observer.enabled: true` is ignored with a warning (see above)
- Changes take effect in **new sessions**; running sessions are unaffected

**GUI card** (ships with the npm package): after install, a card appears under
**Settings → Plugins → Plugin configuration** — per-role toggle/model/effort editable inline,
advanced maxTokens/temperature behind a warning sub-section, and a model dropdown sourced from
the same catalog as the composer's picker. The orchestrator row is informational only: it is the
session's main model, changed in the composer's picker (defaults under Settings → Models). Saving
reports which changes apply immediately (effort/temperature) and which start with new sessions.

**Conversational configuration** (no JSON editing needed): just say e.g. "change fixer's model to
kimi-k3" or "disable the oracle role" — the orchestrator edits the JSON per the schema.

## Roadmap

- ~~**GUI configuration**~~ — **Done**: role toggles, per-role model selection (from your imported
  providers, same catalog as the composer picker) and reasoning effort are editable in
  **Settings → Plugins → Plugin configuration** — install the npm package and the card appears
  (host-native plugin config surface). The orchestrator is informational only: it is the session's
  main model, changed in the composer's picker (defaults under Settings → Models).

## Self-tests & probes (all zero-cost)

```bash
# Static validation (structure / keys / persona dead-references / soft-disable assertions)
node scripts/t0-validate.mjs .

# Unit tests (config merge / effort injection / delegation contract / subagent_result)
node scripts/test-config-loader.mjs && node scripts/test-effort-plugin.mjs
node scripts/test-role-subagent.mjs && node scripts/test-subagent-result.mjs

# Two probes to run after every DSH upgrade (probe first, GUI later)
# ① model-modality overview across all providers
# ② preset compatibility: real composition boot + per-role filter validation + sessionQuery reads
#    (replace REPLACE_WITH_REPO_ABS_PATH in the patch files with this repo's absolute path first)
DSH_HOME=<scratch-home> dsh --profile headless --patch scripts/probe-capabilities-patch.headless.yml probe
DSH_HOME=<scratch-home> dsh --profile headless --patch scripts/probe-patch.headless.yml probe
```

## Acceptance checklist

[GUI-TEST-TASKS.md](./GUI-TEST-TASKS.md) provides 7 non-explicit-dispatch scenarios (prompts +
expected behavior) for verifying a fresh deployment. T3 uses the baseline project under
[examples/omo-probe-baseline](./examples/omo-probe-baseline).

## Known limits

- **Non-vision main models cannot receive pasted images**: DSH rc.2 hard-blocks image attachments
  at send time based on the main model's capability (`MODEL_DOES_NOT_SUPPORT_IMAGES`). For image
  analysis, use a vision-capable main model (e.g. deepseek-v4-flash-vision-exp) directly — or wait
  for upstream attachment forwarding
- **web_search is billed separately**: librarian prefers MCP (free). `web_search` runs through the
  host search service, which issues an independent auxiliary model request per query. For open-ended
  research, give the task a search budget in the prompt
- **Delegated children cannot escalate sandbox permissions — the preset strips stray escalation
  fields (`sandbox-strip` plugin, a workaround)**: DSH fixes a delegated child's file policy and
  approval state at startup, but the `bash`/`edit`/`write` tool schemas still expose optional
  `sandbox_permissions` / `justification` fields. Some models fill those fields unprompted; a child
  cannot escalate anyway, so the extra arguments only trigger parameter-validation errors
  (`invalid justification`, `not strictly wider`). The bundled `sandbox-strip` plugin removes the two
  fields from role-subagent child tool calls at the `tools/pre-execute` waterfall and appends a
  `[sandbox: stripped ...]` note to the result so the model sees the correction. Top-level sessions
  are untouched and may still request escalation normally. This is a preset-level workaround, not a
  fix: the real fix is upstream — DSH should stop exposing escalation fields to children whose
  permission scope is fixed

## FAQ

**Which API key do I need?**
A DeepSeek API key — the default role models route through deepseek-official.
Roles can be pointed at any provider you imported in **Settings → Models**.

**Can I use other models per role?**
Yes — every role's model and reasoning effort is configurable via the user JSON
(or conversational config). Unknown model ids are rejected at delegation time
with the full list of imported models.

**How do I uninstall?**
Remove `$DSH_HOME/.agent-presets/oh-my-dsh-slim` (or disable the preset in
**Settings → Agent Presets**). If you installed the marketplace seeder plugin,
uninstalling the plugin does not remove the preset directory.

**Image analysis?**
Use a vision-capable main model (e.g. deepseek-v4-flash-vision-exp) and paste
directly. The observer role is reserved until the harness can forward
attachments into subagent contexts.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## Acknowledgments

- [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) (MIT © 2025
  alvinunreal) — role system and persona source
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — host platform

## License

[MIT](./LICENSE)
# Compatibility correction audit — 0.6.1-native.2

> Version labels: this release is published as `0.6.1`; `0.6.1-native.1/2/3` were the contributor's
> pre-release iteration labels used during review. Historical references below keep those labels.

Baseline: ninipa/oh-my-dsh-slim `1a29e706710b0a967021fa963ba607b0e683029e` (0.5.3).
Target: installed DSH 0.2.0-rc.2 only.

The first native migration was not behavior-preserving: it shortened personas, changed default model ids and changed configuration/request merge behavior. This correction restores the upstream product contract rather than silently improving it.

## Required runtime adaptations

- Replace removed directory-preset discovery with the host native registry and host-resolved plugin composition.
- Replace retired Session `.events` access with immutable snapshots, and durable child inventory with live descendant activity where settlement tracking needs it.
- Use producer-owned format-v4 message sources and host-owned message constructors.
- Preserve stock rc.2 delegation lifetime/cancellation via a scoped wrapper, rather than vendoring the older host tool implementation.
- Mount role-selected MCP with the installed official client on each Agent context, retaining the baseline run-mode selection and startup-failure semantics rather than introducing strict readiness or additional foreground support.
- Persist configuration through the rc.2 native settings layer instead of the removed settings namespace registration API.

## Separate local provider correction

The user's CPA/Qwen model has `compat.supportsDeveloperRole: false` in the desktop profile. This is not a bundled role/default change and is not added to every user's provider configuration.

## Restored authoring workflow and storage differences

The previous migration removed the historical custom settings client and named-profile authoring behavior. A native schema alone was not an equivalent replacement. The historical client is now restored with only rc.2 `configForms`/slot bridges and revision-fenced writes; named records persist through an owned non-volatile configuration entry using the host ConfigEditor, rebuilding registry definitions on load. Saving is not memory-only registration. Default selection uses the native registry's `selectedDefault`; each profile's runtime consumers have an isolated live document reader. Creation/save/default/migration RPC payload contracts retain the baseline shape, without a new rename UI.

Storage necessarily changes from copied preset directories to records in the active profile patch. Uninstall stops registering their definitions; it does not automatically delete legacy files or copied directories. Old directory records are not automatically imported or rewritten. The persona-rewrite migration returns unchanged for new declarative records, rather than claiming to import old directories. Restored source/helper/lifecycle contracts and backend authoring are tested; visual browser GUI parity has not been directly verified.

The installed rc.2 Connection source has also been inspected: its HTTP adapter applies the trusted Host/Origin fence and browser authentication before admitting RPCs as a single `OperatorPeer`. There is no documented read-only peer flag to invent for this release. Profile authoring is intended to use that host-authenticated `/omds` channel; application-level revision and record-identity checks pass both unit and isolated real-host tests. Those checks directly invoked the backend and did not exercise route registration or HTTP transport. This is not a claim that arbitrary MCP or tool calls receive operator privileges.

Historical developer tests, scripts, examples and UI sources are preserved under `legacy/v0.5.3/`, not installed as obsolete active rc.2 runtime code. An additional raw-byte integrity test caught Windows `autocrlf` normalization that the initial `git hash-object` verification masked. All 98 archives have now been rewritten from original Git blob bytes, and explicit `-text` attributes prevent future normalization. The independent raw-byte regression passes. The initial clean-filter hash check was not valid evidence of byte-for-byte identity.

## Review follow-up: `/omds` transport registration

Maintainer review of `1abb36825208b522f2a84f4e420e642934c6258e` independently passed all 96 tests and direct backend smoke, but reproduced a registration failure in a real web composition: `connection.rpc.handle` selects the connection provider's context as route owner, where `webServer` is not injected. The prior base-only smoke could not catch this because it did not mount `dsh-web-app` or send HTTP requests. Earlier statements about channel authentication described inspected host code, not successful profile-UI transport acceptance.

The compatibility repair supplies the injected companion child as the explicit owner to the exported host `HostConnectionService.register` implementation. The host remains responsible for request admission, RPC validation/envelopes, request cancellation, operator identity and HTTP bridging; the client protocol and profile payloads are unchanged. Pending host imports are disposal-fenced. Tests must now exercise the real web bundle and authenticated HTTP rather than infer transport success from direct endpoint calls. Browser rendering remains a separate unverified boundary.

Full web restart additionally exposed duplicate client-module source ownership: three path-based bundle rows inherited one package's `dsh.client` declaration, which rc.2 rejects as distinct active sources. The preset and profile-registry now use explicit exported non-client subpaths, while the companion owns the bare package-root entry. Their plugin code and client bundle are unchanged. The web fixture uses the actual published package patch from a physical isolated copy, not a replacement declaration or a symlink/junction.

Current review validation: full unit/contract suite 101/101 with zero skips using extracted rc.2 host references; existing installed-ASAR base smoke passes all six sentinels. A source export with no `.git` and an empty `PATH` passes 95 tests with six explicit host-reference skips; local installed development dependencies were reused via a junction, not represented as a fresh network install. Frozen-lockfile installation and npm package dry-run pass; the new transport helper is included. Installed-ASAR full web HTTP smoke now passes all five explicit sentinels: unauthenticated 401 and invalid Host/Origin 403, real launch-token cookie authentication, list/create/save/default/migrate with stale revision checks, native malformed envelope validation, persisted records/default after full restart, and `/omds` removal on companion disposal. Every enabled host row is asserted active after both boots. Only optional HMR/title-LLM/native directory-picker rows are disabled; session-query remains active. This uses loopback HTTP, not external provider/MCP calls; no visual browser, actual browser client RPC execution or in-flight HTTP cancellation acceptance is claimed.

## Host-row ownership drift: `web_fetch` and the plan-mode text (0.6.3)

A declarative preset row is a **definition**, not a patch. In web mode `dsh-web-app` disables 24 host
rows so each agent preset can mount its own (tools, planning, compaction, delegation); anything the
preset does not compose is simply absent, and any value it states is the effective one. The 0.2.0 port
rebuilt the agent plane row by row and kept the 0.5.3 values verbatim, which is faithful in text but
not in behavior:

- `tool-web: { fetch: false }` (public commit `5fe21f6`, "preserving existing behavior") was **inert**
  on 0.1.x: the host plane's own `fetch:true` row won there, and production ran with `web_fetch` —
  measured 18 → 2 `web_search` calls per librarian research run. On 0.2.0 the same declaration became
  effective, so every 0.6.0-0.6.2 preset session in web mode silently lost `web_fetch`. The 0.5.3 T0
  had asserted `fetch: false` as if it were intent, so the stale value was locked in twice.
- `plan-mode` carried a frozen copy of the host's prompt. The host rewrote a sentence of it after
  0.5.3 ("keep the tool catalog unchanged" → "keep the request shape stable"), which a copy can never
  follow.

Corrections:

- `tool-web` declares `fetch: true` (the effective 0.5.3 behavior, and the host fetcher ships SSRF
  protection).
- `plan-mode` inherits the host's current text: `parsePlanSection` reads the `section` block scalar
  out of the installed `@deepseek-ai/dsh-base/cordis.patch.yml` (YAML clip semantics, byte-identical
  to the host loader's own parse) and the mounted definition uses it. The shipped string is only the
  baseline for hosts whose base patch cannot be read, and that path warns.

Guards added, because neither the port review nor the then-current tests compared *effective* values:

- `scripts/audit-host-rows.mjs` (run by `scripts/t0-validate.mjs` whenever a reference host is
  installed) compares every preset row that shares an id with the host's base bundle. Rules: a shared
  row may differ only if listed in `DIVERGENCES` with a reason; a row `dsh-web-app` hands to the
  agent plane (base enables it, web disables it) must be composed or listed in `ABSENCES`; the
  inherited plan-mode text must equal the host's own parse; stale allowlist entries fail. Two
  negative tests keep the guard honest (a contradicted `tool-web` value and a host that stops
  shipping the block form both fail).
- `scripts/t0-validate.mjs` pins the two intent values without needing a host.
- `test/web-host-smoke.cjs` now composes bundles like a real profile (dsh-base, then dsh-web-app,
  then this package, empty profile root). The earlier shape wrote the base rows into the profile
  root, where they outrank every bundle patch — so dsh-web-app's `disabled: true` entries never
  landed, the host's `tool-web` row stayed active with `fetch:true`, and the plane split was not
  exercised. The smoke asserts the host row stays off and that the preset's row yields both
  `web_search` and `web_fetch` (visibility read with `tools.get(name, scope)`, the host's own
  read; `view()` lists only agent-session-restrictable tools and stays empty here). Verified in both
  directions: `fetch:true` passes, `fetch:false` fails.

Row inventory against DSH 0.2.0-rc.2 (24 rows the web app hands over): 15 shared ids — 14 identical
to the host base and 1 listed divergence (`plan-mode`, inherited at mount time); 7 listed absences
(`command-goal`, `skill-filesystem`, `tool-skill`, `tool-subagent`, `tool-subagent-fork`,
`tool-workflow`, `workflow-ptc`); 2 host default-off (`tool-ralph`, `tool-plugin-manager`, both
shipped disabled in the base itself).

## Verification boundaries (historical native.2 results)

- The latest full suite passes 88/88 (zero skipped), including exact upstream persona, metadata, stock-tool composition, tool wording and configuration-behavior comparisons, plus client, raw archive and named-profile unit contracts.
- The expanded isolated installed-ASAR Electron/Node smoke now passes with all four explicit sentinels, including `NATIVE_PROFILE_RESTART_ISOLATION_PASS`: original name/description/order, bundled/named preset resolution, factory form values, create/save/revision conflict, existing context isolation/live reads, environment priority, native default mutation, and persisted records/default after disposal and reboot. It uses a fresh temporary home/profile and does not touch the desktop. This is not visual browser acceptance or live provider/MCP E2E.
- Earlier user CPA tests passed explorer/Qwen low, fixer/Gemini medium and oracle/GPT xhigh on native.1. They do not validate this correction, upstream effort semantics, writable tasks or live MCP.
- The correction does not automatically update or restart the installed desktop plugin.

**Post-release correction:** Desktop native.2 testing exposed unknown `skill` tool failures during continuable startup. The claim below that native.2 filters against the actual host set was not validated: the implementation called nonexistent `tools.restrictableNames()` and only inspected top-level filters, while continuable filters live under `spec.request.toolFilter`. The native.3 fix uses the actual scoped view API and covers both shapes. The former passing tests supplied the nonexistent method in a double and missed the nested path; registry smoke success did not establish successful child startup.

Additional independent wrapper review found baseline protections absent from the prior 72 tests. The wrapper intended to filter allow/deny against the actual host restrictable tool set (not scope-local schemas), skips the `none` effort sentinel in stock spawn preflight, and restores the full baseline background-selection tool/parameter/system wording. MCP startup behavior is also restored. The wording lane's complete suite passed 77/77, before the latest profile-persistence tests.

The first expanded installed-host smoke failed due to direct undeclared `settings` property access. It was corrected to the host `ctx.get()` service contract. Additional fixture failures (missing overlays, duplicated home/profile layer, omitted persisted restart patches) were corrected without treating nominal zero exits as success. The latest installed-host run passes all four explicit sentinels, including `NATIVE_PROFILE_SCOPE_GATE_PASS` using actual Cordis composition/child scope tags. Global request hooks and early-close delegation tracking now reject foreign composition scopes so simultaneously mounted profiles cannot alter each other's requests or decision reminders. Updated fixture regressions now pass, including foreign early-close delegation rejection. Independent final read-only review of ConfigEditor locking/reconcile, RPC payloads, native settings fallback, profile bindings, register disposal and MCP scope lifecycle found no new confirmed blocking defect. Zero exit alone was never accepted as proof.

These are correction implementation and isolated acceptance results, not a promise of identical retired host storage or verified browser/live-provider/live-MCP behavior.

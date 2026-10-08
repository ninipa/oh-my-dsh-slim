# Compatibility correction audit — 0.6.1-native.2

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

The installed rc.2 Connection source has also been inspected: its HTTP adapter applies the trusted Host/Origin fence and browser authentication before admitting RPCs as a single `OperatorPeer`. There is no documented read-only peer flag to invent for this release. Profile authoring uses that host-authenticated `/omds` channel; application-level revision and record-identity checks pass both unit and isolated real-host tests. This is not a claim that arbitrary MCP or tool calls receive operator privileges.

Historical developer tests, scripts, examples and UI sources are preserved under `legacy/v0.5.3/`, not installed as obsolete active rc.2 runtime code. An additional raw-byte integrity test caught Windows `autocrlf` normalization that the initial `git hash-object` verification masked. All 98 archives have now been rewritten from original Git blob bytes, and explicit `-text` attributes prevent future normalization. The independent raw-byte regression passes. The initial clean-filter hash check was not valid evidence of byte-for-byte identity.

## Verification boundaries

- The latest full suite passes 88/88 (zero skipped), including exact upstream persona, metadata, stock-tool composition, tool wording and configuration-behavior comparisons, plus client, raw archive and named-profile unit contracts.
- The expanded isolated installed-ASAR Electron/Node smoke now passes with all four explicit sentinels, including `NATIVE_PROFILE_RESTART_ISOLATION_PASS`: original name/description/order, bundled/named preset resolution, factory form values, create/save/revision conflict, existing context isolation/live reads, environment priority, native default mutation, and persisted records/default after disposal and reboot. It uses a fresh temporary home/profile and does not touch the desktop. This is not visual browser acceptance or live provider/MCP E2E.
- Earlier user CPA tests passed explorer/Qwen low, fixer/Gemini medium and oracle/GPT xhigh on native.1. They do not validate this correction, upstream effort semantics, writable tasks or live MCP.
- The correction does not automatically update or restart the installed desktop plugin.

**Post-release correction:** Desktop native.2 testing exposed unknown `skill` tool failures during continuable startup. The claim below that native.2 filters against the actual host set was not validated: the implementation called nonexistent `tools.restrictableNames()` and only inspected top-level filters, while continuable filters live under `spec.request.toolFilter`. The native.3 fix uses the actual scoped view API and covers both shapes. The former passing tests supplied the nonexistent method in a double and missed the nested path; registry smoke success did not establish successful child startup.

Additional independent wrapper review found baseline protections absent from the prior 72 tests. The wrapper intended to filter allow/deny against the actual host restrictable tool set (not scope-local schemas), skips the `none` effort sentinel in stock spawn preflight, and restores the full baseline background-selection tool/parameter/system wording. MCP startup behavior is also restored. The wording lane's complete suite passed 77/77, before the latest profile-persistence tests.

The first expanded installed-host smoke failed due to direct undeclared `settings` property access. It was corrected to the host `ctx.get()` service contract. Additional fixture failures (missing overlays, duplicated home/profile layer, omitted persisted restart patches) were corrected without treating nominal zero exits as success. The latest installed-host run passes all four explicit sentinels, including `NATIVE_PROFILE_SCOPE_GATE_PASS` using actual Cordis composition/child scope tags. Global request hooks and early-close delegation tracking now reject foreign composition scopes so simultaneously mounted profiles cannot alter each other's requests or decision reminders. Updated fixture regressions now pass, including foreign early-close delegation rejection. Independent final read-only review of ConfigEditor locking/reconcile, RPC payloads, native settings fallback, profile bindings, register disposal and MCP scope lifecycle found no new confirmed blocking defect. Zero exit alone was never accepted as proof.

These are correction implementation and isolated acceptance results, not a promise of identical retired host storage or verified browser/live-provider/live-MCP behavior.

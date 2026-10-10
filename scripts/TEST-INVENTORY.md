# Test inventory — 0.6.x declarative line

The 0.5.x directory-preset tooling (probes, battery, T0 of that line) is archived under
`archive/legacy-0.5.x-root/scripts/`; it targets code that no longer exists in this line and must not
be run against it.

## Layers, cheapest first

| Layer | Command | What it proves | Cost |
| --- | --- | --- | --- |
| T0 static | `node scripts/t0-validate.mjs` | manifests/export maps agree, both patches name exported subpaths, host range wiring, version and doc consistency, no directory-preset remnant, the `tool-web`/`plan-mode` intent values | 0 |
| Host-row audit | `DSH_HOST_REFERENCE_DIR=<installed host>/node_modules node scripts/audit-host-rows.mjs` | every preset row sharing an id with the host base bundle matches it or is a listed divergence; rows the host hands to the agent plane are composed or listed as a deliberate absence; the inherited plan-mode text equals the host's own parse | 0 |
| Suite | `DSH_HOST_REFERENCE_DIR=<installed host>/node_modules node --test test/*.test.mjs` | packaging, settings/import safety, role routing, request/result, lifecycle, MCP scope, legacy archive bytes, host-row audit mechanism (including its failing cases) | 0 models |
| Base host smoke | `DSH_HOST_ANCHOR=<installed host JS entry> node --expose-internals test/host-smoke.cjs` | real host boot with `dsh-base` + this package: version gate, roster, settings entry, profile endpoints (called directly), restart isolation, scope gate, tool filter | 0 models |
| Web host smoke | `DSH_HOST_ANCHOR=… node --expose-internals test/web-host-smoke.cjs` | real `dsh-base` + `dsh-web-app` composition over loopback HTTP: auth fence, all five `/omds` profile methods, envelope validation, restart persistence, route disposal, the plane split (host `tool-web` stays off) and the preset row's effective `web_search`/`web_fetch` | 0 models |
| Declarative host probe | see below | what the running host actually exposes: roster/broken, settings entry, client-module source count | 0 models |
| Real model run | not part of this line yet | provider/MCP E2E | needs credentials |

Notes:

- The base smoke **does not** validate `/omds` HTTP registration (it calls the profile endpoints
  directly). Only the web smoke and the HTTP probe below cover the transport.
- A plain `npm install --prefix` host works for both smokes, but the *base* smoke needs host packages
  resolvable from the temporary home (or an ASAR anchor where `hostBaseUrl()` applies); otherwise it
  fails at row resolution before the assertions. The web smoke resolves host rows from the anchor and
  needs no extra setup.
- `legacy/v0.5.3/` must stay in the tree: `test/legacy-archive.test.mjs` reads it.

Reference host for T0's audit, the suite, and both smokes:

```bash
npm install --prefix /tmp/dsh-host @deepseek-ai/dsh@0.2.0-rc.2     # once
export DSH_HOST_REFERENCE_DIR=/tmp/dsh-host/node_modules
export DSH_HOST_ANCHOR=/tmp/dsh-host/node_modules/@deepseek-ai/dsh/lib/bin.js
```

The audit alone reads only `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` (`cordis.patch.yml`
plus `package.json` each), which can also be extracted from a packaged desktop's `app.asar`
(`dsh/node_modules/@deepseek-ai/...`). The base smoke additionally needs the host packages resolvable
from the temporary home: with a non-ASAR anchor, symlink each `@deepseek-ai/*` into
`$TMPDIR/node_modules/@deepseek-ai/` or it fails at row resolution before the assertions.

## Declarative host probe

`scripts/probe-declarative-host.mjs` is a **row module**: insert it through a profile patch and read
the single `PROBE_DECLARATIVE_HOST` JSON line from the host log.

```yaml
# profiles/<name>/cordis.patch.yml
- insert:
    - id: probe-declarative-host
      name: 'file:///absolute/path/to/scripts/probe-declarative-host.mjs'
```

```bash
OMDS_PROBE_DELAY_MS=12000 DSH_HOME=<scratch home> dsh web --no-open --host 127.0.0.1 --port 0
```

Wait for the delay: the companion row has a top-level `await`, so an early read shows an empty roster
and no settings entry — that is a timing artifact, not a defect.

## `/omds` over HTTP (manual acceptance)

```bash
PORT=<from the boot line>; TOK=<token from the boot URL>
curl -s -o /dev/null -c jar "http://127.0.0.1:$PORT/?token=$TOK"          # mints the browser cookie
curl -s -b jar -X POST "http://127.0.0.1:$PORT/omds/profile-list" \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"1","method":"profile-list","payload":{}}'
```

Expected: `401 unauthorized` without the cookie; with it a `server-response` envelope whose
`result.ok` is true and whose value lists the bundled profile. `profile-create`, `profile-save`,
`profile-set-default` and `profile-migrate` take the same shape; an unknown endpoint returns
`UNKNOWN_ENDPOINT`, and a method/endpoint mismatch returns the host's `gateway/bad-request`.

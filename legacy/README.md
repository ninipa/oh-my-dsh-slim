# Legacy development archive

`v0.5.3/` preserves selected historical files from upstream commit
`1a29e706710b0a967021fa963ba607b0e683029e`, with their original relative paths.

**This is not the DSH 0.2.0-rc.2 installation entry point.** Nothing here is
registered, imported, or executed automatically by the current runtime. Historical
installation commands, host versions, GUI instructions, and expected probe results
are archival information, not current compatibility promises. Use the repository's
current installation documentation instead.

## Scope

98 original files are preserved byte-for-byte:

- `scripts/`: 40 development tests, probes, runners, YAML fixtures, and the test inventory.
- `npm-package/preset/scripts/`: the corresponding 40 historical packaged files.
- `examples/` and `npm-package/preset/examples/`: 4 baseline-example files each.
- Historical root `README.md`, `README.zh.md`, `CHANGELOG.md`, and `GUI-TEST-TASKS.md`.
- Historical `npm-package/README.md` and the 4 corresponding preset README/changelog/GUI files.
- `npm-package/client/client.js`: the old settings UI, retained for feature auditing only.

The original README files inside `v0.5.3/` are intentionally unchanged snapshots.
`v0.5.3/MANIFEST.git-blob.txt` lists the upstream Git blob ID and relative path for
each original file. All 98 restored files were extracted directly from Git blobs
without text conversion and verified by hashing the raw bytes with the Git blob
header (no clean filters or newline normalization). The repository's
`.gitattributes` disables text conversion for `legacy/v0.5.3/**`. The manifest and this explanation are archive metadata,
not upstream snapshot files.

Old runtime modules, preset registrations, package manifests, and host plugins are
**not** restored into active paths. Historical tests may reference missing old
runtime modules, old host APIs, external models/services, or non-Windows paths;
retaining them does not make them rc.2 tests. Do not include them in current test
scripts or execute probes automatically. Port a test deliberately into the current
test suite after replacing its old contracts and isolating external side effects.

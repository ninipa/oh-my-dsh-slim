# omo-probe-baseline

Baseline project used by the **T3** acceptance task in
[../../GUI-TEST-TASKS.md](../../GUI-TEST-TASKS.md): a tiny CommonJS package with
two library modules and an entry point, so a delegation task can start from a
known state and be verified mechanically.

## Layout

- `lib/math.js` — add / mul / percentage
- `lib/io.js` — readLines / readCsv
- `main.js` — prints `5 12` then `2`

## Usage

Copy it to a scratch location before running the T3 task (the delegated agent
will append new modules alongside these files):

```bash
cp -R examples/omo-probe-baseline /tmp/omo-probe
cd /tmp/omo-probe && node main.js   # → "5 12" / "2"
```

The acceptance criterion for T3 is that `node main.js` still prints the
original output after the delegated implementation adds its own modules.

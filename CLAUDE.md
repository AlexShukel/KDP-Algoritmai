# KDP-Algoritmai — Claude instructions

## Problem-set persistence across benchmark runs

All benchmark runs that are meant to compare against each other (e.g. a 60 s
MILP pass and a follow-up 300 s or 600 s pass, or any cross-algorithm sweep
that will share a chart) must operate on the **same** problem instances.
Once a problem set has been generated, do **not** regenerate or replace
`problems/` until every comparison run that depends on it is complete.

- Do not run `pnpm generate:problems:*` between comparison passes.
- The problem timestamp embedded in each filename
  (e.g. `9_1778535813465.json`) and inside each result record's `problemPath`
  field is what ties the runs together. If those timestamps diverge across
  result files for the same class, the comparison is broken.
- Long-budget follow-ups (`*.t300s.json`, `*.t600s.json` variants in
  `results/R05-<class>/`) MUST be produced from the same problem set as the
  baseline `benchmark-results-milp-rust.json` in that directory.

Current canonical R05 problem set: timestamp `1778535813465`
(generated 2026-05-12 via `pnpm generate:problems:large`).

## After a successful benchmark run

After each completed R05 (or any benchmark) run, copy the result files into the
Obsidian vault so they are available for analysis and note-taking:

```bash
cp -r results/R05-10_20 ~/Git/halo/Projects/Bachelor-VRPPD/results/
```

Adjust the source path to match the actual run label (e.g. `R05-10_20`,
`R05-20_50`, etc.). The destination is always
`~/Git/halo/Projects/Bachelor-VRPPD/results/`.

# vrppd-or-tools

OR-Tools baseline for the adapted VRPPD. Provides `solve_routing` (large-N near-optimal reference) and `solve_cp_sat` (medium-N exact baseline). Shells out to a Python subprocess running google/or-tools.

## Setup

```bash
pip install -r crates/vrppd-or-tools/python/requirements.txt
python3 crates/vrppd-or-tools/python/solver.py --self-test
```

The crate's `solve_*` functions return typed errors (`PythonNotFound`, `OrtoolsImportFailed`) if the install is missing.

## Design

See `docs/superpowers/specs/2026-05-11-or-tools-baseline-design.md`.

# OR-Tools Baseline Crate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new workspace crate `vrppd-or-tools` exposing OR-Tools Routing Solver and CP-SAT as DISTANCE/PRICE baselines, wired into the napi-bridge and TS harness, so the comparison matrix has a high-quality reference at N≥50 where vrppd-milp OOMs or times out.

**Architecture:** Rust crate that spawns `python3 python/solver.py` per call, ships a JSON request on stdin, reads a JSON response on stdout. Two public Rust functions (`solve_routing`, `solve_cp_sat`) mirror `vrppd_milp::solve_milp`'s API shape — same error/status/result types, same 30-min default timeout. Two napi exports → two TS `MultiTargetAlgorithm` adapters (`or-tools-routing`, `or-tools-cp-sat`) → two algorithm rows in the PLAN.md §4.2 comparison matrix.

**Tech Stack:** Rust 2021 (workspace member), `serde`/`serde_json` for the wire protocol, `std::process::Command` for subprocess, Python 3 + `ortools>=9.10,<10` for the solver, NAPI-RS 3.0 for the TS bridge.

**Reference doc:** `docs/superpowers/specs/2026-05-11-or-tools-baseline-design.md` (commit `9cc0aa5`).

---

## Files

**Create:**
- `crates/vrppd-or-tools/Cargo.toml`
- `crates/vrppd-or-tools/README.md`
- `crates/vrppd-or-tools/src/lib.rs`
- `crates/vrppd-or-tools/src/wire.rs`
- `crates/vrppd-or-tools/python/solver.py`
- `crates/vrppd-or-tools/python/requirements.txt`
- `crates/vrppd-or-tools/tests/integration.rs`
- `src/algorithms/or-tools-routing/index.ts`
- `src/algorithms/or-tools-cp-sat/index.ts`

**Modify:**
- `Cargo.toml` (root workspace members + workspace dependencies)
- `crates/napi-bridge/Cargo.toml` (add `vrppd-or-tools` dep)
- `crates/napi-bridge/src/wire.rs` (add `OrToolsConfig`, `OrToolsResultWire`)
- `crates/napi-bridge/src/lib.rs` (add `solve_or_tools_routing`, `solve_or_tools_cp_sat`)
- `src/index.ts` (register the two new algorithms)
- `scripts/run-r05.sh` (add to per-class skip lists)
- `BENCHMARKS.md` (add OR-Tools setup section)

---

## Task 1: Scaffold the workspace crate

**Files:**
- Create: `crates/vrppd-or-tools/Cargo.toml`
- Create: `crates/vrppd-or-tools/src/lib.rs`
- Create: `crates/vrppd-or-tools/README.md`
- Modify: `Cargo.toml` (root workspace)

- [ ] **Step 1: Create the crate's `Cargo.toml`**

Write `crates/vrppd-or-tools/Cargo.toml`:

```toml
[package]
name = "vrppd-or-tools"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true
description = "OR-Tools baseline (Routing Solver + CP-SAT) for the adapted VRPPD. Shells out to a Python subprocess that runs google/or-tools and returns the objective value via JSON. Used for the large-N comparison rows where vrppd-milp OOMs or times out."

[dependencies]
vrppd-core = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }

[dev-dependencies]
vrppd-brute-force = { workspace = true }
```

- [ ] **Step 2: Create a placeholder `src/lib.rs`**

Write `crates/vrppd-or-tools/src/lib.rs`:

```rust
//! OR-Tools baseline crate for the adapted VRPPD. See
//! `docs/superpowers/specs/2026-05-11-or-tools-baseline-design.md` for the
//! full design.

// Public API lands in subsequent tasks.
```

- [ ] **Step 3: Add the crate to the root workspace**

Edit `Cargo.toml` at the repo root. In the `[workspace]` section's `members` array, append `"crates/vrppd-or-tools"`. In `[workspace.dependencies]`, append `vrppd-or-tools = { path = "crates/vrppd-or-tools" }`.

After the edit, `members` should include `"crates/vrppd-or-tools"` after the other crates, and `[workspace.dependencies]` should include `vrppd-or-tools = { path = "crates/vrppd-or-tools" }` alongside the other `vrppd-*` entries.

- [ ] **Step 4: Create a minimal README**

Write `crates/vrppd-or-tools/README.md`:

```markdown
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
```

- [ ] **Step 5: Verify the workspace builds**

Run: `cargo build -p vrppd-or-tools`
Expected: PASS (empty crate compiles).

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml crates/vrppd-or-tools/Cargo.toml crates/vrppd-or-tools/src/lib.rs crates/vrppd-or-tools/README.md
git commit -m "$(cat <<'EOF'
feat(or-tools): scaffold vrppd-or-tools workspace crate

Empty Cargo.toml + lib.rs stub + README. No Python yet; public API and
subprocess plumbing land in follow-ups.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Error, Status, and Result types (Rust)

**Files:**
- Modify: `crates/vrppd-or-tools/src/lib.rs`

- [ ] **Step 1: Write failing unit test for `Display` on errors**

Append to `crates/vrppd-or-tools/src/lib.rs`:

```rust
#[cfg(test)]
mod type_tests {
    use super::*;
    use vrppd_core::Objective;

    #[test]
    fn error_display_includes_kind() {
        let err = OrToolsError::UnsupportedObjective(Objective::Empty);
        assert!(format!("{err}").contains("Empty"));

        let err = OrToolsError::PythonNotFound;
        assert!(format!("{err}").contains("python"));

        let err = OrToolsError::OrtoolsImportFailed("pip install ortools".into());
        assert!(format!("{err}").contains("ortools"));

        let err = OrToolsError::SolverFailed("model_invalid".into());
        assert!(format!("{err}").contains("model_invalid"));

        let err = OrToolsError::SolverInternal("KeyError: 'orders'".into());
        assert!(format!("{err}").contains("KeyError"));

        let err = OrToolsError::Infeasible;
        assert!(format!("{err}").contains("nfeasible"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p vrppd-or-tools type_tests`
Expected: FAIL — `OrToolsError` not defined.

- [ ] **Step 3: Implement the types**

Replace the placeholder `crates/vrppd-or-tools/src/lib.rs` content with:

```rust
//! OR-Tools baseline crate for the adapted VRPPD. See
//! `docs/superpowers/specs/2026-05-11-or-tools-baseline-design.md` for the
//! full design.

use std::time::Duration;
use vrppd_core::Objective;

/// 30-minute default budget per instance — matches `vrppd_milp::DEFAULT_TIMEOUT`
/// and PLAN.md §3.3.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug)]
pub enum OrToolsError {
    /// EMPTY objective is not supported — see
    /// `documents/MILP_adaptation_notes.md` §4.5.
    UnsupportedObjective(Objective),
    /// `python3` not on PATH.
    PythonNotFound,
    /// `import ortools` failed inside the subprocess.
    OrtoolsImportFailed(String),
    /// Solver returned `FAILED`, exited non-zero, or produced malformed output.
    SolverFailed(String),
    /// Python raised an unexpected exception; `error_msg` from the script.
    SolverInternal(String),
    /// CP-SAT proved the model has no feasible solution.
    Infeasible,
}

impl std::fmt::Display for OrToolsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OrToolsError::UnsupportedObjective(o) => {
                write!(f, "OR-Tools does not support objective {o:?}")
            }
            OrToolsError::PythonNotFound => write!(f, "python3 not found on PATH"),
            OrToolsError::OrtoolsImportFailed(msg) => {
                write!(f, "ortools import failed: {msg}")
            }
            OrToolsError::SolverFailed(msg) => write!(f, "OR-Tools solver failed: {msg}"),
            OrToolsError::SolverInternal(msg) => {
                write!(f, "OR-Tools internal error: {msg}")
            }
            OrToolsError::Infeasible => write!(f, "Model is infeasible"),
        }
    }
}

impl std::error::Error for OrToolsError {}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OrToolsStatus {
    /// CP-SAT proved the returned `objective_value` is optimal.
    Optimal,
    /// Best-known solution found but optimality not proven. Routing's normal
    /// success state; CP-SAT's timeout-with-incumbent state.
    Feasible,
    /// No feasible solution found within the wall-clock budget.
    TimedOut,
}

#[derive(Clone, Copy, Debug)]
pub struct OrToolsResult {
    pub objective_value: f64,
    pub status: OrToolsStatus,
    pub solve_time_ms: u64,
}

#[cfg(test)]
mod type_tests {
    use super::*;
    use vrppd_core::Objective;

    #[test]
    fn error_display_includes_kind() {
        let err = OrToolsError::UnsupportedObjective(Objective::Empty);
        assert!(format!("{err}").contains("Empty"));

        let err = OrToolsError::PythonNotFound;
        assert!(format!("{err}").contains("python"));

        let err = OrToolsError::OrtoolsImportFailed("pip install ortools".into());
        assert!(format!("{err}").contains("ortools"));

        let err = OrToolsError::SolverFailed("model_invalid".into());
        assert!(format!("{err}").contains("model_invalid"));

        let err = OrToolsError::SolverInternal("KeyError: 'orders'".into());
        assert!(format!("{err}").contains("KeyError"));

        let err = OrToolsError::Infeasible;
        assert!(format!("{err}").contains("nfeasible"));
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p vrppd-or-tools type_tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/vrppd-or-tools/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(or-tools): error/status/result types

OrToolsError (6 variants), OrToolsStatus (Optimal/Feasible/TimedOut),
OrToolsResult, DEFAULT_TIMEOUT. Mirrors vrppd-milp's surface shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Public API skeleton with short-circuits

**Files:**
- Modify: `crates/vrppd-or-tools/src/lib.rs`

- [ ] **Step 1: Write failing unit tests for the short-circuits**

Append a new `#[cfg(test)]` module to `crates/vrppd-or-tools/src/lib.rs`:

```rust
#[cfg(test)]
mod shortcircuit_tests {
    use super::*;
    use vrppd_core::{Location, Objective, Order, Problem, Vehicle};

    fn loc(lat: f64, lon: f64) -> Location {
        Location {
            hash: format!("{lat},{lon}"),
            latitude: lat,
            longitude: lon,
        }
    }

    fn one_vehicle_one_order() -> Problem {
        Problem {
            vehicles: vec![Vehicle {
                id: 1,
                start_location: loc(0.0, 0.0),
                price_km: 1.0,
            }],
            orders: vec![Order {
                id: 1,
                pickup_location: loc(0.0, 0.0),
                delivery_location: loc(0.0, 0.5),
                load_factor: 1.0,
            }],
        }
    }

    #[test]
    fn empty_problem_routing_returns_zero_optimal() {
        let p = Problem { vehicles: vec![], orders: vec![] };
        let r = solve_routing(&p, Objective::Distance, Duration::from_secs(1), 1).unwrap();
        assert_eq!(r.objective_value, 0.0);
        assert_eq!(r.status, OrToolsStatus::Optimal);
        assert_eq!(r.solve_time_ms, 0);
    }

    #[test]
    fn empty_problem_cp_sat_returns_zero_optimal() {
        let p = Problem { vehicles: vec![], orders: vec![] };
        let r = solve_cp_sat(&p, Objective::Distance, Duration::from_secs(1), 1).unwrap();
        assert_eq!(r.objective_value, 0.0);
        assert_eq!(r.status, OrToolsStatus::Optimal);
    }

    #[test]
    fn empty_objective_routing_rejected() {
        let p = one_vehicle_one_order();
        let err = solve_routing(&p, Objective::Empty, Duration::from_secs(1), 1).unwrap_err();
        assert!(matches!(err, OrToolsError::UnsupportedObjective(Objective::Empty)));
    }

    #[test]
    fn empty_objective_cp_sat_rejected() {
        let p = one_vehicle_one_order();
        let err = solve_cp_sat(&p, Objective::Empty, Duration::from_secs(1), 1).unwrap_err();
        assert!(matches!(err, OrToolsError::UnsupportedObjective(Objective::Empty)));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p vrppd-or-tools shortcircuit_tests`
Expected: FAIL — `solve_routing` / `solve_cp_sat` not defined.

- [ ] **Step 3: Implement the public functions with short-circuits only**

Append to `crates/vrppd-or-tools/src/lib.rs` (after the type definitions, before the test modules):

```rust
use vrppd_core::Problem;

/// Solve the adapted VRPPD via OR-Tools Routing Solver. Returns a near-optimal
/// solution; never proves optimality (status is at most `Feasible`).
pub fn solve_routing(
    problem: &Problem,
    target: Objective,
    timeout: Duration,
    threads: usize,
) -> Result<OrToolsResult, OrToolsError> {
    if matches!(target, Objective::Empty) {
        return Err(OrToolsError::UnsupportedObjective(target));
    }
    if problem.orders.is_empty() || problem.vehicles.is_empty() {
        return Ok(OrToolsResult {
            objective_value: 0.0,
            status: OrToolsStatus::Optimal,
            solve_time_ms: 0,
        });
    }
    // Python dispatch lands in Task 6.
    let _ = (timeout, threads);
    Err(OrToolsError::SolverFailed(
        "solve_routing: Python dispatch not yet implemented".into(),
    ))
}

/// Solve the adapted VRPPD MILP via OR-Tools CP-SAT. Can prove optimality
/// (status `Optimal`); falls back to `Feasible` or `TimedOut` on budget
/// expiry.
pub fn solve_cp_sat(
    problem: &Problem,
    target: Objective,
    timeout: Duration,
    threads: usize,
) -> Result<OrToolsResult, OrToolsError> {
    if matches!(target, Objective::Empty) {
        return Err(OrToolsError::UnsupportedObjective(target));
    }
    if problem.orders.is_empty() || problem.vehicles.is_empty() {
        return Ok(OrToolsResult {
            objective_value: 0.0,
            status: OrToolsStatus::Optimal,
            solve_time_ms: 0,
        });
    }
    let _ = (timeout, threads);
    Err(OrToolsError::SolverFailed(
        "solve_cp_sat: Python dispatch not yet implemented".into(),
    ))
}

/// Convenience wrapper using `DEFAULT_TIMEOUT` and all available threads.
pub fn solve_routing_default(
    problem: &Problem,
    target: Objective,
) -> Result<OrToolsResult, OrToolsError> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    solve_routing(problem, target, DEFAULT_TIMEOUT, threads)
}

/// Convenience wrapper using `DEFAULT_TIMEOUT` and all available threads.
pub fn solve_cp_sat_default(
    problem: &Problem,
    target: Objective,
) -> Result<OrToolsResult, OrToolsError> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    solve_cp_sat(problem, target, DEFAULT_TIMEOUT, threads)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p vrppd-or-tools shortcircuit_tests`
Expected: PASS (all 4).

Run: `cargo test -p vrppd-or-tools`
Expected: PASS (type_tests + shortcircuit_tests).

- [ ] **Step 5: Commit**

```bash
git add crates/vrppd-or-tools/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(or-tools): public solve_routing/solve_cp_sat with short-circuits

EMPTY objective and empty-problem guards in place; Python dispatch
deferred to a follow-up. Tests cover both short-circuits for both
solver entry points.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire types (Rust serde)

**Files:**
- Create: `crates/vrppd-or-tools/src/wire.rs`
- Modify: `crates/vrppd-or-tools/src/lib.rs`

- [ ] **Step 1: Write the wire module**

Write `crates/vrppd-or-tools/src/wire.rs`:

```rust
//! JSON request/response types for the Python subprocess. The Python script
//! parses `SolverRequest` from stdin and writes a `SolverResponse` to stdout.

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub(crate) struct SolverRequest<'a> {
    pub solver: &'a str,         // "routing" | "cp_sat"
    pub objective: &'a str,      // "DISTANCE" | "PRICE"
    pub timeout_ms: u64,
    pub threads: usize,
    pub problem: WireProblem<'a>,
}

#[derive(Serialize)]
pub(crate) struct WireProblem<'a> {
    pub vehicles: Vec<WireVehicle<'a>>,
    pub orders: Vec<WireOrder<'a>>,
}

#[derive(Serialize)]
pub(crate) struct WireVehicle<'a> {
    pub id: u32,
    pub start_lat: f64,
    pub start_lon: f64,
    pub price_km: f64,
    #[serde(skip)]
    _marker: std::marker::PhantomData<&'a ()>,
}

impl<'a> WireVehicle<'a> {
    pub fn from_core(v: &vrppd_core::Vehicle) -> Self {
        Self {
            id: v.id,
            start_lat: v.start_location.latitude,
            start_lon: v.start_location.longitude,
            price_km: v.price_km,
            _marker: std::marker::PhantomData,
        }
    }
}

#[derive(Serialize)]
pub(crate) struct WireOrder<'a> {
    pub id: u32,
    pub pickup_lat: f64,
    pub pickup_lon: f64,
    pub delivery_lat: f64,
    pub delivery_lon: f64,
    pub load_factor: f64,
    #[serde(skip)]
    _marker: std::marker::PhantomData<&'a ()>,
}

impl<'a> WireOrder<'a> {
    pub fn from_core(o: &vrppd_core::Order) -> Self {
        Self {
            id: o.id,
            pickup_lat: o.pickup_location.latitude,
            pickup_lon: o.pickup_location.longitude,
            delivery_lat: o.delivery_location.latitude,
            delivery_lon: o.delivery_location.longitude,
            load_factor: o.load_factor,
            _marker: std::marker::PhantomData,
        }
    }
}

#[derive(Deserialize, Debug)]
pub(crate) struct SolverResponse {
    pub ok: bool,
    // Success fields
    pub objective_value: Option<f64>,
    pub status: Option<String>,
    pub solver_runtime_ms: Option<u64>,
    // Failure fields
    pub error_kind: Option<String>,
    pub error_msg: Option<String>,
}
```

- [ ] **Step 2: Add the module declaration in `lib.rs`**

Insert `mod wire;` at the top of `crates/vrppd-or-tools/src/lib.rs`, after the module doc comment.

- [ ] **Step 3: Verify it builds**

Run: `cargo build -p vrppd-or-tools`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/vrppd-or-tools/src/wire.rs crates/vrppd-or-tools/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(or-tools): serde wire types for Python subprocess protocol

SolverRequest/SolverResponse plus WireVehicle/WireOrder from-core
constructors. Wire format is flat (lat/lon fields rather than nested
Location) so the Python side reads the same shape it writes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Python script skeleton (no solvers yet)

**Files:**
- Create: `crates/vrppd-or-tools/python/solver.py`
- Create: `crates/vrppd-or-tools/python/requirements.txt`

- [ ] **Step 1: Write `requirements.txt`**

Write `crates/vrppd-or-tools/python/requirements.txt`:

```
ortools>=9.10,<10
```

- [ ] **Step 2: Write the script skeleton**

Write `crates/vrppd-or-tools/python/solver.py`:

```python
#!/usr/bin/env python3
"""OR-Tools driver for vrppd-or-tools.

Reads a JSON request from stdin, dispatches to the Routing Solver or CP-SAT,
writes a JSON response to stdout. Run `--self-test` to verify the install.

Wire format documented in
docs/superpowers/specs/2026-05-11-or-tools-baseline-design.md.
"""

import json
import math
import sys
import time

EARTH_RADIUS_KM = 6371.0
DIST_SCALE = 1_000_000  # 1e6: sub-millimetre precision on lat/lon-derived km.


def haversine_km(lat1, lon1, lat2, lon2):
    """Mirror of vrppd_core::haversine_km. Returns kilometres."""
    rlat1 = math.radians(lat1)
    rlat2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_KM * c


def self_test():
    """Verify both OR-Tools modules import and print versions."""
    import ortools
    from ortools.sat.python import cp_model  # noqa: F401
    from ortools.constraint_solver import pywrapcp  # noqa: F401
    print(f"ortools version: {ortools.__version__}")
    print("cp_model: OK")
    print("pywrapcp: OK")
    return 0


def fail(error_kind, error_msg):
    sys.stdout.write(json.dumps({
        "ok": False,
        "error_kind": error_kind,
        "error_msg": error_msg,
    }))
    sys.stdout.flush()
    sys.exit(1)


def succeed(objective_value, status, solver_runtime_ms):
    sys.stdout.write(json.dumps({
        "ok": True,
        "objective_value": float(objective_value),
        "status": status,
        "solver_runtime_ms": int(solver_runtime_ms),
    }))
    sys.stdout.flush()


def solve_routing(req):
    """Placeholder. Real implementation lands in a follow-up task."""
    return fail("solver_internal", "routing solver not yet implemented")


def solve_cp_sat(req):
    """Placeholder. Real implementation lands in a follow-up task."""
    return fail("solver_internal", "cp_sat solver not yet implemented")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        return self_test()

    try:
        from ortools.sat.python import cp_model  # noqa: F401
        from ortools.constraint_solver import pywrapcp  # noqa: F401
    except ImportError as e:
        fail("ortools_import", str(e))

    try:
        req = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        fail("invalid_request", f"stdin JSON parse: {e}")

    solver = req.get("solver")
    if solver == "routing":
        solve_routing(req)
    elif solver == "cp_sat":
        solve_cp_sat(req)
    else:
        fail("invalid_request", f"unknown solver: {solver!r}")


if __name__ == "__main__":
    sys.exit(main() or 0)
```

- [ ] **Step 3: Manual verification — install ortools and run self-test**

Run: `pip install -r crates/vrppd-or-tools/python/requirements.txt`
Expected: ortools installs (may take 1–2 min on first run).

Run: `python3 crates/vrppd-or-tools/python/solver.py --self-test`
Expected output (version may differ):
```
ortools version: 9.x.xxxx
cp_model: OK
pywrapcp: OK
```

- [ ] **Step 4: Verify the script returns valid JSON on a stub request**

Run:
```bash
echo '{"solver":"routing","objective":"DISTANCE","timeout_ms":1000,"threads":1,"problem":{"vehicles":[],"orders":[]}}' | python3 crates/vrppd-or-tools/python/solver.py
```

Expected output (exit code 1):
```
{"ok": false, "error_kind": "solver_internal", "error_msg": "routing solver not yet implemented"}
```

- [ ] **Step 5: Commit**

```bash
git add crates/vrppd-or-tools/python/
git commit -m "$(cat <<'EOF'
feat(or-tools): python script skeleton + requirements.txt

Driver dispatches on solver field, handles --self-test, surfaces typed
errors via JSON. Both solver entry points return a "not implemented"
placeholder; real models land in follow-ups.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rust subprocess plumbing

**Files:**
- Modify: `crates/vrppd-or-tools/src/lib.rs`
- Create: `crates/vrppd-or-tools/tests/integration.rs`

- [ ] **Step 1: Write failing integration test for the plumbing**

Write `crates/vrppd-or-tools/tests/integration.rs`:

```rust
//! Integration tests for vrppd-or-tools. Gated behind `VRPPD_TEST_ORTOOLS=1`
//! since they spawn the Python subprocess (requires `pip install ortools`).
//!
//! Run with: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration`.

use std::time::Duration;
use vrppd_core::{Location, Objective, Order, Problem, Vehicle};
use vrppd_or_tools::{solve_cp_sat, solve_routing, OrToolsError, OrToolsStatus};

fn skip_unless_enabled() -> bool {
    if std::env::var("VRPPD_TEST_ORTOOLS").is_err() {
        eprintln!("skipping (set VRPPD_TEST_ORTOOLS=1 to run)");
        return true;
    }
    false
}

fn loc(lat: f64, lon: f64) -> Location {
    Location {
        hash: format!("{lat},{lon}"),
        latitude: lat,
        longitude: lon,
    }
}

fn one_vehicle_one_order() -> Problem {
    Problem {
        vehicles: vec![Vehicle {
            id: 1,
            start_location: loc(54.6872, 25.2797),
            price_km: 1.0,
        }],
        orders: vec![Order {
            id: 1,
            pickup_location: loc(54.6872, 25.2797),
            delivery_location: loc(54.7000, 25.3000),
            load_factor: 1.0,
        }],
    }
}

#[test]
fn plumbing_surfaces_solver_internal_for_placeholder() {
    if skip_unless_enabled() {
        return;
    }
    let p = one_vehicle_one_order();
    // The Python placeholder returns error_kind="solver_internal", which the
    // Rust side maps to OrToolsError::SolverInternal.
    let err = solve_routing(&p, Objective::Distance, Duration::from_secs(10), 1).unwrap_err();
    match err {
        OrToolsError::SolverInternal(msg) => {
            assert!(msg.contains("not yet implemented"), "unexpected msg: {msg}");
        }
        other => panic!("expected SolverInternal, got {other:?}"),
    }
}
```

- [ ] **Step 2: Run test to verify it fails (and prints skip notice without env var)**

Run without env: `cargo test -p vrppd-or-tools --test integration plumbing_surfaces`
Expected: PASS but stderr shows "skipping (set VRPPD_TEST_ORTOOLS=1 to run)".

Run with env: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration plumbing_surfaces`
Expected: FAIL — `solve_routing` still returns the hardcoded `"Python dispatch not yet implemented"` (Rust-side stub).

- [ ] **Step 3: Implement the subprocess plumbing**

Replace the bodies of `solve_routing` and `solve_cp_sat` in `crates/vrppd-or-tools/src/lib.rs` and add the helper `run_python`. The final state of `crates/vrppd-or-tools/src/lib.rs` after this edit:

```rust
//! OR-Tools baseline crate for the adapted VRPPD. See
//! `docs/superpowers/specs/2026-05-11-or-tools-baseline-design.md` for the
//! full design.

mod wire;

use std::io::{ErrorKind, Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use vrppd_core::{Objective, Problem};

use crate::wire::{SolverRequest, SolverResponse, WireOrder, WireProblem, WireVehicle};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug)]
pub enum OrToolsError {
    UnsupportedObjective(Objective),
    PythonNotFound,
    OrtoolsImportFailed(String),
    SolverFailed(String),
    SolverInternal(String),
    Infeasible,
}

impl std::fmt::Display for OrToolsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OrToolsError::UnsupportedObjective(o) => {
                write!(f, "OR-Tools does not support objective {o:?}")
            }
            OrToolsError::PythonNotFound => write!(f, "python3 not found on PATH"),
            OrToolsError::OrtoolsImportFailed(msg) => write!(f, "ortools import failed: {msg}"),
            OrToolsError::SolverFailed(msg) => write!(f, "OR-Tools solver failed: {msg}"),
            OrToolsError::SolverInternal(msg) => write!(f, "OR-Tools internal error: {msg}"),
            OrToolsError::Infeasible => write!(f, "Model is infeasible"),
        }
    }
}

impl std::error::Error for OrToolsError {}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OrToolsStatus {
    Optimal,
    Feasible,
    TimedOut,
}

#[derive(Clone, Copy, Debug)]
pub struct OrToolsResult {
    pub objective_value: f64,
    pub status: OrToolsStatus,
    pub solve_time_ms: u64,
}

pub fn solve_routing(
    problem: &Problem,
    target: Objective,
    timeout: Duration,
    threads: usize,
) -> Result<OrToolsResult, OrToolsError> {
    dispatch("routing", problem, target, timeout, threads)
}

pub fn solve_cp_sat(
    problem: &Problem,
    target: Objective,
    timeout: Duration,
    threads: usize,
) -> Result<OrToolsResult, OrToolsError> {
    dispatch("cp_sat", problem, target, timeout, threads)
}

pub fn solve_routing_default(
    problem: &Problem,
    target: Objective,
) -> Result<OrToolsResult, OrToolsError> {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    solve_routing(problem, target, DEFAULT_TIMEOUT, threads)
}

pub fn solve_cp_sat_default(
    problem: &Problem,
    target: Objective,
) -> Result<OrToolsResult, OrToolsError> {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    solve_cp_sat(problem, target, DEFAULT_TIMEOUT, threads)
}

fn dispatch(
    solver: &str,
    problem: &Problem,
    target: Objective,
    timeout: Duration,
    threads: usize,
) -> Result<OrToolsResult, OrToolsError> {
    if matches!(target, Objective::Empty) {
        return Err(OrToolsError::UnsupportedObjective(target));
    }
    if problem.orders.is_empty() || problem.vehicles.is_empty() {
        return Ok(OrToolsResult {
            objective_value: 0.0,
            status: OrToolsStatus::Optimal,
            solve_time_ms: 0,
        });
    }

    let started = Instant::now();
    let objective_str = match target {
        Objective::Distance => "DISTANCE",
        Objective::Price => "PRICE",
        Objective::Empty => unreachable!("guarded above"),
    };

    let request = SolverRequest {
        solver,
        objective: objective_str,
        timeout_ms: timeout.as_millis() as u64,
        threads: threads.max(1),
        problem: WireProblem {
            vehicles: problem.vehicles.iter().map(WireVehicle::from_core).collect(),
            orders: problem.orders.iter().map(WireOrder::from_core).collect(),
        },
    };

    let response = run_python(&request)?;
    let solve_time_ms = response.solver_runtime_ms.unwrap_or(started.elapsed().as_millis() as u64);

    if !response.ok {
        let kind = response.error_kind.as_deref().unwrap_or("");
        let msg = response.error_msg.unwrap_or_default();
        return Err(match kind {
            "ortools_import" => OrToolsError::OrtoolsImportFailed(msg),
            "invalid_request" => OrToolsError::SolverFailed(msg),
            _ => OrToolsError::SolverInternal(msg),
        });
    }

    let status_str = response.status.as_deref().unwrap_or("");
    let status = match status_str {
        "OPTIMAL" => OrToolsStatus::Optimal,
        "FEASIBLE" => OrToolsStatus::Feasible,
        "TIMED_OUT" => OrToolsStatus::TimedOut,
        "INFEASIBLE" => return Err(OrToolsError::Infeasible),
        "FAILED" => return Err(OrToolsError::SolverFailed("FAILED".into())),
        other => return Err(OrToolsError::SolverFailed(format!("unknown status: {other}"))),
    };

    let objective_value = response.objective_value.unwrap_or(0.0).max(0.0);
    Ok(OrToolsResult {
        objective_value,
        status,
        solve_time_ms,
    })
}

fn script_path() -> String {
    std::env::var("VRPPD_ORTOOLS_PY").unwrap_or_else(|_| {
        concat!(env!("CARGO_MANIFEST_DIR"), "/python/solver.py").to_string()
    })
}

fn run_python(request: &SolverRequest) -> Result<SolverResponse, OrToolsError> {
    let script = script_path();
    let mut child = match Command::new("python3")
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) if e.kind() == ErrorKind::NotFound => return Err(OrToolsError::PythonNotFound),
        Err(e) => return Err(OrToolsError::SolverFailed(format!("spawn python3: {e}"))),
    };

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| OrToolsError::SolverFailed("python3 stdin not piped".into()))?;
        let json = serde_json::to_vec(request)
            .map_err(|e| OrToolsError::SolverFailed(format!("serialize request: {e}")))?;
        stdin
            .write_all(&json)
            .map_err(|e| OrToolsError::SolverFailed(format!("write stdin: {e}")))?;
    }
    // Drop stdin so Python sees EOF.
    drop(child.stdin.take());

    let mut stdout = String::new();
    if let Some(mut s) = child.stdout.take() {
        s.read_to_string(&mut stdout)
            .map_err(|e| OrToolsError::SolverFailed(format!("read stdout: {e}")))?;
    }
    let mut stderr = String::new();
    if let Some(mut s) = child.stderr.take() {
        let _ = s.read_to_string(&mut stderr);
    }

    let status = child
        .wait()
        .map_err(|e| OrToolsError::SolverFailed(format!("wait: {e}")))?;

    let parsed: SolverResponse = match serde_json::from_str(&stdout) {
        Ok(v) => v,
        Err(e) => {
            let exit = status.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".into());
            return Err(OrToolsError::SolverFailed(format!(
                "parse stdout (exit={exit}): {e}; stdout={stdout:?}; stderr={stderr:?}"
            )));
        }
    };
    Ok(parsed)
}

#[cfg(test)]
mod type_tests {
    use super::*;
    use vrppd_core::Objective;

    #[test]
    fn error_display_includes_kind() {
        let err = OrToolsError::UnsupportedObjective(Objective::Empty);
        assert!(format!("{err}").contains("Empty"));

        let err = OrToolsError::PythonNotFound;
        assert!(format!("{err}").contains("python"));

        let err = OrToolsError::OrtoolsImportFailed("pip install ortools".into());
        assert!(format!("{err}").contains("ortools"));

        let err = OrToolsError::SolverFailed("model_invalid".into());
        assert!(format!("{err}").contains("model_invalid"));

        let err = OrToolsError::SolverInternal("KeyError: 'orders'".into());
        assert!(format!("{err}").contains("KeyError"));

        let err = OrToolsError::Infeasible;
        assert!(format!("{err}").contains("nfeasible"));
    }
}

#[cfg(test)]
mod shortcircuit_tests {
    use super::*;
    use vrppd_core::{Location, Objective, Order, Problem, Vehicle};

    fn loc(lat: f64, lon: f64) -> Location {
        Location {
            hash: format!("{lat},{lon}"),
            latitude: lat,
            longitude: lon,
        }
    }

    fn one_vehicle_one_order() -> Problem {
        Problem {
            vehicles: vec![Vehicle {
                id: 1,
                start_location: loc(0.0, 0.0),
                price_km: 1.0,
            }],
            orders: vec![Order {
                id: 1,
                pickup_location: loc(0.0, 0.0),
                delivery_location: loc(0.0, 0.5),
                load_factor: 1.0,
            }],
        }
    }

    #[test]
    fn empty_problem_routing_returns_zero_optimal() {
        let p = Problem { vehicles: vec![], orders: vec![] };
        let r = solve_routing(&p, Objective::Distance, Duration::from_secs(1), 1).unwrap();
        assert_eq!(r.objective_value, 0.0);
        assert_eq!(r.status, OrToolsStatus::Optimal);
        assert_eq!(r.solve_time_ms, 0);
    }

    #[test]
    fn empty_problem_cp_sat_returns_zero_optimal() {
        let p = Problem { vehicles: vec![], orders: vec![] };
        let r = solve_cp_sat(&p, Objective::Distance, Duration::from_secs(1), 1).unwrap();
        assert_eq!(r.objective_value, 0.0);
        assert_eq!(r.status, OrToolsStatus::Optimal);
    }

    #[test]
    fn empty_objective_routing_rejected() {
        let p = one_vehicle_one_order();
        let err = solve_routing(&p, Objective::Empty, Duration::from_secs(1), 1).unwrap_err();
        assert!(matches!(err, OrToolsError::UnsupportedObjective(Objective::Empty)));
    }

    #[test]
    fn empty_objective_cp_sat_rejected() {
        let p = one_vehicle_one_order();
        let err = solve_cp_sat(&p, Objective::Empty, Duration::from_secs(1), 1).unwrap_err();
        assert!(matches!(err, OrToolsError::UnsupportedObjective(Objective::Empty)));
    }
}
```

- [ ] **Step 4: Run unit tests (short-circuits still pass)**

Run: `cargo test -p vrppd-or-tools --lib`
Expected: PASS (type_tests + shortcircuit_tests).

- [ ] **Step 5: Run integration test with env var**

Run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration plumbing_surfaces`
Expected: PASS — `solve_routing` now spawns Python, Python returns the placeholder `solver_internal` error, Rust maps it to `OrToolsError::SolverInternal` containing "not yet implemented".

- [ ] **Step 6: Commit**

```bash
git add crates/vrppd-or-tools/src/lib.rs crates/vrppd-or-tools/tests/integration.rs
git commit -m "$(cat <<'EOF'
feat(or-tools): rust↔python subprocess plumbing

dispatch() builds the SolverRequest, spawns python3, parses
SolverResponse, maps error_kind/status to typed errors and the
OrToolsStatus enum. Integration test (env-gated) confirms the
placeholder Python error round-trips correctly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: CP-SAT model in Python

**Files:**
- Modify: `crates/vrppd-or-tools/python/solver.py`
- Modify: `crates/vrppd-or-tools/tests/integration.rs`

- [ ] **Step 1: Write failing integration test `cp_sat_n1_matches_bf`**

Append to `crates/vrppd-or-tools/tests/integration.rs`:

```rust
#[test]
fn cp_sat_n1_matches_bf() {
    if skip_unless_enabled() {
        return;
    }
    let p = one_vehicle_one_order();
    let bf = vrppd_brute_force::solve(&p);
    let bf_optimum = bf.best_distance_solution.total_distance;

    let r = solve_cp_sat(&p, Objective::Distance, Duration::from_secs(30), 2).unwrap();
    assert_eq!(r.status, OrToolsStatus::Optimal);
    assert!(
        (r.objective_value - bf_optimum).abs() < 1e-2,
        "CP-SAT {} vs BF {}",
        r.objective_value,
        bf_optimum
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration cp_sat_n1_matches_bf`
Expected: FAIL — Python returns "not yet implemented".

- [ ] **Step 3: Implement CP-SAT in `solver.py`**

In `crates/vrppd-or-tools/python/solver.py`, replace the `solve_cp_sat` placeholder with the implementation below, and add the `build_geometry` and `_status_str` helpers near the top of the file (after `haversine_km`):

```python
def build_geometry(req):
    """Build the node layout and distance matrix shared by both solvers.

    Nodes are laid out as in vrppd-milp's NodeIndex:
      start_0 ... start_{V-1} | pickup_0 ... pickup_{N-1} | delivery_0 ... delivery_{N-1}
    """
    V = len(req["problem"]["vehicles"])
    N = len(req["problem"]["orders"])
    coords = []
    for v in req["problem"]["vehicles"]:
        coords.append((v["start_lat"], v["start_lon"]))
    for o in req["problem"]["orders"]:
        coords.append((o["pickup_lat"], o["pickup_lon"]))
    for o in req["problem"]["orders"]:
        coords.append((o["delivery_lat"], o["delivery_lon"]))
    num_nodes = len(coords)

    def node_dist_km(i, j):
        if i == j:
            return 0.0
        return haversine_km(coords[i][0], coords[i][1], coords[j][0], coords[j][1])

    return {"V": V, "N": N, "coords": coords, "num_nodes": num_nodes, "dist_km": node_dist_km}


def _objective_weight(req, v):
    target = req["objective"]
    if target == "DISTANCE":
        return 1.0
    if target == "PRICE":
        return req["problem"]["vehicles"][v]["price_km"]
    raise ValueError(f"unsupported objective: {target}")


def solve_cp_sat(req):
    from ortools.sat.python import cp_model

    started = time.monotonic()
    g = build_geometry(req)
    V, N = g["V"], g["N"]
    start = lambda v: v
    pickup = lambda o: V + o
    delivery = lambda o: V + N + o

    def vehicle_nodes(v):
        return [start(v)] + [V + i for i in range(2 * N)]

    def is_pickup(node):
        if V <= node < V + N:
            return node - V
        return None

    def is_delivery(node):
        if V + N <= node < V + 2 * N:
            return node - V - N
        return None

    model = cp_model.CpModel()

    # y_ov
    y = {}
    for o in range(N):
        for v in range(V):
            y[(o, v)] = model.NewBoolVar(f"y_{o}_{v}")

    # x_ijv for nodes in L_v with i != j; scale arc cost by DIST_SCALE * weight
    x = {}
    obj_coeffs = []  # list of (var, int_coeff) for the objective
    for v in range(V):
        nodes = vehicle_nodes(v)
        weight = _objective_weight(req, v)
        s = start(v)
        for i in nodes:
            for j in nodes:
                if i == j:
                    continue
                xv = model.NewBoolVar(f"x_{i}_{j}_{v}")
                x[(i, j, v)] = xv
                if j == s:
                    cost = 0
                else:
                    cost = int(round(g["dist_km"](i, j) * weight * DIST_SCALE))
                if cost != 0:
                    obj_coeffs.append((xv, cost))

    # q_iv: scaled load. MAX_LOAD = 1.0 → DIST_SCALE units.
    q = {}
    for v in range(V):
        q[(start(v), v)] = model.NewIntVar(0, 0, f"q_start_{v}")  # pinned at 0
        for i in [V + k for k in range(2 * N)]:
            q[(i, v)] = model.NewIntVar(0, DIST_SCALE, f"q_{i}_{v}")

    # u_iv: MTZ position. Range [0, 2N].
    u = {}
    M_u = 2 * N
    for v in range(V):
        for i in [V + k for k in range(2 * N)]:
            u[(i, v)] = model.NewIntVar(0, M_u, f"u_{i}_{v}")

    # Constraint 1: Σ_v y_ov = 1
    for o in range(N):
        model.Add(sum(y[(o, v)] for v in range(V)) == 1)

    # Constraint 2: tour starts at most once
    for v in range(V):
        s = start(v)
        terms = [x[(s, j, v)] for j in [V + k for k in range(2 * N)] if (s, j, v) in x]
        if terms:
            model.Add(sum(terms) <= 1)

    # Constraint 3: order servicing (flow conservation, both directions, both
    # pickup and delivery)
    for o in range(N):
        for v in range(V):
            p = pickup(o)
            d = delivery(o)
            nodes = vehicle_nodes(v)
            into_p = [x[(k, p, v)] for k in nodes if k != p and (k, p, v) in x]
            out_p = [x[(p, k, v)] for k in nodes if k != p and (p, k, v) in x]
            into_d = [x[(k, d, v)] for k in nodes if k != d and (k, d, v) in x]
            out_d = [x[(d, k, v)] for k in nodes if k != d and (d, k, v) in x]
            for row in [into_p, out_p, into_d, out_d]:
                model.Add(sum(row) == y[(o, v)])

    # Constraint 4: pickup-before-delivery via MTZ
    for o in range(N):
        for v in range(V):
            p = pickup(o)
            d = delivery(o)
            # u_p - u_d + M_u * y_ov <= M_u - 1
            model.Add(u[(p, v)] - u[(d, v)] + M_u * y[(o, v)] <= M_u - 1)

    # Constraint 5: capacity flow with Big-M linearisation. M_q = 2 * DIST_SCALE.
    M_q = 2 * DIST_SCALE
    for v in range(V):
        nodes = vehicle_nodes(v)
        for i in nodes:
            for j in nodes:
                if i == j:
                    continue
                jp = is_pickup(j)
                jd = is_delivery(j)
                if jp is None and jd is None:
                    continue  # no flow into a start
                xij = x[(i, j, v)]
                qj = q[(j, v)]
                # Δ_i contribution from y_ov for the pickup/delivery at i
                delta_terms = []
                ip = is_pickup(i)
                id_ = is_delivery(i)
                if ip is not None:
                    w = int(round(DIST_SCALE / req["problem"]["orders"][ip]["load_factor"]))
                    delta_terms.append((y[(ip, v)], w))
                elif id_ is not None:
                    w = int(round(DIST_SCALE / req["problem"]["orders"][id_]["load_factor"]))
                    delta_terms.append((y[(id_, v)], -w))
                # q_j - q_i - Δ_i [in -M_q..M_q] when x_ij = 1; else relaxed.
                lhs = [qj]
                if i != start(v):
                    lhs.append(-q[(i, v)])
                for var, coef in delta_terms:
                    lhs.append(-coef * var if coef >= 0 else None)
                # CP-SAT doesn't accept negative-coefficient expressions inline
                # the same way good_lp does; build explicitly:
                expr = qj
                if i != start(v):
                    expr = expr - q[(i, v)]
                for var, coef in delta_terms:
                    expr = expr - coef * var
                # lower: expr - M_q*xij >= -M_q   ⇔   expr - M_q*xij + M_q >= 0
                model.Add(expr - M_q * xij >= -M_q)
                # upper: expr + M_q*xij <= M_q
                model.Add(expr + M_q * xij <= M_q)
                # (lhs intermediate variable above is no longer needed; drop it)

    # Constraint 6: MTZ subtour elimination across service nodes
    M_n = 2 * N
    svc = [V + k for k in range(2 * N)]
    for v in range(V):
        for i in svc:
            for j in svc:
                if i == j:
                    continue
                if (i, j, v) in x:
                    model.Add(u[(i, v)] - u[(j, v)] + M_n * x[(i, j, v)] <= M_n - 1)

    model.Minimize(sum(coef * var for var, coef in obj_coeffs))

    solver = cp_model.CpSolver()
    solver.parameters.num_workers = max(1, req["threads"])
    solver.parameters.max_time_in_seconds = max(0.001, req["timeout_ms"] / 1000.0)
    solver.parameters.log_search_progress = False

    status = solver.Solve(model)

    status_str = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "FAILED",
        cp_model.UNKNOWN: "FAILED",
    }.get(status, "FAILED")

    if status_str in ("OPTIMAL", "FEASIBLE"):
        value = solver.ObjectiveValue() / DIST_SCALE
    else:
        value = 0.0

    elapsed_ms = int((time.monotonic() - started) * 1000)
    return succeed(value, status_str, elapsed_ms)
```

Note: The intermediate `lhs` list in the capacity loop is dead — remove it and only keep the `expr`-based form. Final cleaned-up capacity block:

```python
    M_q = 2 * DIST_SCALE
    for v in range(V):
        nodes = vehicle_nodes(v)
        for i in nodes:
            for j in nodes:
                if i == j:
                    continue
                if is_pickup(j) is None and is_delivery(j) is None:
                    continue
                xij = x[(i, j, v)]
                expr = q[(j, v)]
                if i != start(v):
                    expr = expr - q[(i, v)]
                ip = is_pickup(i)
                id_ = is_delivery(i)
                if ip is not None:
                    w = int(round(DIST_SCALE / req["problem"]["orders"][ip]["load_factor"]))
                    expr = expr - w * y[(ip, v)]
                elif id_ is not None:
                    w = int(round(DIST_SCALE / req["problem"]["orders"][id_]["load_factor"]))
                    expr = expr + w * y[(id_, v)]
                model.Add(expr - M_q * xij >= -M_q)
                model.Add(expr + M_q * xij <= M_q)
```

Use this cleaned-up block in `solver.py`.

- [ ] **Step 4: Run the CP-SAT test**

Run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration cp_sat_n1_matches_bf`
Expected: PASS — CP-SAT finds the trivial N=1 optimum (distance = pickup-to-delivery), `status == Optimal`.

- [ ] **Step 5: Manually sanity-check the plumbing with a quick stdin test**

Run:
```bash
echo '{"solver":"cp_sat","objective":"DISTANCE","timeout_ms":30000,"threads":2,"problem":{"vehicles":[{"id":1,"start_lat":54.6872,"start_lon":25.2797,"price_km":1.0}],"orders":[{"id":1,"pickup_lat":54.6872,"pickup_lon":25.2797,"delivery_lat":54.7000,"delivery_lon":25.3000,"load_factor":1.0}]}}' | python3 crates/vrppd-or-tools/python/solver.py
```

Expected: JSON output with `"ok": true`, `"status": "OPTIMAL"`, `"objective_value"` ≈ 3.4 (km from 54.6872,25.2797 to 54.7000,25.3000, depends on Haversine — ballpark check only).

- [ ] **Step 6: Commit**

```bash
git add crates/vrppd-or-tools/python/solver.py crates/vrppd-or-tools/tests/integration.rs
git commit -m "$(cat <<'EOF'
feat(or-tools): CP-SAT model + N=1 BF-match test

Translates the vrppd-milp constraint set to CP-SAT primitives, scaled
to integers by DIST_SCALE=1e6. Integration test confirms parity with
brute-force on the trivial 1×1 instance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: CP-SAT N=3 against BF fixture

**Files:**
- Modify: `crates/vrppd-or-tools/tests/integration.rs`

- [ ] **Step 1: Write failing test `cp_sat_n3_matches_bf`**

Append to `crates/vrppd-or-tools/tests/integration.rs`:

```rust
#[test]
fn cp_sat_n3_matches_bf() {
    if skip_unless_enabled() {
        return;
    }
    use std::path::PathBuf;

    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("../vrppd-bounds/tests/fixtures/two_vehicles_three_orders.json");
    let raw = std::fs::read_to_string(&path).unwrap();
    let problem: Problem = serde_json::from_str(&raw).unwrap();

    let bf = vrppd_brute_force::solve(&problem);
    let bf_optimum = bf.best_distance_solution.total_distance;

    let r = solve_cp_sat(&problem, Objective::Distance, Duration::from_secs(60), 2).unwrap();
    assert_eq!(
        r.status,
        OrToolsStatus::Optimal,
        "CP-SAT did not prove optimum in 60s on the 2v3o fixture"
    );
    assert!(
        (r.objective_value - bf_optimum).abs() < 1e-3,
        "CP-SAT {} vs BF {}",
        r.objective_value,
        bf_optimum
    );
}
```

Add `serde_json` to the test imports if not already present (it's a transitive dep of vrppd-core, but tests may need an explicit import).

- [ ] **Step 2: Add `serde_json` to dev-dependencies**

Edit `crates/vrppd-or-tools/Cargo.toml` `[dev-dependencies]` section so it reads:

```toml
[dev-dependencies]
vrppd-brute-force = { workspace = true }
serde_json = { workspace = true }
```

- [ ] **Step 3: Run the new test**

Run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration cp_sat_n3_matches_bf -- --nocapture`
Expected: PASS — CP-SAT proves the BF optimum within 60s budget.

If it fails with a status other than `Optimal`, the most likely cause is a model bug (a constraint mistranslated). Use `cargo test ... -- --nocapture` to see the assert message; cross-reference each constraint against `crates/vrppd-milp/src/lib.rs` constraints 1–6.

- [ ] **Step 4: Commit**

```bash
git add crates/vrppd-or-tools/Cargo.toml crates/vrppd-or-tools/tests/integration.rs
git commit -m "$(cat <<'EOF'
test(or-tools): CP-SAT vs BF on the 2v3o bounds fixture

Same fixture vrppd-milp uses for its warm-start regression test.
Confirms CP-SAT proves the BF optimum within a 60s budget.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: CP-SAT timeout test

**Files:**
- Modify: `crates/vrppd-or-tools/tests/integration.rs`

- [ ] **Step 1: Write failing test `cp_sat_status_timeout`**

Append to `crates/vrppd-or-tools/tests/integration.rs`:

```rust
#[test]
fn cp_sat_status_timeout() {
    if skip_unless_enabled() {
        return;
    }
    use std::path::PathBuf;

    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("../vrppd-bounds/tests/fixtures/two_vehicles_three_orders.json");
    let raw = std::fs::read_to_string(&path).unwrap();
    let problem: Problem = serde_json::from_str(&raw).unwrap();

    // 1 ms is well below CP-SAT's startup overhead → status must be
    // FEASIBLE (incumbent found by primal heuristic) or TIMED_OUT.
    let r = solve_cp_sat(&problem, Objective::Distance, Duration::from_millis(1), 1).unwrap();
    assert!(
        matches!(r.status, OrToolsStatus::Feasible | OrToolsStatus::TimedOut),
        "expected Feasible or TimedOut, got {:?}",
        r.status
    );
}
```

- [ ] **Step 2: Run the test**

Run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration cp_sat_status_timeout`
Expected: PASS — CP-SAT returns `Feasible` or `TimedOut` without erroring.

- [ ] **Step 3: Commit**

```bash
git add crates/vrppd-or-tools/tests/integration.rs
git commit -m "$(cat <<'EOF'
test(or-tools): CP-SAT honours sub-second timeouts cleanly

1 ms budget on the 2v3o fixture exercises the FEASIBLE/TIMED_OUT
status mapping path without erroring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Routing model in Python

**Files:**
- Modify: `crates/vrppd-or-tools/python/solver.py`
- Modify: `crates/vrppd-or-tools/tests/integration.rs`

- [ ] **Step 1: Write failing tests `routing_n1_matches_bf` and `routing_n3_within_tolerance`**

Append to `crates/vrppd-or-tools/tests/integration.rs`:

```rust
#[test]
fn routing_n1_matches_bf() {
    if skip_unless_enabled() {
        return;
    }
    let p = one_vehicle_one_order();
    let bf = vrppd_brute_force::solve(&p);
    let bf_optimum = bf.best_distance_solution.total_distance;

    let r = solve_routing(&p, Objective::Distance, Duration::from_secs(10), 1).unwrap();
    assert!(
        matches!(r.status, OrToolsStatus::Feasible | OrToolsStatus::Optimal),
        "Routing returned {:?}",
        r.status
    );
    assert!(
        (r.objective_value - bf_optimum).abs() < 1e-2,
        "Routing {} vs BF {}",
        r.objective_value,
        bf_optimum
    );
}

#[test]
fn routing_n3_within_tolerance() {
    if skip_unless_enabled() {
        return;
    }
    use std::path::PathBuf;

    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("../vrppd-bounds/tests/fixtures/two_vehicles_three_orders.json");
    let raw = std::fs::read_to_string(&path).unwrap();
    let problem: Problem = serde_json::from_str(&raw).unwrap();

    let bf = vrppd_brute_force::solve(&problem);
    let bf_optimum = bf.best_distance_solution.total_distance;

    let r = solve_routing(&problem, Objective::Distance, Duration::from_secs(30), 1).unwrap();
    assert_eq!(r.status, OrToolsStatus::Feasible);
    assert!(
        r.objective_value >= bf_optimum - 1e-3,
        "Routing {} below proven optimum {} — model/scaling bug",
        r.objective_value,
        bf_optimum
    );
    assert!(
        r.objective_value <= bf_optimum * 1.05,
        "Routing {} above 5% tolerance vs BF {}",
        r.objective_value,
        bf_optimum
    );
}
```

- [ ] **Step 2: Verify they fail**

Run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration routing_`
Expected: FAIL (both) — Python returns "routing solver not yet implemented".

- [ ] **Step 3: Implement the Routing model in `solver.py`**

In `crates/vrppd-or-tools/python/solver.py`, replace the `solve_routing` placeholder with:

```python
def solve_routing(req):
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2

    started = time.monotonic()
    g = build_geometry(req)
    V, N = g["V"], g["N"]
    num_nodes = g["num_nodes"]

    # Vehicle start = its own physical start node. End = same node; the cost
    # callback returns 0 for arcs that end at any vehicle's start so the
    # closing leg is free (matches vrppd-milp's "free return-to-start" rule).
    starts = [v for v in range(V)]
    ends = [v for v in range(V)]

    manager = pywrapcp.RoutingIndexManager(num_nodes, V, starts, ends)
    routing = pywrapcp.RoutingModel(manager)

    start_node_set = set(starts)

    # One transit callback per vehicle to scale by price_km when target is PRICE.
    transit_callback_ids = []
    for v in range(V):
        weight = _objective_weight(req, v)

        def make_cb(weight_v):
            def cb(from_index, to_index):
                from_node = manager.IndexToNode(from_index)
                to_node = manager.IndexToNode(to_index)
                if to_node in start_node_set:
                    return 0
                return int(round(g["dist_km"](from_node, to_node) * weight_v * DIST_SCALE))
            return cb

        idx = routing.RegisterTransitCallback(make_cb(weight))
        routing.SetArcCostEvaluatorOfVehicle(idx, v)
        transit_callback_ids.append(idx)

    # Distance dimension for pickup-delivery precedence (uses a constant unit
    # transit so precedence is purely on node sequence; the objective itself is
    # handled by SetArcCostEvaluatorOfVehicle above).
    unit_cb = routing.RegisterUnaryTransitCallback(lambda _idx: 1)
    routing.AddDimension(
        unit_cb,
        0,
        2 * N + V,
        True,
        "Order",
    )
    order_dim = routing.GetDimensionOrDie("Order")

    # Capacity dimension. Demand: +w at pickup, -w at delivery, 0 elsewhere.
    weights_scaled = []
    for o in req["problem"]["orders"]:
        weights_scaled.append(int(round(DIST_SCALE / o["load_factor"])))

    def demand(from_index):
        node = manager.IndexToNode(from_index)
        if V <= node < V + N:
            return weights_scaled[node - V]  # pickup
        if V + N <= node < V + 2 * N:
            return -weights_scaled[node - V - N]  # delivery
        return 0

    demand_cb = routing.RegisterUnaryTransitCallback(demand)
    routing.AddDimensionWithVehicleCapacity(
        demand_cb,
        0,
        [DIST_SCALE] * V,  # MAX_LOAD = 1.0 → DIST_SCALE units
        True,
        "Capacity",
    )

    # Pickup-delivery pairs + precedence + same-vehicle constraint
    for o in range(N):
        p_idx = manager.NodeToIndex(V + o)
        d_idx = manager.NodeToIndex(V + N + o)
        routing.AddPickupAndDelivery(p_idx, d_idx)
        routing.solver().Add(routing.VehicleVar(p_idx) == routing.VehicleVar(d_idx))
        routing.solver().Add(order_dim.CumulVar(p_idx) <= order_dim.CumulVar(d_idx))

    search = pywrapcp.DefaultRoutingSearchParameters()
    search.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    secs = max(1, int(req["timeout_ms"] // 1000))
    search.time_limit.seconds = secs

    solution = routing.SolveWithParameters(search)

    elapsed_ms = int((time.monotonic() - started) * 1000)

    if solution is None:
        # Distinguish "ran out of time with nothing" from "search proved no solution".
        rs = routing.status()
        if rs == routing_enums_pb2.ROUTING_FAIL_TIMEOUT:
            return succeed(0.0, "TIMED_OUT", elapsed_ms)
        return succeed(0.0, "FAILED", elapsed_ms)

    value = solution.ObjectiveValue() / DIST_SCALE
    return succeed(value, "FEASIBLE", elapsed_ms)
```

Note on the cost callback: OR-Tools requires `RegisterTransitCallback` to capture per-vehicle pricing. The factory closure (`make_cb(weight_v)`) is necessary so each `weight` is bound by value, not by reference, in the loop.

Note on `routing_enums_pb2.ROUTING_FAIL_TIMEOUT`: This constant may live under `routing.ROUTING_FAIL_TIMEOUT` instead, depending on the ortools version. If `routing_enums_pb2.ROUTING_FAIL_TIMEOUT` is undefined at runtime, replace with `routing.ROUTING_FAIL_TIMEOUT`. The status enum lives on the `RoutingModel` instance in recent ortools.

- [ ] **Step 4: Run the routing tests**

Run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration routing_`
Expected: PASS (both). `routing_n1_matches_bf` recovers the trivial optimum exactly; `routing_n3_within_tolerance` returns `Feasible` with a value within 5% of BF.

If `routing_n3_within_tolerance` fails on the lower-bound check (value < bf_optimum), the most likely cause is a scaling or unit mismatch in the cost callback — verify `int(round(... * weight_v * DIST_SCALE))` is applied correctly and that `start_node_set` zeroing isn't suppressing the loaded leg.

- [ ] **Step 5: Commit**

```bash
git add crates/vrppd-or-tools/python/solver.py crates/vrppd-or-tools/tests/integration.rs
git commit -m "$(cat <<'EOF'
feat(or-tools): routing solver model + N=1/N=3 tests

Routing model: per-vehicle start/end nodes, free return-to-start via
cost callback, pickup-delivery pairs with order-dim precedence and
same-vehicle constraint, scaled capacity dimension. PATH_CHEAPEST_ARC
first solution + GUIDED_LOCAL_SEARCH metaheuristic. Tests confirm
parity at N=1 and 5%-tolerance match at N=3 vs BF.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Python-missing error path test

**Files:**
- Modify: `crates/vrppd-or-tools/tests/integration.rs`

- [ ] **Step 1: Write failing test `python_missing_error`**

Append to `crates/vrppd-or-tools/tests/integration.rs`:

```rust
#[test]
fn python_missing_error() {
    if skip_unless_enabled() {
        return;
    }
    // Point at a nonexistent script. python3 will exit non-zero with a
    // FileNotFoundError on stderr; our Rust side surfaces it as SolverFailed
    // (since the spawn itself succeeded — the script just doesn't exist).
    std::env::set_var("VRPPD_ORTOOLS_PY", "/tmp/this-path-definitely-does-not-exist-12345.py");
    let p = one_vehicle_one_order();
    let err = solve_routing(&p, Objective::Distance, Duration::from_secs(5), 1).unwrap_err();
    std::env::remove_var("VRPPD_ORTOOLS_PY");

    match err {
        OrToolsError::SolverFailed(msg) => {
            assert!(
                msg.contains("parse stdout") || msg.contains("12345"),
                "unexpected msg: {msg}"
            );
        }
        other => panic!("expected SolverFailed, got {other:?}"),
    }
}
```

- [ ] **Step 2: Verify it passes**

Run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration python_missing_error`
Expected: PASS — `solve_routing` returns `SolverFailed` (spawn succeeded; the nonexistent script produced no stdout to parse).

- [ ] **Step 3: Run the full integration suite**

Run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration`
Expected: PASS for all six integration tests.

- [ ] **Step 4: Commit**

```bash
git add crates/vrppd-or-tools/tests/integration.rs
git commit -m "$(cat <<'EOF'
test(or-tools): VRPPD_ORTOOLS_PY override and missing-script error path

Verifies the env-override resolution and that a missing script yields
a typed SolverFailed (not a panic).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: napi-bridge wire types

**Files:**
- Modify: `crates/napi-bridge/Cargo.toml`
- Modify: `crates/napi-bridge/src/wire.rs`

- [ ] **Step 1: Add the dependency**

Edit `crates/napi-bridge/Cargo.toml`. In `[dependencies]`, append:

```toml
vrppd-or-tools = { workspace = true }
```

- [ ] **Step 2: Add the wire types**

Edit `crates/napi-bridge/src/wire.rs`. After the existing `MilpBothResult` declaration (around line 249), append:

```rust
/// OR-Tools run config. `timeoutMs <= 0` (or undefined) falls back to
/// `vrppd_or_tools::DEFAULT_TIMEOUT` (30 minutes).
#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct OrToolsConfig {
  pub timeout_ms: Option<f64>,
}

/// OR-Tools result. `status` is `"OPTIMAL"` (CP-SAT only — proven),
/// `"FEASIBLE"` (best-found, not proven), or `"TIMEDOUT"` (no incumbent).
#[napi(object)]
#[derive(Clone, Debug)]
pub struct OrToolsResultWire {
  pub value: f64,
  pub status: String,
  pub solve_time_ms: f64,
}
```

- [ ] **Step 3: Re-export from `napi-bridge/src/lib.rs`**

Edit `crates/napi-bridge/src/lib.rs`. In the `pub use wire::{...}` re-export list (around line 19), add `OrToolsConfig` and `OrToolsResultWire` so the line reads (split across lines as needed):

```rust
pub use wire::{
  AlgorithmSolution, CeaConfig, CeaConvergencePoint, CeaSolved, Location, LowerBoundsResult,
  MilpBothResult, MilpConfig, MilpResult, Order, OrToolsConfig, OrToolsResultWire,
  Problem, ProblemSolution, PsaConfig, PsaConvergencePoint, PsaSolved, RouteStop,
  Vehicle, VehicleRoute,
};
```

- [ ] **Step 4: Verify the bridge builds**

Run: `cargo build -p napi_bridge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/napi-bridge/Cargo.toml crates/napi-bridge/src/wire.rs crates/napi-bridge/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(napi-bridge): OrToolsConfig + OrToolsResultWire types

Wire types for the upcoming solveOrToolsRouting / solveOrToolsCpSat
napi exports. Shape mirrors MilpConfig / MilpResult so the TS adapter
pattern carries over.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: napi-bridge solve functions

**Files:**
- Modify: `crates/napi-bridge/src/lib.rs`

- [ ] **Step 1: Add the two napi functions**

Edit `crates/napi-bridge/src/lib.rs`. After the existing `solve_milp` function (the last `#[napi]` function in the file before `parse_target`, around line 244), append:

```rust
/// OR-Tools Routing Solver. `target` accepts `"DISTANCE" | "PRICE"`.
/// `EMPTY` is rejected because the OR-Tools cost model does not
/// measure the implementation's load-aware empty distance.
#[napi]
pub fn solve_or_tools_routing(
  problem: Problem,
  target: String,
  config: Option<OrToolsConfig>,
) -> Result<OrToolsResultWire> {
  let objective = parse_target(&target)?;
  let core_problem: vrppd_core::Problem = problem.into();
  let timeout = match config.as_ref().and_then(|c| c.timeout_ms) {
    Some(ms) if ms > 0.0 => std::time::Duration::from_millis(ms as u64),
    _ => vrppd_or_tools::DEFAULT_TIMEOUT,
  };
  let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);

  match vrppd_or_tools::solve_routing(&core_problem, objective, timeout, threads) {
    Ok(r) => Ok(OrToolsResultWire {
      value: r.objective_value,
      status: or_tools_status_str(r.status),
      solve_time_ms: r.solve_time_ms as f64,
    }),
    Err(e) => Err(Error::new(Status::GenericFailure, format!("OR-Tools Routing: {e}"))),
  }
}

/// OR-Tools CP-SAT. `target` accepts `"DISTANCE" | "PRICE"`. EMPTY is rejected
/// for the same reason as `solve_milp`.
#[napi]
pub fn solve_or_tools_cp_sat(
  problem: Problem,
  target: String,
  config: Option<OrToolsConfig>,
) -> Result<OrToolsResultWire> {
  let objective = parse_target(&target)?;
  let core_problem: vrppd_core::Problem = problem.into();
  let timeout = match config.as_ref().and_then(|c| c.timeout_ms) {
    Some(ms) if ms > 0.0 => std::time::Duration::from_millis(ms as u64),
    _ => vrppd_or_tools::DEFAULT_TIMEOUT,
  };
  let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);

  match vrppd_or_tools::solve_cp_sat(&core_problem, objective, timeout, threads) {
    Ok(r) => Ok(OrToolsResultWire {
      value: r.objective_value,
      status: or_tools_status_str(r.status),
      solve_time_ms: r.solve_time_ms as f64,
    }),
    Err(e) => Err(Error::new(Status::GenericFailure, format!("OR-Tools CP-SAT: {e}"))),
  }
}

fn or_tools_status_str(s: vrppd_or_tools::OrToolsStatus) -> String {
  match s {
    vrppd_or_tools::OrToolsStatus::Optimal => "OPTIMAL".to_string(),
    vrppd_or_tools::OrToolsStatus::Feasible => "FEASIBLE".to_string(),
    vrppd_or_tools::OrToolsStatus::TimedOut => "TIMEDOUT".to_string(),
  }
}
```

- [ ] **Step 2: Verify the bridge builds**

Run: `cargo build -p napi_bridge`
Expected: PASS.

- [ ] **Step 3: Rebuild the napi shared lib so TS picks up the new exports**

Run: `cd crates/napi-bridge && pnpm build && cd -`
Expected: PASS — emits `napi-bridge.darwin-arm64.node` (or platform equivalent) and regenerates `index.d.ts` with the two new function signatures.

- [ ] **Step 4: Confirm the TS types include the new functions**

Run: `grep -E 'solveOrToolsRouting|solveOrToolsCpSat' crates/napi-bridge/index.d.ts`
Expected: two matches — one for each function signature.

- [ ] **Step 5: Commit**

```bash
git add crates/napi-bridge/src/lib.rs crates/napi-bridge/index.d.ts crates/napi-bridge/index.js
git commit -m "$(cat <<'EOF'
feat(napi-bridge): solveOrToolsRouting + solveOrToolsCpSat

Thin shells around vrppd_or_tools::solve_routing / solve_cp_sat with
the same timeout handling as solveMilp. Status mapped to "OPTIMAL" |
"FEASIBLE" | "TIMEDOUT" on the wire.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: TS adapter for `or-tools-cp-sat`

**Files:**
- Create: `src/algorithms/or-tools-cp-sat/index.ts`

- [ ] **Step 1: Create the adapter**

Write `src/algorithms/or-tools-cp-sat/index.ts`:

```typescript
/**
 * @module or-tools-cp-sat
 * @description
 * TS adapter wrapping vrppd-or-tools' CP-SAT solver. Solves DISTANCE and PRICE
 * sequentially per problem; EMPTY is unsupported (mirrors vrppd-milp).
 *
 * The crate's default timeout is 30 minutes; the harness default here is
 * deliberately tight (60s) to keep R05 wall-time bounded. Callers running a
 * thesis-grade sweep can pass a longer timeout via the constructor.
 */

import { solveOrToolsCpSat } from 'napi-bridge';
import type { OrToolsResultWire, ProblemSolution } from 'napi-bridge';
import {
    AlgorithmConfig,
    AlgorithmResultWithMetadata,
    MultiTargetAlgorithm,
    OptimizationTarget,
    Problem,
} from '../../types';

const DEFAULT_TIMEOUT_MS = 60_000;

const EMPTY_SOLUTION: ProblemSolution = {
    routes: {},
    totalDistance: 0,
    totalPrice: 0,
    emptyDistance: 0,
};

export class OrToolsCpSat implements MultiTargetAlgorithm {
    readonly type = 'multi' as const;
    name = 'or-tools-cp-sat';
    readonly supportedTargets = [OptimizationTarget.DISTANCE, OptimizationTarget.PRICE] as const;

    constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

    async solve(
        problem: Problem,
        _config: AlgorithmConfig,
    ): Promise<AlgorithmResultWithMetadata<import('napi-bridge').AlgorithmSolution>> {
        const dist = solveOrToolsCpSat(problem, OptimizationTarget.DISTANCE, {
            timeoutMs: this.timeoutMs,
        });
        const price = solveOrToolsCpSat(problem, OptimizationTarget.PRICE, {
            timeoutMs: this.timeoutMs,
        });

        warnIfNotOptimal('or-tools-cp-sat', problem, 'DISTANCE', dist, this.timeoutMs);
        warnIfNotOptimal('or-tools-cp-sat', problem, 'PRICE', price, this.timeoutMs);

        return {
            solution: {
                bestDistanceSolution: { ...EMPTY_SOLUTION, totalDistance: dist.value },
                bestPriceSolution: { ...EMPTY_SOLUTION, totalPrice: price.value },
                bestEmptySolution: EMPTY_SOLUTION,
            },
            history: [],
        };
    }
}

function warnIfNotOptimal(
    name: string,
    problem: Problem,
    target: string,
    r: OrToolsResultWire,
    timeoutMs: number,
) {
    // CP-SAT: warn whenever optimality wasn't proven.
    if (r.status !== 'OPTIMAL') {
        console.warn(
            `${name}: ${r.status} on ${problem.vehicles.length}v×${problem.orders.length}o ` +
                `target=${target} after ${timeoutMs}ms — recording best incumbent`,
        );
    }
}
```

- [ ] **Step 2: Verify the TS compiles**

Run: `pnpm build`
Expected: PASS — Vite build succeeds; new file picked up automatically.

- [ ] **Step 3: Commit**

```bash
git add src/algorithms/or-tools-cp-sat/index.ts
git commit -m "$(cat <<'EOF'
feat(harness): or-tools-cp-sat MultiTargetAlgorithm adapter

Wraps solveOrToolsCpSat for DISTANCE+PRICE; declares supportedTargets
so the harness skips EMPTY at the dispatch layer. Warns on any
non-OPTIMAL status (mirrors MILP — CP-SAT's goal is provable optimum).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: TS adapter for `or-tools-routing`

**Files:**
- Create: `src/algorithms/or-tools-routing/index.ts`

- [ ] **Step 1: Create the adapter**

Write `src/algorithms/or-tools-routing/index.ts`:

```typescript
/**
 * @module or-tools-routing
 * @description
 * TS adapter wrapping vrppd-or-tools' Routing Solver. Solves DISTANCE and
 * PRICE sequentially per problem; EMPTY is unsupported. Routing returns
 * near-optimal solutions — `FEASIBLE` is its normal success state, so we
 * warn only on `TIMEDOUT` (no incumbent found in budget).
 */

import { solveOrToolsRouting } from 'napi-bridge';
import type { OrToolsResultWire, ProblemSolution } from 'napi-bridge';
import {
    AlgorithmConfig,
    AlgorithmResultWithMetadata,
    MultiTargetAlgorithm,
    OptimizationTarget,
    Problem,
} from '../../types';

const DEFAULT_TIMEOUT_MS = 60_000;

const EMPTY_SOLUTION: ProblemSolution = {
    routes: {},
    totalDistance: 0,
    totalPrice: 0,
    emptyDistance: 0,
};

export class OrToolsRouting implements MultiTargetAlgorithm {
    readonly type = 'multi' as const;
    name = 'or-tools-routing';
    readonly supportedTargets = [OptimizationTarget.DISTANCE, OptimizationTarget.PRICE] as const;

    constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

    async solve(
        problem: Problem,
        _config: AlgorithmConfig,
    ): Promise<AlgorithmResultWithMetadata<import('napi-bridge').AlgorithmSolution>> {
        const dist = solveOrToolsRouting(problem, OptimizationTarget.DISTANCE, {
            timeoutMs: this.timeoutMs,
        });
        const price = solveOrToolsRouting(problem, OptimizationTarget.PRICE, {
            timeoutMs: this.timeoutMs,
        });

        warnIfTimedOut('or-tools-routing', problem, 'DISTANCE', dist, this.timeoutMs);
        warnIfTimedOut('or-tools-routing', problem, 'PRICE', price, this.timeoutMs);

        return {
            solution: {
                bestDistanceSolution: { ...EMPTY_SOLUTION, totalDistance: dist.value },
                bestPriceSolution: { ...EMPTY_SOLUTION, totalPrice: price.value },
                bestEmptySolution: EMPTY_SOLUTION,
            },
            history: [],
        };
    }
}

function warnIfTimedOut(
    name: string,
    problem: Problem,
    target: string,
    r: OrToolsResultWire,
    timeoutMs: number,
) {
    if (r.status === 'TIMEDOUT') {
        console.warn(
            `${name}: TIMEDOUT on ${problem.vehicles.length}v×${problem.orders.length}o ` +
                `target=${target} after ${timeoutMs}ms — no incumbent found`,
        );
    }
}
```

- [ ] **Step 2: Verify the TS compiles**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/algorithms/or-tools-routing/index.ts
git commit -m "$(cat <<'EOF'
feat(harness): or-tools-routing MultiTargetAlgorithm adapter

Wraps solveOrToolsRouting for DISTANCE+PRICE. Warns only on TIMEDOUT
because Routing's normal success state is FEASIBLE (it never proves
optimality).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Register the algorithms in the harness

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports and instantiate**

Edit `src/index.ts`:

After the existing `import { MilpExact } from './algorithms/milp';` line, add:

```typescript
import { OrToolsCpSat } from './algorithms/or-tools-cp-sat';
import { OrToolsRouting } from './algorithms/or-tools-routing';
```

Inside `main()`, locate the `milpTimeoutMs` IIFE (around line 101). After it, add a parallel IIFE that reads `OR_TOOLS_TIMEOUT_MS`:

```typescript
    const orToolsTimeoutMs = (() => {
        const raw = process.env.OR_TOOLS_TIMEOUT_MS;
        if (!raw) return undefined;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : undefined;
    })();
```

Then update the `algorithms` array (around line 108) to:

```typescript
    const algorithms: Algorithm[] = [
        new BruteForceAlgorithmRust(),
        new DirectLowerBound(),
        new LpLowerBound(),
        new MilpExact(milpTimeoutMs),
        new OrToolsCpSat(orToolsTimeoutMs),
        new OrToolsRouting(orToolsTimeoutMs),
        new ParallelSimulatedAnnealingRust(),
        new CoevolutionaryAlgorithmRust(),
    ];
```

The order places the OR-Tools baselines after MILP and before the metaheuristics, matching their "exact-style baseline" role.

- [ ] **Step 2: Verify the build still passes**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Smoke-test the harness on a tiny class**

Confirm there's a small class available — `ls problems/` should show at least one of `5_5`, `5_10`, or similar. If not, the existing `1_1`/`2_2` from the sample set will do.

Run on a tiny class (assuming `5_5/` exists; adjust if not):
```bash
SKIP_ALGORITHMS=brute-force-rust,lb-lp HEURISTIC_REPETITIONS=1 OR_TOOLS_TIMEOUT_MS=10000 pnpm start 2>&1 | grep -E 'or-tools|^Processing|Saved'
```

Expected: Both `or-tools-cp-sat` and `or-tools-routing` appear in the algorithm list, both produce `benchmark-results-or-tools-*.json` files in the repo root or `results/` (wherever the harness writes them). No errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "$(cat <<'EOF'
feat(harness): register or-tools-cp-sat + or-tools-routing

Both join the algorithms array between MILP and the metaheuristics.
OR_TOOLS_TIMEOUT_MS env var mirrors MILP_TIMEOUT_MS, defaulting to the
adapter's 60s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Update `scripts/run-r05.sh`

**Files:**
- Modify: `scripts/run-r05.sh`

- [ ] **Step 1: Add OR-Tools to the per-class skip rules**

Edit `scripts/run-r05.sh`. Locate the `case "$CLASS" in` block (around line 110) that defines `SKIP_LIST`. Update it so it reads:

```bash
    case "$CLASS" in
        10_20)
            SKIP_LIST="brute-force-rust"
            ;;
        20_50|30_100)
            SKIP_LIST="brute-force-rust,lb-lp"
            ;;
        50_200)
            SKIP_LIST="brute-force-rust,lb-lp,milp-rust,or-tools-cp-sat"
            ;;
        *)
            SKIP_LIST="brute-force-rust,lb-lp,milp-rust,or-tools-cp-sat"
            ;;
    esac
```

Rationale: `or-tools-cp-sat` is expected to run into the same memory/time wall as `milp-rust` at 50×200 and above, so it's skipped from 50×200 upward. `or-tools-routing` is not in any skip list — it should be able to handle every class.

- [ ] **Step 2: Update the head-of-file comment**

The file's header comment (lines 1–26) lists the algorithms that run. Update it so it reads:

```bash
# R05 — large-instance benchmark for all classes beyond 10×10.
#
# Runs lb-direct, lb-lp, milp-rust, or-tools-cp-sat, or-tools-routing,
# p-sa-rust, and cea-rust on the five large problem classes (10×20,
# 20×50, 30×100, 50×200, 100×500). brute-force-rust is skipped
# (problems are too large) so its result file from the prior small-
# instance round is not overwritten.
```

Leave the rest of the comment block untouched.

Also update the `# lb-lp uses microlp ...` block of skip-rationale comments inside the loop to mention or-tools-cp-sat alongside milp-rust:

```bash
    # lb-lp uses microlp (simplex, pure Rust) whose practical ceiling is
    # N ≤ 20 orders. Skip it for every class beyond 10×20.
    # milp-rust and or-tools-cp-sat both OOM on a 16 GB machine at
    # 50×200 and above — defer those passes to a larger-RAM host
    # (run them against the same problem files there, then drop the
    # resulting JSON into results/R05-<class>/).
```

- [ ] **Step 3: Dry-run (do not commit benchmark output)**

Verify the script is syntactically valid:
```bash
bash -n scripts/run-r05.sh
```
Expected: no output (success).

Do **not** run the full R05 sweep here — it takes hours. The end-to-end smoke happens via Task 16's small-class test.

- [ ] **Step 4: Commit**

```bash
git add scripts/run-r05.sh
git commit -m "$(cat <<'EOF'
chore(r05): include or-tools in per-class skip rules

or-tools-routing runs on every class. or-tools-cp-sat skipped from
50×200 upward alongside milp-rust (same memory/time wall expected).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: BENCHMARKS.md OR-Tools setup section

**Files:**
- Modify: `BENCHMARKS.md`

- [ ] **Step 1: Locate the right insertion point**

Run: `grep -n '^#' BENCHMARKS.md`
Expected: a list of section headers. Identify where the "Setup" or "Prerequisites" section ends (this is the natural place for a new OR-Tools setup subsection). If `BENCHMARKS.md` has a "Larger-instance benchmarks" section, place the OR-Tools setup before that.

- [ ] **Step 2: Append the setup section**

If no obvious insertion point exists, append the section at the end of `BENCHMARKS.md`. Otherwise insert immediately before the chosen section. Content:

```markdown
## OR-Tools baseline setup

The `vrppd-or-tools` crate provides two additional baselines for the
PLAN.md §4.2 comparison matrix:

- `or-tools-cp-sat` — exact CP-SAT solver, complements `milp-rust`
  with a typically tighter formulation; aims to prove optimality up
  to N ≈ 30–50.
- `or-tools-routing` — OR-Tools Routing Solver (cheapest-insertion +
  guided local search). Returns near-optimal solutions; the
  highest-quality reference available at N ∈ {100, 200, 500}.

Both solvers shell out to a Python script that uses the
`google/or-tools` package. Install once:

```bash
pip install -r crates/vrppd-or-tools/python/requirements.txt
```

Verify the install:

```bash
python3 crates/vrppd-or-tools/python/solver.py --self-test
```

Both Rust functions (`solve_routing` / `solve_cp_sat`) return typed
errors (`OrtoolsImportFailed`, `PythonNotFound`) if the install is
missing — so a misconfigured environment fails fast at the first
solve, not silently.

Environment variables that affect the OR-Tools rows of `pnpm start`:

- `OR_TOOLS_TIMEOUT_MS` — per-instance timeout in milliseconds.
  Defaults to 60000. Set to e.g. `1800000` for a thesis-grade
  30-minute sweep.
- `VRPPD_ORTOOLS_PY` — override the script path. Defaults to
  `crates/vrppd-or-tools/python/solver.py` resolved relative to the
  crate's compile-time directory. Useful when the binary runs from a
  different working tree.

Integration tests for the crate require both Python and the
`ortools` package, and are gated behind `VRPPD_TEST_ORTOOLS=1`:

```bash
VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration
```
```

- [ ] **Step 3: Verify the markdown renders**

If `pnpm preview-docs` or similar exists in the repo, run it. Otherwise eyeball the file:

Run: `head -200 BENCHMARKS.md | tail -50`
Expected: the new section is well-formed; code fences open and close cleanly.

- [ ] **Step 4: Commit**

```bash
git add BENCHMARKS.md
git commit -m "$(cat <<'EOF'
docs(benchmarks): OR-Tools baseline setup section

Documents pip install, --self-test verification, the
OR_TOOLS_TIMEOUT_MS and VRPPD_ORTOOLS_PY env vars, and how to run the
env-gated integration tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Full smoke-run

**Files:** none (verification only)

- [ ] **Step 1: Verify the workspace builds clean**

Run: `cargo build --workspace`
Expected: PASS.

- [ ] **Step 2: Run the full Rust test suite**

Run: `cargo test --workspace`
Expected: PASS for all crates including `vrppd-or-tools` unit tests. Integration tests print "skipping" for vrppd-or-tools (default no env var) — that is the intended behaviour on CI.

- [ ] **Step 3: Run the integration suite with the env gate**

Run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools`
Expected: PASS for all 6 integration tests (`plumbing_surfaces_solver_internal_for_placeholder` may need an interpretation update — re-confirm its message check still matches after Task 6's plumbing went live; if the placeholder text was removed when CP-SAT/Routing landed, this test may be redundant — drop it in this step rather than carrying a useless assertion).

If `plumbing_surfaces_solver_internal_for_placeholder` no longer matches reality after Tasks 7/10 implemented the real solvers, delete it:

```bash
# Edit crates/vrppd-or-tools/tests/integration.rs and remove the
# plumbing_surfaces_solver_internal_for_placeholder test entirely.
```

Then re-run: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration`
Expected: PASS for the remaining 5 tests.

- [ ] **Step 4: Confirm the TS adapters end-to-end**

Pick the smallest problem class that exists in `problems/`. From the earlier exploration, `5_5/` is typical for smoke tests.

Run:
```bash
SKIP_ALGORITHMS=brute-force-rust,lb-lp,p-sa-rust,cea-rust,milp-rust HEURISTIC_REPETITIONS=1 OR_TOOLS_TIMEOUT_MS=15000 pnpm start
```

Expected: Both `or-tools-cp-sat` and `or-tools-routing` complete on all instances in the class. Result files `benchmark-results-or-tools-cp-sat.json` and `benchmark-results-or-tools-routing.json` are written. No tracebacks in the log.

If you see `ortools import failed` in the logs, run `pip install -r crates/vrppd-or-tools/python/requirements.txt` and retry.

- [ ] **Step 5: Commit any cleanup from Step 3**

If you deleted the placeholder test in Step 3:

```bash
git add crates/vrppd-or-tools/tests/integration.rs
git commit -m "$(cat <<'EOF'
test(or-tools): drop obsolete placeholder-plumbing assertion

The CP-SAT and Routing implementations replaced the
"not yet implemented" Python stub the plumbing test was probing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Otherwise nothing to commit in this task.

---

## Self-review

**Spec coverage:**
- §1 Motivation — addressed by the goal and task ordering (large-N comparison matrix gap).
- §2 Goals/non-goals — Tasks 1–18 cover every "in scope" bullet. EMPTY rejection (Task 3), warm-start deferred (no task), native bindings deferred (no task), persistent worker deferred (no task).
- §3 Crate layout — Task 1 (Cargo.toml, lib.rs, README), Task 5 (python/).
- §4 Wire protocol — Task 4 (Rust wire types), Task 5 (Python script handles the same shape).
- §4 modelling — Task 7 (CP-SAT model), Task 10 (Routing model).
- §4 status mapping — Task 6 (Rust dispatch maps the five wire statuses to OrToolsStatus + errors).
- §5 Rust API — Tasks 2, 3, 6 cumulatively.
- §6 napi + TS — Tasks 12–16.
- §7 Tests — Task 2 (Display), Task 3 (short-circuits), Tasks 6–11 (integration suite).
- §8 Build/install/docs — Task 5 (requirements.txt + --self-test), Task 18 (BENCHMARKS.md).
- §9 Risks — addressed by test design: status mapping has a default arm (Task 6), distance-scale precision verified empirically by Task 8.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" left in the plan. Every code step ships complete code. Step 3 of Task 19 conditionally deletes a test if it's no longer meaningful — that's an explicit instruction with the rationale, not a placeholder.

**Type consistency:**
- `OrToolsError` variants used consistently: `UnsupportedObjective`, `PythonNotFound`, `OrtoolsImportFailed`, `SolverFailed`, `SolverInternal`, `Infeasible`.
- `OrToolsStatus` variants: `Optimal`, `Feasible`, `TimedOut` — consistent across Rust API, status mapper, and napi shell.
- Wire status strings: `OPTIMAL | FEASIBLE | TIMEDOUT` between napi and TS (uppercase, no underscore), `OPTIMAL | FEASIBLE | TIMED_OUT | INFEASIBLE | FAILED` between Python and Rust (one underscored variant — `TIMED_OUT`). Verified Task 6's mapper handles `"TIMED_OUT"` (Python output) and Task 13's mapper emits `"TIMEDOUT"` (TS-facing). The asymmetry is intentional and load-bearing.
- napi function names: `solveOrToolsRouting`, `solveOrToolsCpSat` (camelCase per napi-derive convention).
- TS class names: `OrToolsRouting`, `OrToolsCpSat`. Algorithm names: `or-tools-routing`, `or-tools-cp-sat`.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-or-tools-baseline.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

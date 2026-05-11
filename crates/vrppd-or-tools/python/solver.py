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

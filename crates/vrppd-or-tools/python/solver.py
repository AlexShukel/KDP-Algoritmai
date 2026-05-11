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

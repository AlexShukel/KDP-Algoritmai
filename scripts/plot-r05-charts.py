#!/usr/bin/env python3
"""R05 chart generator — three modes:

  --mode raw    Average objective value vs problem size (log y).
  --mode gap    % gap above the best feasible solver result, per-problem.
                Bound algorithms (lb-direct, lb-lp) are excluded from the gap
                chart since they don't produce feasible solutions.
  --mode time   Average execution time (seconds, log y) vs problem size.
  --mode all    Run all three.

Lines break at problem sizes where an algorithm has no data (NaN gaps).

Usage:
    python3 scripts/plot-r05-charts.py [--results-dir results]
                                       [--target DISTANCE|EMPTY|PRICE]
                                       [--mode raw|gap|time|all]
                                       [--output-dir results/charts]
"""

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt

CLASS_SIZES = {
    "R05-10_20":   (10, 20),
    "R05-20_50":   (20, 50),
    "R05-30_100":  (30, 100),
    "R05-50_200":  (50, 200),
    "R05-100_500": (100, 500),
}
ALL_ORDERS = sorted({o for _, o in CLASS_SIZES.values()})  # [20, 50, 100, 200, 500]
XTICK_LABELS = ["10v×20o", "20v×50o", "30v×100o", "50v×200o", "100v×500o"]

TARGET_METRIC = {
    "DISTANCE": "totalDistance",
    "EMPTY":    "emptyDistance",
    "PRICE":    "totalPrice",
}

ALGO_DISPLAY = {
    "brute-force-rust": "Brute-Force",
    "cea-rust":         "CEA",
    "lb-direct":        "LB-direct",
    "lb-lp":            "LB-LP",
    "milp-rust":        "MILP",
    "or-tools-cp-sat":  "OR-Tools CP-SAT",
    "or-tools-routing": "OR-Tools Routing",
    "p-sa-rust":        "P-SA",
}

ALGO_STYLE = {
    "brute-force-rust": dict(color="#222222", marker="*", linestyle="--"),
    "cea-rust":         dict(color="#1f77b4", marker="o"),
    "lb-direct":        dict(color="#7f7f7f", marker="x", linestyle=":"),
    "lb-lp":            dict(color="#bcbd22", marker="x", linestyle=":"),
    "milp-rust":        dict(color="#d62728", marker="s"),
    "or-tools-cp-sat":  dict(color="#9467bd", marker="^"),
    "or-tools-routing": dict(color="#8c564b", marker="v"),
    "p-sa-rust":        dict(color="#2ca02c", marker="D"),
}

# Algorithms whose values represent feasible solutions (used in best-of for gap).
FEASIBLE_SOLVERS = {
    "brute-force-rust", "cea-rust", "milp-rust",
    "or-tools-cp-sat", "or-tools-routing", "p-sa-rust",
}

# Algorithms hidden from rendered lines. Still allowed to contribute to
# best-of-feasible calculations above. or-tools-cp-sat only produces a
# feasible solution at the smallest class (10v×20o); rendering it draws a
# single dot, which adds noise without conveying a trend.
HIDDEN_ALGOS = {"or-tools-cp-sat"}


def load_records(results_root: Path):
    """Flatten all R05 result files into a list of dicts."""
    out = []
    for class_dir_name, (vehicles, orders) in CLASS_SIZES.items():
        class_dir = results_root / class_dir_name
        if not class_dir.is_dir():
            continue
        for json_file in sorted(class_dir.glob("benchmark-results-*.json")):
            m = re.match(r"benchmark-results-(.+?)\.json", json_file.name)
            if not m:
                continue
            algo = m.group(1)
            if "." in algo:  # skip *.cold, *.warm, *.t60s, etc.
                continue
            try:
                recs = json.loads(json_file.read_text())
            except Exception as e:
                print(f"  skip {json_file}: {e}")
                continue
            for rec in recs:
                ps = rec.get("problemSize", {})
                if ps.get("vehicles") != vehicles or ps.get("orders") != orders:
                    continue
                target = rec.get("optimizationTarget")
                if target not in TARGET_METRIC:
                    continue
                obj = rec.get("metrics", {}).get(TARGET_METRIC[target], 0)
                # For "no feasible result", obj is 0; for time-only we still keep the row.
                out.append({
                    "algo": algo,
                    "vehicles": vehicles,
                    "orders": orders,
                    "target": target,
                    "problem_path": rec.get("problemPath", ""),
                    "obj": obj or 0,
                    "exec_ms": rec.get("execTime", 0) or 0,
                })
    return out


def avg(xs):
    return sum(xs) / len(xs) if xs else None


def aggregate_raw(records, target):
    """algo -> {orders: avg_obj}. Feasible solvers only; bounds excluded."""
    series = defaultdict(lambda: defaultdict(list))
    for r in records:
        if r["target"] != target or r["obj"] <= 0:
            continue
        if r["algo"] not in FEASIBLE_SOLVERS:
            continue
        series[r["algo"]][r["orders"]].append(r["obj"])
    return {a: {o: avg(v) for o, v in d.items()} for a, d in series.items()}


def aggregate_gap(records, target):
    """algo -> {orders: mean gap_pct above the best feasible solver per problem}.

    Bounds are excluded both from the "best of" computation and from the plot.
    """
    best = {}
    for r in records:
        if r["target"] != target or r["obj"] <= 0:
            continue
        if r["algo"] not in FEASIBLE_SOLVERS:
            continue
        key = r["problem_path"]
        if key not in best or r["obj"] < best[key]:
            best[key] = r["obj"]
    series = defaultdict(lambda: defaultdict(list))
    for r in records:
        if r["target"] != target or r["obj"] <= 0:
            continue
        if r["algo"] not in FEASIBLE_SOLVERS:
            continue
        b = best.get(r["problem_path"])
        if not b or b <= 0:
            continue
        series[r["algo"]][r["orders"]].append(100.0 * (r["obj"] - b) / b)
    return {a: {o: avg(v) for o, v in d.items()} for a, d in series.items()}


def aggregate_time(records, target):
    """algo -> {orders: avg exec time in seconds}, filtered to one target so we
    don't triple-count (records sharing wall time across DISTANCE/EMPTY/PRICE).
    Feasible solvers only; bounds excluded.

    Runs that produced no feasible solution (obj <= 0) are dropped — the time
    chart reports wall time per useful result and stays consistent with the
    raw/gap charts, where infeasible runs are excluded.
    """
    series = defaultdict(lambda: defaultdict(list))
    for r in records:
        if r["target"] != target or r["obj"] <= 0:
            continue
        if r["algo"] not in FEASIBLE_SOLVERS:
            continue
        series[r["algo"]][r["orders"]].append(r["exec_ms"] / 1000.0)
    return {a: {o: avg(v) for o, v in d.items()} for a, d in series.items()}


def plot_series(series, title, ylabel, output_path: Path, *, log_y: bool):
    fig, ax = plt.subplots(figsize=(10, 6))
    ordered = sorted(series.keys(), key=lambda a: ALGO_DISPLAY.get(a, a))
    for algo in ordered:
        if algo in HIDDEN_ALGOS:
            continue
        data = series[algo]
        ys = [data.get(x, float("nan")) for x in ALL_ORDERS]
        style = ALGO_STYLE.get(algo, dict(marker="o"))
        ax.plot(ALL_ORDERS, ys, label=ALGO_DISPLAY.get(algo, algo),
                linewidth=2, markersize=8, **style)
    ax.set_xscale("log")
    if log_y:
        ax.set_yscale("log")
    ax.set_xlabel("Problem size (orders, log scale)")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.set_xticks(ALL_ORDERS)
    ax.set_xticklabels(XTICK_LABELS)
    ax.minorticks_off()
    ax.legend(loc="best")
    ax.grid(which="both", linestyle="--", alpha=0.4)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)
    print(f"Saved {output_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--results-dir", default="results",
                        help="Directory with R05-<class>/ subdirs (default: results)")
    parser.add_argument("--target", default="DISTANCE",
                        choices=list(TARGET_METRIC),
                        help="Optimization target (default: DISTANCE)")
    parser.add_argument("--mode", default="all",
                        choices=["raw", "gap", "time", "all"],
                        help="Which chart(s) to produce (default: all)")
    parser.add_argument("--output-dir", default="results/charts",
                        help="Output directory (default: results/charts)")
    args = parser.parse_args()

    results_root = Path(args.results_dir)
    output_dir = Path(args.output_dir)

    records = load_records(results_root)
    if not records:
        raise SystemExit(f"No usable records found under {results_root}")
    n_with_obj = sum(1 for r in records if r["obj"] > 0)
    print(f"Loaded {len(records)} records ({n_with_obj} with positive objective) "
          f"from {results_root}")

    t = args.target.lower()
    modes = ["raw", "gap", "time"] if args.mode == "all" else [args.mode]

    for mode in modes:
        if mode == "raw":
            plot_series(
                aggregate_raw(records, args.target),
                f"Solution quality vs problem size — R05 ({args.target})",
                f"Average objective — {t} (log scale)",
                output_dir / f"r05-quality-raw-{t}.png",
                log_y=True,
            )
        elif mode == "gap":
            plot_series(
                aggregate_gap(records, args.target),
                f"Quality gap above best-found vs problem size — R05 ({args.target})",
                "Mean gap above best feasible result (%)",
                output_dir / f"r05-quality-gap-{t}.png",
                log_y=False,
            )
        elif mode == "time":
            plot_series(
                aggregate_time(records, args.target),
                f"Execution time vs problem size — R05 ({args.target})",
                "Average execution time (seconds, log scale)",
                output_dir / f"r05-exec-time-{t}.png",
                log_y=True,
            )


if __name__ == "__main__":
    main()

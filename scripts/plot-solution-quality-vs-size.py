#!/usr/bin/env python3
"""
Line chart of average objective value per algorithm across R05 problem-size
classes. Lines simply terminate where an algorithm has no data for a class.

Usage:
    python3 scripts/plot-solution-quality-vs-size.py \
        [--results-dir results] \
        [--target DISTANCE|EMPTY|PRICE] \
        [--output results/solution-quality-vs-size.png]
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

# Algorithms hidden from the chart. or-tools-cp-sat only produces feasible
# solutions at the smallest class (10v×20o) — at every larger class it OOMs
# or fails to find a feasible solution, so the data filter drops everything
# except a single dot at the smallest size. Not useful as a comparison line.
HIDDEN_ALGOS = {"or-tools-cp-sat"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results-dir", default="results",
                        help="Directory containing R05-<class>/ subdirs (default: results)")
    parser.add_argument("--target", default="DISTANCE",
                        choices=list(TARGET_METRIC),
                        help="Optimization target (default: DISTANCE)")
    parser.add_argument("--output", default="results/solution-quality-vs-size.png",
                        help="Output PNG path")
    parser.add_argument("--linear-y", action="store_true",
                        help="Use a linear y-axis instead of log")
    args = parser.parse_args()

    metric_key = TARGET_METRIC[args.target]
    results_root = Path(args.results_dir)

    series = defaultdict(dict)

    for class_dir_name, (vehicles, orders) in CLASS_SIZES.items():
        class_dir = results_root / class_dir_name
        if not class_dir.is_dir():
            continue
        for json_file in sorted(class_dir.glob("benchmark-results-*.json")):
            m = re.match(r"benchmark-results-(.+?)\.json", json_file.name)
            if not m:
                continue
            algo = m.group(1)
            # Skip variant snapshots like *.t60s, *.cold, *.warm
            if "." in algo:
                continue
            try:
                records = json.loads(json_file.read_text())
            except Exception as e:
                print(f"  skip {json_file}: {e}")
                continue
            objs = []
            for rec in records:
                ps = rec.get("problemSize", {})
                if ps.get("vehicles") != vehicles or ps.get("orders") != orders:
                    continue
                if rec.get("optimizationTarget") != args.target:
                    continue
                val = rec.get("metrics", {}).get(metric_key, 0)
                if val and val > 0:
                    objs.append(val)
            if objs:
                series[algo][orders] = sum(objs) / len(objs)

    if not series:
        raise SystemExit(f"No data found under {results_root}")

    fig, ax = plt.subplots(figsize=(10, 6))
    ordered = sorted(series.keys(), key=lambda a: ALGO_DISPLAY.get(a, a))
    all_xs = sorted({orders for _, orders in CLASS_SIZES.values()})
    for algo in ordered:
        if algo in HIDDEN_ALGOS:
            continue
        data = series[algo]
        # NaN at missing classes so matplotlib breaks the line at gaps.
        ys = [data.get(x, float("nan")) for x in all_xs]
        style = ALGO_STYLE.get(algo, dict(marker="o"))
        ax.plot(all_xs, ys, label=ALGO_DISPLAY.get(algo, algo),
                linewidth=2, markersize=8, **style)

    ax.set_xscale("log")
    if not args.linear_y:
        ax.set_yscale("log")
    ax.set_xlabel("Problem size (orders, log scale)")
    ax.set_ylabel(f"Average objective — {args.target.lower()}"
                  + ("" if args.linear_y else " (log scale)"))
    ax.set_title(f"Solution quality vs problem size — R05 sweep ({args.target})")
    xticks = [20, 50, 100, 200, 500]
    xtick_labels = ["10v×20o", "20v×50o", "30v×100o", "50v×200o", "100v×500o"]
    ax.set_xticks(xticks)
    ax.set_xticklabels(xtick_labels)
    ax.minorticks_off()
    ax.legend(loc="best")
    ax.grid(which="both", linestyle="--", alpha=0.4)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f"Saved chart to {out_path}")

    print("\nData summary:")
    for algo in ordered:
        pts = ", ".join(f"{o}o={int(v)}" for o, v in sorted(series[algo].items()))
        suffix = " [hidden]" if algo in HIDDEN_ALGOS else ""
        print(f"  {ALGO_DISPLAY.get(algo, algo):20s} {pts}{suffix}")


if __name__ == "__main__":
    main()

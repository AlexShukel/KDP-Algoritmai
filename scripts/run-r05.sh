#!/usr/bin/env bash
# R05 — large-instance benchmark for all classes beyond 10×10.
#
# Runs lb-direct, lb-lp, milp-rust, p-sa-rust, and cea-rust on the five
# large problem classes (10×20, 20×50, 30×100, 50×200, 100×500).
# brute-force-rust is skipped (problems are too large) so its result file
# from the prior small-instance round is not overwritten.
#
# Each class is benchmarked in its own pass with a size-appropriate
# HEURISTIC_REPETITIONS so wall-time stays manageable:
#
#   10×20  → 10 reps   (fast Rust solver, instances are still modest)
#   20×50  →  5 reps
#   30×100 →  3 reps
#   50×200 →  2 reps
#   100×500 → 1 rep
#
# Results for each class are saved under results/R05-<class>/ so passes
# can be analysed independently and no pass overwrites another.
#
# Usage:
#   bash scripts/run-r05.sh
#
# Prerequisite: pnpm build must succeed (the script runs it automatically
# as part of `pnpm start`).  The napi binding must already be compiled
# (cd crates/napi-bridge && pnpm i && pnpm build).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBLEMS_DIR="$REPO_ROOT/problems"
RESULTS_DIR="$REPO_ROOT/results"
STASH_DIR="$REPO_ROOT/.r05-stash"

TIMESTAMP="$(date '+%Y-%m-%d')"
LOG_FILE="$RESULTS_DIR/R05-$TIMESTAMP.log"

mkdir -p "$STASH_DIR"

# Classes to benchmark, paired with their repetition counts.
# Default full-suite config covering every R05 size class. Narrow when
# running a targeted re-pass (e.g. MILP-only after a warm-start change):
#   declare -a CLASSES=("10_20")
#   declare -a REPS=(1)
declare -a CLASSES=("10_20" "20_50" "30_100" "50_200" "100_500")
declare -a REPS=(5 3 2 1 1)

cleanup() {
    echo "[R05] Restoring all stashed problem classes..."
    for item in "$STASH_DIR"/*/; do
        [[ -d "$item" ]] && mv "$item" "$PROBLEMS_DIR/"
    done
    rmdir "$STASH_DIR" 2>/dev/null || true
    echo "[R05] Restore complete."
}
trap cleanup EXIT

stash_all_except() {
    local keep="$1"
    # Move every directory in problems/ that is NOT $keep into the stash.
    for dir in "$PROBLEMS_DIR"/*/; do
        local name
        name="$(basename "$dir")"
        if [[ "$name" != "$keep" ]]; then
            mv "$dir" "$STASH_DIR/"
        fi
    done
}

restore_all() {
    for item in "$STASH_DIR"/*/; do
        [[ -d "$item" ]] && mv "$item" "$PROBLEMS_DIR/"
    done
}

for i in "${!CLASSES[@]}"; do
    CLASS="${CLASSES[$i]}"
    REPS_COUNT="${REPS[$i]}"

    echo ""
    echo "[R05] ===== $CLASS  (HEURISTIC_REPETITIONS=$REPS_COUNT) =====" | tee -a "$LOG_FILE"

    if [[ ! -d "$PROBLEMS_DIR/$CLASS" ]]; then
        echo "[R05] WARNING: $PROBLEMS_DIR/$CLASS not found, skipping." | tee -a "$LOG_FILE"
        continue
    fi

    # Isolate this class.
    stash_all_except "$CLASS"
    echo "[R05] problems/ now contains only: $(ls "$PROBLEMS_DIR")" | tee -a "$LOG_FILE"

    # Per-class results directory.
    CLASS_RESULTS="$RESULTS_DIR/R05-$CLASS"
    mkdir -p "$CLASS_RESULTS"

    # lb-lp uses microlp (simplex, pure Rust) whose practical ceiling is
    # N ≤ 20 orders. Skip it for every class beyond 10×20.
    if [[ "$CLASS" == "10_20" ]]; then
        SKIP_LIST="brute-force-rust"
    else
        SKIP_LIST="brute-force-rust,lb-lp"
    fi

    # Run the harness.
    (
        cd "$REPO_ROOT"
        SKIP_ALGORITHMS="$SKIP_LIST" \
        HEURISTIC_REPETITIONS="$REPS_COUNT" \
        pnpm start 2>&1
    ) | tee -a "$LOG_FILE"

    echo "[R05] $CLASS pass complete, copying results..." | tee -a "$LOG_FILE"

    # Copy result JSONs to the class-specific directory.
    for f in "$RESULTS_DIR"/benchmark-results-*.json; do
        [[ -f "$f" ]] && cp "$f" "$CLASS_RESULTS/"
    done

    echo "[R05] Results saved to $CLASS_RESULTS" | tee -a "$LOG_FILE"

    # Bring other classes back before the next pass.
    restore_all
    echo "[R05] All classes restored." | tee -a "$LOG_FILE"
done

echo ""
echo "[R05] All passes complete. Per-class results under results/R05-*/" | tee -a "$LOG_FILE"
echo "[R05] Full log: $LOG_FILE" | tee -a "$LOG_FILE"

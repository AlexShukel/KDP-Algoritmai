#!/usr/bin/env bash
# MILP timeout sweep — runs MILP only on a single problem class with a
# series of timeout values to map quality vs time-budget. Each result
# JSON is saved alongside the prior cold/warm baselines under
# results/R05-<CLASS>/benchmark-results-milp-rust.t<TIMEOUT>s.json so
# the cold→warm@60s→warm@120s→warm@300s curve is reproducible from disk.
#
# Defaults: class=10_20, timeouts=60/120/300 (~2.7h wall total).
# Override:
#   CLASS=20_50 TIMEOUTS_S="60 300 900" bash scripts/sweep-milp-timeout.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBLEMS_DIR="$REPO_ROOT/problems"
RESULTS_DIR="$REPO_ROOT/results"
STASH_DIR="$REPO_ROOT/.r05-stash"

CLASS="${CLASS:-10_20}"
TIMEOUTS_S="${TIMEOUTS_S:-60 120 300}"
TIMESTAMP="$(date '+%Y-%m-%d')"
LOG_FILE="$RESULTS_DIR/milp-sweep-$CLASS-$TIMESTAMP.log"

mkdir -p "$STASH_DIR"

cleanup() {
    echo "[sweep] Restoring stashed problem classes..." | tee -a "$LOG_FILE"
    for item in "$STASH_DIR"/*/; do
        [[ -d "$item" ]] && mv "$item" "$PROBLEMS_DIR/"
    done
    rmdir "$STASH_DIR" 2>/dev/null || true
    echo "[sweep] Restore complete." | tee -a "$LOG_FILE"
}
trap cleanup EXIT

if [[ ! -d "$PROBLEMS_DIR/$CLASS" ]]; then
    echo "[sweep] FATAL: $PROBLEMS_DIR/$CLASS not found." | tee -a "$LOG_FILE"
    exit 1
fi

# Isolate the target class.
for dir in "$PROBLEMS_DIR"/*/; do
    name="$(basename "$dir")"
    if [[ "$name" != "$CLASS" ]]; then
        mv "$dir" "$STASH_DIR/"
    fi
done

CLASS_RESULTS="$RESULTS_DIR/R05-$CLASS"
mkdir -p "$CLASS_RESULTS"

echo "[sweep] class=$CLASS  timeouts(s)=$TIMEOUTS_S  output_dir=$CLASS_RESULTS" | tee -a "$LOG_FILE"
echo "[sweep] log: $LOG_FILE" | tee -a "$LOG_FILE"

for T_S in $TIMEOUTS_S; do
    T_MS=$((T_S * 1000))
    echo "" | tee -a "$LOG_FILE"
    echo "[sweep] ===== timeout=${T_S}s (MILP_TIMEOUT_MS=$T_MS) =====" | tee -a "$LOG_FILE"
    SWEEP_START=$(date +%s)

    (
        cd "$REPO_ROOT"
        SKIP_ALGORITHMS="brute-force-rust,lb-direct,lb-lp,p-sa-rust,cea-rust" \
        HEURISTIC_REPETITIONS=1 \
        MILP_TIMEOUT_MS="$T_MS" \
        pnpm start 2>&1
    ) | tee -a "$LOG_FILE"

    SWEEP_END=$(date +%s)
    ELAPSED=$((SWEEP_END - SWEEP_START))

    OUT="$CLASS_RESULTS/benchmark-results-milp-rust.t${T_S}s.json"
    cp "$RESULTS_DIR/benchmark-results-milp-rust.json" "$OUT"
    echo "[sweep] timeout=${T_S}s done in ${ELAPSED}s, saved $OUT" | tee -a "$LOG_FILE"
done

echo "" | tee -a "$LOG_FILE"
echo "[sweep] All timeouts complete for class=$CLASS." | tee -a "$LOG_FILE"
echo "[sweep] Files: $CLASS_RESULTS/benchmark-results-milp-rust.t*s.json" | tee -a "$LOG_FILE"

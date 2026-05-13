#!/usr/bin/env bash
# R05 follow-up — MILP-only with an extended timeout.
#
# Re-runs benchmark-results-milp-rust.json at 20_50 and 30_100 with
# MILP_TIMEOUT_MS=300000 (5 min/problem) to drive down the ~24–28% gap
# the 60 s sweep left behind.
#
# Output lands in results/R05-<class>/benchmark-results-milp-rust.t300s.json.
# The existing 60 s file in the same directory is preserved. The plot
# scripts ignore dotted variants by default; an explicit chart overlay
# can be added later.
#
# Usage:
#   bash scripts/run-r05-milp-long.sh
#
# To escalate a class to 600 s after inspecting the 300 s gap, re-run this
# script with TIMEOUT_S=600 in the environment and the corresponding
# CLASSES var, e.g.:
#   CLASSES_OVERRIDE="30_100" TIMEOUT_S=600 bash scripts/run-r05-milp-long.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBLEMS_DIR="$REPO_ROOT/problems"
RESULTS_DIR="$REPO_ROOT/results"
STASH_DIR="$REPO_ROOT/.milp-long-stash"

TIMEOUT_S="${TIMEOUT_S:-300}"
TIMEOUT_MS=$((TIMEOUT_S * 1000))
TIMESTAMP="$(date '+%Y-%m-%d')"
LOG_FILE="$RESULTS_DIR/R05-milp-long-${TIMEOUT_S}s-$TIMESTAMP.log"

if [[ -n "${CLASSES_OVERRIDE:-}" ]]; then
    # shellcheck disable=SC2206
    declare -a CLASSES=($CLASSES_OVERRIDE)
else
    declare -a CLASSES=("20_50" "30_100")
fi

mkdir -p "$STASH_DIR"

cleanup() {
    echo "[MILP-long] Restoring any stashed problem classes..." | tee -a "$LOG_FILE"
    for item in "$STASH_DIR"/*/; do
        [[ -d "$item" ]] && mv "$item" "$PROBLEMS_DIR/"
    done
    rmdir "$STASH_DIR" 2>/dev/null || true
    echo "[MILP-long] Restore complete." | tee -a "$LOG_FILE"
}
trap cleanup EXIT

stash_all_except() {
    local keep="$1"
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

# Skip everything except milp-rust.
SKIP_LIST="brute-force-rust,lb-direct,lb-lp,or-tools-cp-sat,or-tools-routing,p-sa-rust,cea-rust"

echo "[MILP-long] Starting MILP-only sweep at ${TIMEOUT_S}s/problem on: ${CLASSES[*]}" | tee -a "$LOG_FILE"

for CLASS in "${CLASSES[@]}"; do
    echo "" | tee -a "$LOG_FILE"
    echo "[MILP-long] ===== $CLASS  (MILP_TIMEOUT_MS=$TIMEOUT_MS) =====" | tee -a "$LOG_FILE"

    if [[ ! -d "$PROBLEMS_DIR/$CLASS" ]]; then
        echo "[MILP-long] WARNING: $PROBLEMS_DIR/$CLASS not found, skipping." | tee -a "$LOG_FILE"
        continue
    fi

    CLASS_RESULTS="$RESULTS_DIR/R05-$CLASS"
    mkdir -p "$CLASS_RESULTS"

    stash_all_except "$CLASS"
    echo "[MILP-long] problems/ now contains only: $(ls "$PROBLEMS_DIR")" | tee -a "$LOG_FILE"

    (
        cd "$REPO_ROOT"
        SKIP_ALGORITHMS="$SKIP_LIST" \
        HEURISTIC_REPETITIONS=1 \
        MILP_TIMEOUT_MS="$TIMEOUT_MS" \
        pnpm start 2>&1
    ) | tee -a "$LOG_FILE"

    SRC="$RESULTS_DIR/benchmark-results-milp-rust.json"
    DST="$CLASS_RESULTS/benchmark-results-milp-rust.t${TIMEOUT_S}s.json"
    if [[ -f "$SRC" ]]; then
        cp "$SRC" "$DST"
        echo "[MILP-long] $CLASS result saved to $DST" | tee -a "$LOG_FILE"
    else
        echo "[MILP-long] WARNING: no $SRC produced for $CLASS" | tee -a "$LOG_FILE"
    fi

    restore_all
    echo "[MILP-long] All classes restored." | tee -a "$LOG_FILE"
done

echo "" | tee -a "$LOG_FILE"
echo "[MILP-long] Complete. Variant files under results/R05-*/benchmark-results-milp-rust.t${TIMEOUT_S}s.json" | tee -a "$LOG_FILE"
echo "[MILP-long] Full log: $LOG_FILE" | tee -a "$LOG_FILE"

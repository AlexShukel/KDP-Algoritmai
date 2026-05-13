#!/usr/bin/env bash
# R05 follow-up — OR-Tools Routing with PARALLEL_CHEAPEST_INSERTION.
#
# Re-runs or-tools-routing at every R05 class with the
# PARALLEL_CHEAPEST_INSERTION first-solution heuristic instead of the
# default PATH_CHEAPEST_ARC. Output is written to a variant slot
# (`benchmark-results-or-tools-routing.parallel-cheapest-insertion.json`)
# so the existing baseline file is preserved untouched.
#
# Per-class policy: routing only. cp-sat is unaffected by
# OR_TOOLS_FIRST_SOLUTION (different solver model), so we skip it here.
#
# Output: results/R05-<class>/benchmark-results-or-tools-routing.parallel-cheapest-insertion.json.
#
# Usage:
#   bash scripts/run-r05-ortools-routing-pci.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBLEMS_DIR="$REPO_ROOT/problems"
RESULTS_DIR="$REPO_ROOT/results"
STASH_DIR="$REPO_ROOT/.ortools-pci-stash"

TIMESTAMP="$(date '+%Y-%m-%d')"
LOG_FILE="$RESULTS_DIR/R05-ortools-pci-$TIMESTAMP.log"

declare -a CLASSES=("10_20" "20_50" "30_100" "50_200" "100_500")

mkdir -p "$STASH_DIR"

cleanup() {
    echo "[ORT-PCI] Restoring any stashed problem classes..." | tee -a "$LOG_FILE"
    for item in "$STASH_DIR"/*/; do
        [[ -d "$item" ]] && mv "$item" "$PROBLEMS_DIR/"
    done
    rmdir "$STASH_DIR" 2>/dev/null || true
    echo "[ORT-PCI] Restore complete." | tee -a "$LOG_FILE"
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

# Skip every algorithm except or-tools-routing.
SKIP_LIST="brute-force-rust,lb-direct,lb-lp,milp-rust,or-tools-cp-sat,p-sa-rust,cea-rust"

echo "[ORT-PCI] Starting OR-Tools Routing with PARALLEL_CHEAPEST_INSERTION on: ${CLASSES[*]}" | tee -a "$LOG_FILE"

for CLASS in "${CLASSES[@]}"; do
    echo "" | tee -a "$LOG_FILE"
    echo "[ORT-PCI] ===== $CLASS =====" | tee -a "$LOG_FILE"

    if [[ ! -d "$PROBLEMS_DIR/$CLASS" ]]; then
        echo "[ORT-PCI] WARNING: $PROBLEMS_DIR/$CLASS not found, skipping." | tee -a "$LOG_FILE"
        continue
    fi

    CLASS_RESULTS="$RESULTS_DIR/R05-$CLASS"
    mkdir -p "$CLASS_RESULTS"

    stash_all_except "$CLASS"
    echo "[ORT-PCI] problems/ now contains only: $(ls "$PROBLEMS_DIR")" | tee -a "$LOG_FILE"

    (
        cd "$REPO_ROOT"
        SKIP_ALGORITHMS="$SKIP_LIST" \
        HEURISTIC_REPETITIONS=1 \
        OR_TOOLS_TIMEOUT_MS=60000 \
        OR_TOOLS_FIRST_SOLUTION=PARALLEL_CHEAPEST_INSERTION \
        pnpm start 2>&1
    ) | tee -a "$LOG_FILE"

    SRC="$RESULTS_DIR/benchmark-results-or-tools-routing.json"
    DST="$CLASS_RESULTS/benchmark-results-or-tools-routing.parallel-cheapest-insertion.json"
    if [[ -f "$SRC" ]]; then
        cp "$SRC" "$DST"
        echo "[ORT-PCI] $CLASS result saved to $DST" | tee -a "$LOG_FILE"
    else
        echo "[ORT-PCI] WARNING: no $SRC produced for $CLASS" | tee -a "$LOG_FILE"
    fi

    restore_all
    echo "[ORT-PCI] All classes restored." | tee -a "$LOG_FILE"
done

echo "" | tee -a "$LOG_FILE"
echo "[ORT-PCI] Complete. Variant files under results/R05-*/benchmark-results-or-tools-routing.parallel-cheapest-insertion.json" | tee -a "$LOG_FILE"
echo "[ORT-PCI] Full log: $LOG_FILE" | tee -a "$LOG_FILE"

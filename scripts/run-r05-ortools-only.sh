#!/usr/bin/env bash
# R05 sweep — OR-Tools only.
#
# Adds or-tools-cp-sat (where it can run) and or-tools-routing rows to the
# existing results/R05-<class>/ directories. Other algorithms (BF, lb-*,
# MILP, p-SA, CEA) are skipped — this script ONLY produces OR-Tools result
# files.
#
# Per-class policy:
#   10_20, 20_50, 30_100  →  both or-tools-cp-sat AND or-tools-routing
#   50_200, 100_500       →  or-tools-routing only (cp-sat skipped, same
#                            OOM concern as milp-rust)
#
# Output: per-class results/R05-<class>/benchmark-results-or-tools-*.json.
#
# Usage:
#   bash scripts/run-r05-ortools-only.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBLEMS_DIR="$REPO_ROOT/problems"
RESULTS_DIR="$REPO_ROOT/results"
STASH_DIR="$REPO_ROOT/.ortools-r05-stash"

TIMESTAMP="$(date '+%Y-%m-%d')"
LOG_FILE="$RESULTS_DIR/R05-ortools-$TIMESTAMP.log"

mkdir -p "$STASH_DIR"

# 10_20 omitted: its OR-Tools results were captured in an earlier pass.
# Re-add it here if a full re-run is desired.
declare -a CLASSES=("20_50" "30_100" "50_200" "100_500")

cleanup() {
    echo "[ORT] Restoring any stashed problem classes..." | tee -a "$LOG_FILE"
    for item in "$STASH_DIR"/*/; do
        [[ -d "$item" ]] && mv "$item" "$PROBLEMS_DIR/"
    done
    rmdir "$STASH_DIR" 2>/dev/null || true
    echo "[ORT] Restore complete." | tee -a "$LOG_FILE"
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

for CLASS in "${CLASSES[@]}"; do
    echo "" | tee -a "$LOG_FILE"
    echo "[ORT] ===== $CLASS =====" | tee -a "$LOG_FILE"

    if [[ ! -d "$PROBLEMS_DIR/$CLASS" ]]; then
        echo "[ORT] WARNING: $PROBLEMS_DIR/$CLASS not found, skipping." | tee -a "$LOG_FILE"
        continue
    fi

    case "$CLASS" in
        10_20)
            # CP-SAT produces useful FEASIBLE incumbents here within 60s.
            SKIP_LIST="brute-force-rust,lb-direct,lb-lp,milp-rust,p-sa-rust,cea-rust"
            ;;
        *)
            # 20×50+: CP-SAT TIMEDOUTs without a feasible incumbent under 60s
            # (model size blows up). Skip; rely on Routing.
            SKIP_LIST="brute-force-rust,lb-direct,lb-lp,milp-rust,p-sa-rust,cea-rust,or-tools-cp-sat"
            ;;
    esac

    CLASS_RESULTS="$RESULTS_DIR/R05-$CLASS"
    mkdir -p "$CLASS_RESULTS"

    stash_all_except "$CLASS"
    echo "[ORT] problems/ now contains only: $(ls "$PROBLEMS_DIR")" | tee -a "$LOG_FILE"

    (
        cd "$REPO_ROOT"
        SKIP_ALGORITHMS="$SKIP_LIST" \
        HEURISTIC_REPETITIONS=1 \
        OR_TOOLS_TIMEOUT_MS=60000 \
        pnpm start 2>&1
    ) | tee -a "$LOG_FILE"

    echo "[ORT] $CLASS pass complete, copying OR-Tools results..." | tee -a "$LOG_FILE"
    for f in "$RESULTS_DIR"/benchmark-results-or-tools-*.json; do
        [[ -f "$f" ]] && cp "$f" "$CLASS_RESULTS/"
    done

    restore_all
    echo "[ORT] All classes restored." | tee -a "$LOG_FILE"
done

echo "" | tee -a "$LOG_FILE"
echo "[ORT] All passes complete. OR-Tools rows added to results/R05-*/" | tee -a "$LOG_FILE"
echo "[ORT] Full log: $LOG_FILE" | tee -a "$LOG_FILE"

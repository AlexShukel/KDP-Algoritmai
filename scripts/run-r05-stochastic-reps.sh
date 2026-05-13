#!/usr/bin/env bash
# R05 stochastic-algorithm replication extension.
#
# Brings cea-rust and p-sa-rust to 10 reps on the under-replicated
# 50_200 and 100_500 R05 classes (currently 1 rep each). Resume-safe:
# subsequent invocations continue from where prior batches left off.
#
# Output: results/R05-<class>/benchmark-results-<alg>-rust.reps10.json
# plus CEA batch artifacts benchmark-results-cea-rust.reps10.batch-NN.json.
#
# Spec: docs/superpowers/specs/2026-05-13-r05-stochastic-reps-extension-design.md
#
# Usage:
#   bash scripts/run-r05-stochastic-reps.sh
#   MAX_CEA_BATCHES_PER_INVOCATION=2 bash scripts/run-r05-stochastic-reps.sh
#
# Prerequisites:
#   - jq on PATH.
#   - `pnpm build` succeeds; napi binding already compiled.
#   - `problems/{50_200,100_500}` contain only files with timestamp 1778535813465.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBLEMS_DIR="${PROBLEMS_DIR:-$REPO_ROOT/problems}"
RESULTS_DIR="${RESULTS_DIR:-$REPO_ROOT/results}"
STASH_DIR="$REPO_ROOT/.r05-stochastic-reps-stash"

EXPECTED_TS="1778535813465"
CLASSES=("50_200" "100_500")
CEA_BATCH_SIZES=(5 2)
PSA_NAME="p-sa-rust"
CEA_NAME="cea-rust"
ALL_OTHER_ALGOS="brute-force-rust,lb-direct,lb-lp,milp-rust,or-tools-cp-sat,or-tools-routing"

MAX_CEA_BATCHES_PER_INVOCATION="${MAX_CEA_BATCHES_PER_INVOCATION:-1}"

TIMESTAMP="$(date '+%Y-%m-%d')"
LOG_FILE="$RESULTS_DIR/R05-stochastic-reps-$TIMESTAMP.log"

usage() {
  cat <<USAGE
Usage: bash scripts/run-r05-stochastic-reps.sh

Environment overrides:
  MAX_CEA_BATCHES_PER_INVOCATION   default 1; raise to chain CEA batches
  PROBLEMS_DIR                     default \$REPO_ROOT/problems
  RESULTS_DIR                      default \$REPO_ROOT/results

See spec at docs/superpowers/specs/2026-05-13-r05-stochastic-reps-extension-design.md.
USAGE
}

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "[stochastic-reps] FATAL: jq is required but not on PATH." >&2
    exit 2
  }
}

# Counts the number of replications represented in a single result file.
# Assumes the schema: one record per (problemPath, optimizationTarget, runIndex)
# and a uniform rep count across (problemPath, optimizationTarget) cells.
# Echoes 0 if the file does not exist.
count_reps_in_file() {
  local file="$1"
  [[ -f "$file" ]] || { echo 0; return; }
  jq -r '
    group_by([.problemPath, .optimizationTarget])
    | map(length)
    | if length == 0 then 0
      else
        if (unique | length) == 1 then .[0]
        else error("non-uniform rep count across (problem, target) cells in \($__loc__)")
        end
      end
  ' "$file"
}

# Sums reps across a set of batch files; emits the total rep count
# represented by their union.
count_reps_in_batch_set() {
  local total=0
  local f
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    total=$(( total + $(count_reps_in_file "$f") ))
  done
  echo "$total"
}

check_problem_set_guard() {
  local class
  for class in "${CLASSES[@]}"; do
    if [[ ! -d "$PROBLEMS_DIR/$class" ]]; then
      echo "[stochastic-reps] FATAL: $PROBLEMS_DIR/$class does not exist." >&2
      echo "                 The canonical R05 problem set (timestamp $EXPECTED_TS) is required." >&2
      exit 1
    fi
    shopt -s nullglob
    local all=("$PROBLEMS_DIR/$class"/*.json)
    local matching=("$PROBLEMS_DIR/$class"/*"${EXPECTED_TS}"*.json)
    shopt -u nullglob
    if [[ ${#all[@]} -eq 0 ]]; then
      echo "[stochastic-reps] FATAL: $PROBLEMS_DIR/$class is empty." >&2
      exit 1
    fi
    if [[ ${#matching[@]} -ne ${#all[@]} ]]; then
      echo "[stochastic-reps] FATAL: $PROBLEMS_DIR/$class contains files not matching canonical R05 timestamp $EXPECTED_TS." >&2
      echo "                 Regenerating problems would break the R05 comparison (CLAUDE.md §Problem-set persistence)." >&2
      exit 1
    fi
  done
}

main() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    return 0
  fi
  require_jq
  check_problem_set_guard
  echo "[stochastic-reps] Problem-set guard passed for: ${CLASSES[*]}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi

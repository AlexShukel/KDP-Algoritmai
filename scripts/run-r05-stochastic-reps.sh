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

main() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    return 0
  fi
  require_jq
  echo "[stochastic-reps] (skeleton — no work yet)"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi

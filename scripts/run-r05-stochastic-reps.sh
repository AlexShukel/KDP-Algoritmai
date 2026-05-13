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

# Concatenates all benchmark-results-cea-rust.reps10.batch-NN.json files
# under $1 (a class results dir), renumbers runIndex globally to 0..N-1
# within each (problemPath, optimizationTarget) group, and writes
# benchmark-results-cea-rust.reps10.json. Verifies the merged total
# matches $2 (expected total reps) before writing.
merge_cea_batches() {
  local class_dir="$1"
  local expected_reps="$2"

  shopt -s nullglob
  local batches=("$class_dir"/benchmark-results-cea-rust.reps10.batch-*.json)
  shopt -u nullglob

  if [[ ${#batches[@]} -eq 0 ]]; then
    echo "[merge] no batch files under $class_dir" >&2
    return 1
  fi

  # Sort batches by filename so older batches come first.
  IFS=$'\n' batches=($(printf '%s\n' "${batches[@]}" | sort))
  unset IFS

  local total
  total=$(count_reps_in_batch_set "${batches[@]}")
  if [[ "$total" != "$expected_reps" ]]; then
    echo "[merge] expected $expected_reps reps across batches under $class_dir, got $total" >&2
    return 1
  fi

  local out="$class_dir/benchmark-results-cea-rust.reps10.json"
  local tmp="$out.tmp.$$"

  # Concatenate arrays, group by (problemPath, target), renumber runIndex
  # globally within each group based on input order.
  jq -s '
    add
    | group_by([.problemPath, .optimizationTarget])
    | map(
        to_entries
        | map(.value + {runIndex: .key})
      )
    | flatten
  ' "${batches[@]}" > "$tmp"

  local records
  records=$(jq 'length' "$tmp")
  local per_problem_targets
  per_problem_targets=$(jq -c '[group_by([.problemPath, .optimizationTarget]) | .[] | length] | unique' "$tmp")
  if [[ "$per_problem_targets" != "[$expected_reps]" ]]; then
    echo "[merge] non-uniform per-group count after merge: $per_problem_targets (expected [$expected_reps])" >&2
    rm -f "$tmp"
    return 1
  fi

  mv "$tmp" "$out"
  echo "[merge] wrote $out ($records records across $((records / expected_reps)) (problem, target) cells × $expected_reps reps)"
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

stash_all_except() {
  local keep="$1"
  mkdir -p "$STASH_DIR"
  local dir name
  for dir in "$PROBLEMS_DIR"/*/; do
    name="$(basename "$dir")"
    if [[ "$name" != "$keep" ]]; then
      mv "$dir" "$STASH_DIR/"
    fi
  done
}

restore_all_stashed() {
  if [[ ! -d "$STASH_DIR" ]]; then
    return
  fi
  shopt -s nullglob
  local item
  for item in "$STASH_DIR"/*/; do
    [[ -d "$item" ]] && mv "$item" "$PROBLEMS_DIR/"
  done
  shopt -u nullglob
  rmdir "$STASH_DIR" 2>/dev/null || true
}

cleanup_on_exit() {
  restore_all_stashed
}

run_psa_pass() {
  local class
  for class in "${CLASSES[@]}"; do
    local class_dir="$RESULTS_DIR/R05-$class"
    local target="$class_dir/benchmark-results-${PSA_NAME}.reps10.json"
    mkdir -p "$class_dir"

    local existing_reps
    existing_reps=$(count_reps_in_file "$target")
    if [[ "$existing_reps" -ge 10 ]]; then
      echo "[psa] $class: $existing_reps reps present, skipping."
      continue
    fi

    echo "[psa] $class: existing $existing_reps reps in target → running fresh 10-rep batch"
    # Clear any stale harness output so we never promote leftover data on a silent failure.
    rm -f "$RESULTS_DIR/benchmark-results-${PSA_NAME}.json"

    stash_all_except "$class"
    (
      cd "$REPO_ROOT"
      SKIP_ALGORITHMS="$ALL_OTHER_ALGOS,$CEA_NAME" \
      HEURISTIC_REPETITIONS=10 \
      pnpm start 2>&1
    ) | tee -a "$LOG_FILE"
    restore_all_stashed

    local produced="$RESULTS_DIR/benchmark-results-${PSA_NAME}.json"
    if [[ ! -f "$produced" ]]; then
      echo "[psa] FATAL: harness did not produce $produced" >&2
      exit 3
    fi
    mv "$produced" "$target"
    echo "[psa] $class: wrote $target"
  done
}

next_cea_batch_number() {
  local class_dir="$1"
  shopt -s nullglob
  local batches=("$class_dir"/benchmark-results-cea-rust.reps10.batch-*.json)
  shopt -u nullglob
  echo $(( ${#batches[@]} + 1 ))
}

run_cea_pass() {
  local cea_batches_run=0
  local i
  for i in "${!CLASSES[@]}"; do
    local class="${CLASSES[$i]}"
    local batch_size="${CEA_BATCH_SIZES[$i]}"
    local class_dir="$RESULTS_DIR/R05-$class"
    mkdir -p "$class_dir"

    local target="$class_dir/benchmark-results-${CEA_NAME}.reps10.json"

    shopt -s nullglob
    local existing_batches=("$class_dir"/benchmark-results-${CEA_NAME}.reps10.batch-*.json)
    shopt -u nullglob

    local done_reps
    done_reps=$(count_reps_in_batch_set "${existing_batches[@]}")

    if [[ -f "$target" ]] && [[ "$(count_reps_in_file "$target")" -ge 10 ]]; then
      echo "[cea] $class: merged target already at 10 reps, skipping."
      continue
    fi

    if [[ "$done_reps" -ge 10 ]]; then
      echo "[cea] $class: batches sum to $done_reps reps (≥10); attempting merge."
      merge_cea_batches "$class_dir" 10 || echo "[cea] merge failed for $class — inspect manually."
      continue
    fi

    if [[ "$cea_batches_run" -ge "$MAX_CEA_BATCHES_PER_INVOCATION" ]]; then
      echo "[cea] $class: would run a batch but MAX_CEA_BATCHES_PER_INVOCATION=$MAX_CEA_BATCHES_PER_INVOCATION already reached this invocation."
      continue
    fi

    local reps_this_batch=$(( 10 - done_reps ))
    [[ "$reps_this_batch" -gt "$batch_size" ]] && reps_this_batch="$batch_size"

    local batch_no
    batch_no=$(next_cea_batch_number "$class_dir")
    local batch_file
    batch_file=$(printf "%s/benchmark-results-%s.reps10.batch-%02d.json" "$class_dir" "$CEA_NAME" "$batch_no")

    echo "[cea] $class: done_reps=$done_reps, running batch $batch_no with $reps_this_batch reps → $batch_file"

    # Clear any stale harness output so we never promote leftover data on a silent failure.
    rm -f "$RESULTS_DIR/benchmark-results-${CEA_NAME}.json"

    stash_all_except "$class"
    (
      cd "$REPO_ROOT"
      SKIP_ALGORITHMS="$ALL_OTHER_ALGOS,$PSA_NAME" \
      HEURISTIC_REPETITIONS="$reps_this_batch" \
      pnpm start 2>&1
    ) | tee -a "$LOG_FILE"
    restore_all_stashed

    local produced="$RESULTS_DIR/benchmark-results-${CEA_NAME}.json"
    if [[ ! -f "$produced" ]]; then
      echo "[cea] FATAL: harness did not produce $produced" >&2
      exit 3
    fi
    mv "$produced" "$batch_file"
    cea_batches_run=$((cea_batches_run + 1))

    local after_reps=$(( done_reps + reps_this_batch ))
    echo "[cea] $class: batch $batch_no complete; total reps now $after_reps / 10"

    if [[ "$after_reps" -ge 10 ]]; then
      merge_cea_batches "$class_dir" 10 || echo "[cea] merge failed for $class — inspect manually."
    fi
  done
}

print_status_report() {
  echo ""
  echo "==================== status ===================="
  local i class class_dir batch_size
  local all_done=1
  for i in "${!CLASSES[@]}"; do
    class="${CLASSES[$i]}"
    batch_size="${CEA_BATCH_SIZES[$i]}"
    class_dir="$RESULTS_DIR/R05-$class"

    local psa_target="$class_dir/benchmark-results-${PSA_NAME}.reps10.json"
    local psa_reps
    psa_reps=$(count_reps_in_file "$psa_target")

    local cea_target="$class_dir/benchmark-results-${CEA_NAME}.reps10.json"
    shopt -s nullglob
    local cea_batches=("$class_dir"/benchmark-results-${CEA_NAME}.reps10.batch-*.json)
    shopt -u nullglob

    local cea_reps
    if [[ -f "$cea_target" ]]; then
      cea_reps=$(count_reps_in_file "$cea_target")
    else
      cea_reps=$(count_reps_in_batch_set "${cea_batches[@]}")
    fi

    printf "  %-8s PSA: %2d/10 reps   CEA: %2d/10 reps (batch_size=%d, batches=%d)\n" \
      "$class" "$psa_reps" "$cea_reps" "$batch_size" "${#cea_batches[@]}"

    [[ "$psa_reps" -lt 10 || "$cea_reps" -lt 10 ]] && all_done=0
  done
  echo "================================================"
  if [[ "$all_done" -eq 1 ]]; then
    echo "[stochastic-reps] All targets reached. Per CLAUDE.md, copy results to the Obsidian vault:"
    echo "  cp -r $RESULTS_DIR/R05-50_200 $HOME/Git/halo/Projects/Bachelor-VRPPD/results/"
    echo "  cp -r $RESULTS_DIR/R05-100_500 $HOME/Git/halo/Projects/Bachelor-VRPPD/results/"
  else
    echo "[stochastic-reps] Not yet at target on all (class, algo). Re-run tomorrow with:"
    echo "  bash $REPO_ROOT/scripts/run-r05-stochastic-reps.sh"
    echo "[stochastic-reps] (Or chain two CEA batches in one go:"
    echo "    MAX_CEA_BATCHES_PER_INVOCATION=2 bash $REPO_ROOT/scripts/run-r05-stochastic-reps.sh )"
  fi
}

main() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    return 0
  fi
  require_jq
  check_problem_set_guard
  mkdir -p "$RESULTS_DIR"
  : > "$LOG_FILE"
  trap cleanup_on_exit EXIT

  run_psa_pass
  run_cea_pass

  print_status_report
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi

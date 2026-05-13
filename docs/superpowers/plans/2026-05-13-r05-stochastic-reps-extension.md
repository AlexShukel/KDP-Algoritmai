# R05 stochastic-algorithm replication-extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `scripts/run-r05-stochastic-reps.sh` to bring `cea-rust` and `p-sa-rust` to 10 reps on the 50×200 and 100×500 R05 classes through nightly resumable batches, per the spec at `docs/superpowers/specs/2026-05-13-r05-stochastic-reps-extension-design.md`.

**Architecture:** Single bash script. PSA runs single-shot per class (sub-minute wall-times). CEA runs in batches sized to fit overnight (5 reps per batch at 50×200; 2 reps per batch at 100×500). Resume by inspecting existing batch files on disk. A merger function consolidates batch files into the canonical `.reps10.json` slot once 10 reps are reached, renumbering `runIndex` globally to 0..9 per (problem, target).

**Tech Stack:** bash 3.x compatible, `jq` for JSON inspection / merging, `pnpm start` for harness invocation, existing R05 stash-and-restore convention for `problems/<class>` isolation.

---

## File structure

**Create:**

- `scripts/run-r05-stochastic-reps.sh` — main entry point (≈250 lines, all logic in-script).
- `scripts/tests/test-r05-merger.sh` — unit test for the CEA-batches merger function (sourced from the main script via `source`).
- `scripts/tests/fixtures/cea-batch-mini-01.json` — synthetic 2-rep × 2-problem × 1-objective batch (4 records).
- `scripts/tests/fixtures/cea-batch-mini-02.json` — synthetic 2-rep × 2-problem × 1-objective batch (4 records).

**Modify:**

- `BENCHMARKS.md` — add a "Stochastic replication-extension" subsection pointing at the new script.

**Touch (no edits):** Read `results/R05-50_200/` and `results/R05-100_500/` directory contents at runtime to count existing batch reps.

---

## Conventions used in the script

- Constants near the top: `EXPECTED_TS=1778535813465`, `CLASSES=(50_200 100_500)`, `CEA_BATCH_SIZES=(5 2)` aligned to `CLASSES`.
- Each pure function takes its inputs as args and writes nothing to globals.
- `set -euo pipefail` for fail-fast behavior. Stash/restore via `trap cleanup EXIT`.
- The script is structured so it can be sourced without running `main`:

  ```bash
  if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
  fi
  ```

  This lets `scripts/tests/test-r05-merger.sh` source the script and call its functions directly.

- Algorithm names exactly as the harness emits them: `p-sa-rust`, `cea-rust` (verified at `src/algorithms/p-sa/index.ts:39` and `src/algorithms/cea/index.ts:25`).
- jq is a hard dependency (already used in the project's local workflow; the script `command -v jq` checks at startup).

---

## Task 1: Script skeleton + dependency checks

**Files:**

- Create: `scripts/run-r05-stochastic-reps.sh`

- [ ] **Step 1: Verify the script does not exist (smoke fail)**

  ```bash
  bash scripts/run-r05-stochastic-reps.sh --help
  ```

  Expected: `bash: scripts/run-r05-stochastic-reps.sh: No such file or directory`.

- [ ] **Step 2: Create the skeleton**

  File `scripts/run-r05-stochastic-reps.sh`:

  ```bash
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
  ```

- [ ] **Step 3: Verify the skeleton runs**

  ```bash
  chmod +x scripts/run-r05-stochastic-reps.sh
  bash scripts/run-r05-stochastic-reps.sh --help
  bash scripts/run-r05-stochastic-reps.sh
  ```

  Expected (first): usage text printed, exit 0.
  Expected (second): `[stochastic-reps] (skeleton — no work yet)`, exit 0.

- [ ] **Step 4: Commit**

  ```bash
  git add scripts/run-r05-stochastic-reps.sh
  git commit -m "feat(r05): scaffold stochastic-reps script skeleton

  Skeleton with usage, jq dependency check, and source-vs-execute guard
  so tests can source the script without triggering main.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 2: Problem-set guard

**Files:**

- Modify: `scripts/run-r05-stochastic-reps.sh`

- [ ] **Step 1: Write a failing smoke test**

  ```bash
  TMP=$(mktemp -d)
  mkdir -p "$TMP/50_200" "$TMP/100_500"
  : > "$TMP/50_200/1_99999999.json"    # wrong timestamp
  PROBLEMS_DIR="$TMP" bash scripts/run-r05-stochastic-reps.sh
  echo "exit=$?"
  rm -rf "$TMP"
  ```

  Expected: skeleton currently doesn't check problems, prints "skeleton — no work yet" with exit 0. That's the failure: a guard should have aborted with exit 1.

- [ ] **Step 2: Implement the guard**

  Insert above `main()` in the script:

  ```bash
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
  ```

  In `main()` add the call after `require_jq`:

  ```bash
    require_jq
    check_problem_set_guard
    echo "[stochastic-reps] Problem-set guard passed for: ${CLASSES[*]}"
  ```

- [ ] **Step 3: Re-run the failing smoke test**

  ```bash
  TMP=$(mktemp -d)
  mkdir -p "$TMP/50_200" "$TMP/100_500"
  : > "$TMP/50_200/1_99999999.json"
  PROBLEMS_DIR="$TMP" bash scripts/run-r05-stochastic-reps.sh
  echo "exit=$?"
  rm -rf "$TMP"
  ```

  Expected: `FATAL: ... not matching canonical R05 timestamp 1778535813465`, `exit=1`.

- [ ] **Step 4: Verify the canonical-set positive case**

  ```bash
  bash scripts/run-r05-stochastic-reps.sh
  ```

  Expected: `Problem-set guard passed for: 50_200 100_500`, exit 0.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/run-r05-stochastic-reps.sh
  git commit -m "feat(r05): add problem-set persistence guard

  Refuses to run unless every file in problems/{50_200,100_500} contains
  the canonical R05 timestamp 1778535813465. See CLAUDE.md
  \"Problem-set persistence\" — the comparison breaks if problems are
  regenerated between R05 and the replication-extension passes.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 3: Rep-counting helper

**Files:**

- Modify: `scripts/run-r05-stochastic-reps.sh`

The helper reads a result JSON file and reports the number of replications per (problem × target) tuple, assuming the schema is what the harness writes (each rep produces one record per problem per target).

- [ ] **Step 1: Write the failing test**

  Save this fixture briefly to verify behavior:

  ```bash
  TMP=$(mktemp -d)
  cat > "$TMP/fixture.json" <<'EOF'
  [
    {"problemPath":"p1","optimizationTarget":"DISTANCE","runIndex":0,"metrics":{"totalDistance":1}},
    {"problemPath":"p1","optimizationTarget":"DISTANCE","runIndex":1,"metrics":{"totalDistance":2}},
    {"problemPath":"p1","optimizationTarget":"PRICE","runIndex":0,"metrics":{"totalPrice":3}},
    {"problemPath":"p1","optimizationTarget":"PRICE","runIndex":1,"metrics":{"totalPrice":4}}
  ]
  EOF

  source scripts/run-r05-stochastic-reps.sh
  echo "reps in fixture: $(count_reps_in_file "$TMP/fixture.json")"
  rm -rf "$TMP"
  ```

  Expected: `count_reps_in_file: command not found` — function not implemented yet.

- [ ] **Step 2: Implement the helper**

  Insert above `main()`:

  ```bash
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
  ```

- [ ] **Step 3: Re-run the verification**

  ```bash
  TMP=$(mktemp -d)
  cat > "$TMP/fixture.json" <<'EOF'
  [
    {"problemPath":"p1","optimizationTarget":"DISTANCE","runIndex":0,"metrics":{"totalDistance":1}},
    {"problemPath":"p1","optimizationTarget":"DISTANCE","runIndex":1,"metrics":{"totalDistance":2}},
    {"problemPath":"p1","optimizationTarget":"PRICE","runIndex":0,"metrics":{"totalPrice":3}},
    {"problemPath":"p1","optimizationTarget":"PRICE","runIndex":1,"metrics":{"totalPrice":4}}
  ]
  EOF

  source scripts/run-r05-stochastic-reps.sh
  test "$(count_reps_in_file "$TMP/fixture.json")" -eq 2 && echo "OK: 2 reps detected"
  test "$(count_reps_in_file "$TMP/does-not-exist.json")" -eq 0 && echo "OK: missing file → 0"
  test "$(count_reps_in_batch_set "$TMP/fixture.json" "$TMP/fixture.json")" -eq 4 && echo "OK: batch sum"
  rm -rf "$TMP"
  ```

  Expected: three `OK:` lines printed.

- [ ] **Step 4: Verify against real R05 data**

  ```bash
  source scripts/run-r05-stochastic-reps.sh
  count_reps_in_file results/R05-10_20/benchmark-results-cea-rust.json   # → 5
  count_reps_in_file results/R05-20_50/benchmark-results-cea-rust.json   # → 3
  count_reps_in_file results/R05-50_200/benchmark-results-cea-rust.json  # → 1
  ```

  Expected: prints `5`, `3`, `1` respectively.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/run-r05-stochastic-reps.sh
  git commit -m "feat(r05): add rep-counting helper for batch tracking

  count_reps_in_file inspects a benchmark result file and returns the
  number of reps represented (records / (problems × targets)). Refuses
  to guess if the per-cell count is non-uniform. Used by the resume
  logic to decide how many more reps a (class, algo) needs.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 4: CEA-batches merger (with unit test)

This is the most error-prone pure-logic piece — globally renumbering `runIndex` across batch files. TDD it explicitly.

**Files:**

- Modify: `scripts/run-r05-stochastic-reps.sh`
- Create: `scripts/tests/test-r05-merger.sh`
- Create: `scripts/tests/fixtures/cea-batch-mini-01.json`
- Create: `scripts/tests/fixtures/cea-batch-mini-02.json`

- [ ] **Step 1: Create the test fixtures**

  Synthetic minimal batches: 2 reps × 2 problems × 1 target = 4 records per batch.

  `scripts/tests/fixtures/cea-batch-mini-01.json`:

  ```json
  [
    {"problemPath":"problems/x/p1.json","problemSize":{"vehicles":2,"orders":3},"optimizationTarget":"DISTANCE","runIndex":0,"execTime":100,"isBatchResult":false,"metrics":{"totalDistance":10,"totalPrice":20,"emptyDistance":1}},
    {"problemPath":"problems/x/p1.json","problemSize":{"vehicles":2,"orders":3},"optimizationTarget":"DISTANCE","runIndex":1,"execTime":110,"isBatchResult":false,"metrics":{"totalDistance":11,"totalPrice":21,"emptyDistance":2}},
    {"problemPath":"problems/x/p2.json","problemSize":{"vehicles":2,"orders":3},"optimizationTarget":"DISTANCE","runIndex":0,"execTime":120,"isBatchResult":false,"metrics":{"totalDistance":12,"totalPrice":22,"emptyDistance":3}},
    {"problemPath":"problems/x/p2.json","problemSize":{"vehicles":2,"orders":3},"optimizationTarget":"DISTANCE","runIndex":1,"execTime":130,"isBatchResult":false,"metrics":{"totalDistance":13,"totalPrice":23,"emptyDistance":4}}
  ]
  ```

  `scripts/tests/fixtures/cea-batch-mini-02.json`: same shape, different metric values, again `runIndex` 0..1 per (problem, target):

  ```json
  [
    {"problemPath":"problems/x/p1.json","problemSize":{"vehicles":2,"orders":3},"optimizationTarget":"DISTANCE","runIndex":0,"execTime":100,"isBatchResult":false,"metrics":{"totalDistance":50,"totalPrice":60,"emptyDistance":5}},
    {"problemPath":"problems/x/p1.json","problemSize":{"vehicles":2,"orders":3},"optimizationTarget":"DISTANCE","runIndex":1,"execTime":110,"isBatchResult":false,"metrics":{"totalDistance":51,"totalPrice":61,"emptyDistance":6}},
    {"problemPath":"problems/x/p2.json","problemSize":{"vehicles":2,"orders":3},"optimizationTarget":"DISTANCE","runIndex":0,"execTime":120,"isBatchResult":false,"metrics":{"totalDistance":52,"totalPrice":62,"emptyDistance":7}},
    {"problemPath":"problems/x/p2.json","problemSize":{"vehicles":2,"orders":3},"optimizationTarget":"DISTANCE","runIndex":1,"execTime":130,"isBatchResult":false,"metrics":{"totalDistance":53,"totalPrice":63,"emptyDistance":8}}
  ]
  ```

- [ ] **Step 2: Write the failing merger test**

  `scripts/tests/test-r05-merger.sh`:

  ```bash
  #!/usr/bin/env bash
  # Unit test for merge_cea_batches in scripts/run-r05-stochastic-reps.sh.

  set -euo pipefail

  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  FIXTURES="$REPO_ROOT/scripts/tests/fixtures"

  source "$REPO_ROOT/scripts/run-r05-stochastic-reps.sh"

  pass=0
  fail=0

  fail_msg() { echo "FAIL: $*"; fail=$((fail+1)); }
  pass_msg() { echo "PASS: $*"; pass=$((pass+1)); }

  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  cp "$FIXTURES/cea-batch-mini-01.json" "$TMP/benchmark-results-cea-rust.reps10.batch-01.json"
  cp "$FIXTURES/cea-batch-mini-02.json" "$TMP/benchmark-results-cea-rust.reps10.batch-02.json"

  # merge_cea_batches CLASS_DIR EXPECTED_TOTAL_REPS
  merge_cea_batches "$TMP" 4 || { fail_msg "merge_cea_batches non-zero exit"; }

  OUT="$TMP/benchmark-results-cea-rust.reps10.json"
  [[ -f "$OUT" ]] && pass_msg "merged file created" || fail_msg "no merged file"

  RECORDS=$(jq 'length' "$OUT")
  [[ "$RECORDS" == "8" ]] && pass_msg "merged length = 8" || fail_msg "merged length = $RECORDS, expected 8"

  # Each (problemPath, optimizationTarget) group has exactly 4 records, runIndex 0..3.
  PER_GROUP=$(jq '[group_by([.problemPath, .optimizationTarget]) | .[] | length] | unique' "$OUT")
  [[ "$PER_GROUP" == "[4]" ]] && pass_msg "per-group count uniform at 4" || fail_msg "per-group counts: $PER_GROUP"

  RUN_INDICES=$(jq '[group_by([.problemPath, .optimizationTarget]) | .[] | sort_by(.runIndex) | map(.runIndex)] | unique' "$OUT")
  [[ "$RUN_INDICES" == "[[0,1,2,3]]" ]] && pass_msg "runIndex globally renumbered to 0..3 per group" || fail_msg "runIndex shape: $RUN_INDICES"

  # Refuses when the batch total mismatches the expected total.
  if merge_cea_batches "$TMP" 99 2>/dev/null; then
    fail_msg "merge_cea_batches should reject mismatched expected total"
  else
    pass_msg "merge rejected mismatched expected total"
  fi

  echo "----"
  echo "Tests: $pass passed, $fail failed"
  [[ "$fail" -eq 0 ]]
  ```

  Make it executable and run it:

  ```bash
  chmod +x scripts/tests/test-r05-merger.sh
  bash scripts/tests/test-r05-merger.sh
  ```

  Expected: `merge_cea_batches: command not found` (function not yet implemented).

- [ ] **Step 3: Implement `merge_cea_batches`**

  Insert above `main()` in `scripts/run-r05-stochastic-reps.sh`:

  ```bash
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
    per_problem_targets=$(jq '[group_by([.problemPath, .optimizationTarget]) | .[] | length] | unique' "$tmp")
    if [[ "$per_problem_targets" != "[$expected_reps]" ]]; then
      echo "[merge] non-uniform per-group count after merge: $per_problem_targets (expected [$expected_reps])" >&2
      rm -f "$tmp"
      return 1
    fi

    mv "$tmp" "$out"
    echo "[merge] wrote $out ($records records across $((records / expected_reps)) (problem, target) cells × $expected_reps reps)"
  }
  ```

- [ ] **Step 4: Run the merger test, verify pass**

  ```bash
  bash scripts/tests/test-r05-merger.sh
  ```

  Expected:

  ```
  PASS: merged file created
  PASS: merged length = 8
  PASS: per-group count uniform at 4
  PASS: runIndex globally renumbered to 0..3 per group
  PASS: merge rejected mismatched expected total
  ----
  Tests: 5 passed, 0 failed
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/run-r05-stochastic-reps.sh scripts/tests/test-r05-merger.sh scripts/tests/fixtures/cea-batch-mini-01.json scripts/tests/fixtures/cea-batch-mini-02.json
  git commit -m "feat(r05): add CEA batches merger with unit tests

  merge_cea_batches concatenates batch-NN.json files, globally
  renumbers runIndex to 0..N-1 per (problem, target) group, and
  refuses to write if the rep total or per-group count is wrong.

  Test fixtures use synthetic 2-rep × 2-problem batches so the merger
  contract is verifiable without running the harness.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 5: PSA pass

**Files:**

- Modify: `scripts/run-r05-stochastic-reps.sh`

PSA is fast enough to run all 10 reps in a single harness invocation per class. The pass is: skip if target already exists with 10 reps; otherwise stash other classes, invoke harness, move output file into the class dir.

- [ ] **Step 1: Add stash/restore helpers and the PSA pass**

  Insert the helpers above `main()`:

  ```bash
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
    local item
    for item in "$STASH_DIR"/*/; do
      [[ -d "$item" ]] && mv "$item" "$PROBLEMS_DIR/"
    done
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
  ```

  Update `main()` to wire it in:

  ```bash
  main() {
    if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
      usage; return 0
    fi
    require_jq
    check_problem_set_guard
    mkdir -p "$RESULTS_DIR"
    : > "$LOG_FILE"
    trap cleanup_on_exit EXIT

    run_psa_pass

    echo "[stochastic-reps] PSA pass complete."
  }
  ```

- [ ] **Step 2: Build the harness if not already built**

  ```bash
  pnpm build
  (cd crates/napi-bridge && pnpm i && pnpm build)
  ```

  Expected: builds succeed (skip if no source changes — they're already built on this branch).

- [ ] **Step 3: Smoke test PSA × both classes**

  Wall-time budget: 50×200 ≈ 1.5 min, 100×500 ≈ 19 min. Total ≈ 20 min.

  Before running, save baseline:

  ```bash
  ls -la results/R05-50_200/benchmark-results-${PSA_NAME}*.json
  ls -la results/R05-100_500/benchmark-results-${PSA_NAME}*.json
  ```

  Run:

  ```bash
  bash scripts/run-r05-stochastic-reps.sh
  ```

  Expected outputs after completion:

  ```bash
  ls -la results/R05-50_200/benchmark-results-${PSA_NAME}.reps10.json
  ls -la results/R05-100_500/benchmark-results-${PSA_NAME}.reps10.json
  ```

  Both files should exist. Verify shape:

  ```bash
  source scripts/run-r05-stochastic-reps.sh
  count_reps_in_file results/R05-50_200/benchmark-results-${PSA_NAME}.reps10.json   # → 10
  count_reps_in_file results/R05-100_500/benchmark-results-${PSA_NAME}.reps10.json  # → 10
  jq 'length' results/R05-50_200/benchmark-results-${PSA_NAME}.reps10.json          # → 600
  jq 'length' results/R05-100_500/benchmark-results-${PSA_NAME}.reps10.json         # → 600
  ```

- [ ] **Step 4: Re-run to verify idempotence**

  ```bash
  bash scripts/run-r05-stochastic-reps.sh
  ```

  Expected output includes:

  ```
  [psa] 50_200: 10 reps present, skipping.
  [psa] 100_500: 10 reps present, skipping.
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/run-r05-stochastic-reps.sh
  git commit -m "feat(r05): add PSA single-shot 10-rep pass

  PSA wall-time at the target classes (50_200 ≈ 1.5min, 100_500 ≈ 19min)
  fits comfortably in one harness invocation, so the script runs
  HEURISTIC_REPETITIONS=10 in one shot and lands the result in
  R05-<class>/benchmark-results-p-sa-rust.reps10.json. Idempotent:
  re-running sees the target file at 10 reps and skips.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 6: CEA pass with batch numbering

**Files:**

- Modify: `scripts/run-r05-stochastic-reps.sh`

- [ ] **Step 1: Add the CEA pass**

  Insert above `main()`:

  ```bash
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
  ```

  Wire it into `main()` after `run_psa_pass`:

  ```bash
    run_psa_pass
    run_cea_pass

    echo "[stochastic-reps] PSA + CEA passes complete."
  ```

- [ ] **Step 2: Quick sanity (dry path — no harness)**

  Verify the batch-numbering function works without running the harness:

  ```bash
  TMP=$(mktemp -d)
  source scripts/run-r05-stochastic-reps.sh
  test "$(next_cea_batch_number "$TMP")" -eq 1 && echo "OK: empty dir → batch 1"
  : > "$TMP/benchmark-results-cea-rust.reps10.batch-01.json"
  test "$(next_cea_batch_number "$TMP")" -eq 2 && echo "OK: one batch → batch 2"
  : > "$TMP/benchmark-results-cea-rust.reps10.batch-02.json"
  : > "$TMP/benchmark-results-cea-rust.reps10.batch-03.json"
  test "$(next_cea_batch_number "$TMP")" -eq 4 && echo "OK: three batches → batch 4"
  rm -rf "$TMP"
  ```

  Expected: three `OK:` lines.

- [ ] **Step 3: Smoke test CEA × 50_200 batch 1**

  This actually runs the harness. ~6h wall on the largest expected machine; do this when you can afford the time, NOT inline during normal plan execution. Skip if you've already smoke-tested with PSA in Task 5 and want to defer CEA verification to the production night-1 run.

  When ready:

  ```bash
  bash scripts/run-r05-stochastic-reps.sh
  ```

  Expected (under defaults, after PSA was already done in Task 5):
  - `[psa] 50_200: 10 reps present, skipping.`
  - `[psa] 100_500: 10 reps present, skipping.`
  - `[cea] 50_200: done_reps=0, running batch 1 with 5 reps → .../benchmark-results-cea-rust.reps10.batch-01.json`
  - `[cea] 100_500: would run a batch but MAX_CEA_BATCHES_PER_INVOCATION=1 already reached this invocation.`

  After completion:

  ```bash
  source scripts/run-r05-stochastic-reps.sh
  count_reps_in_file results/R05-50_200/benchmark-results-cea-rust.reps10.batch-01.json   # → 5
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add scripts/run-r05-stochastic-reps.sh
  git commit -m "feat(r05): add resumable CEA batched pass

  Each invocation runs at most MAX_CEA_BATCHES_PER_INVOCATION CEA
  batches (default 1), prioritizing 50_200 (5 reps/batch → 2 batches
  to reach 10) over 100_500 (2 reps/batch → 5 batches to reach 10).
  Each completed batch lands in benchmark-results-cea-rust.reps10.batch-NN.json
  in the class results dir. When a class reaches 10 reps total,
  merge_cea_batches consolidates batches into the canonical .reps10.json.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 7: Status print + Obsidian-vault reminder

**Files:**

- Modify: `scripts/run-r05-stochastic-reps.sh`

- [ ] **Step 1: Add the status function**

  Insert above `main()`:

  ```bash
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
  ```

  Wire into `main()` at the very end (after `run_cea_pass`):

  ```bash
    run_cea_pass

    print_status_report
  }
  ```

- [ ] **Step 2: Smoke test the status output**

  ```bash
  bash scripts/run-r05-stochastic-reps.sh
  ```

  Expected: status block printed at end with per-class progress lines and an appropriate "next-invocation" or "all done" message.

- [ ] **Step 3: Commit**

  ```bash
  git add scripts/run-r05-stochastic-reps.sh
  git commit -m "feat(r05): add status report + Obsidian-vault copy reminder

  Each invocation ends with a per-class progress block (PSA/CEA reps,
  batch counts) and either a \"re-run tomorrow\" hint or the absolute
  cp -r command for the Obsidian vault per CLAUDE.md.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 8: Documentation update

**Files:**

- Modify: `BENCHMARKS.md`

- [ ] **Step 1: Find the right section to extend**

  ```bash
  grep -n "^## " BENCHMARKS.md
  ```

  Identify the section that talks about R05 / replication / large-instance runs. Likely "Larger-instance benchmarks" or similar.

- [ ] **Step 2: Append a subsection**

  Add a new subsection near the end of the R05-relevant section, e.g.:

  ```markdown
  #### Stochastic replication-extension (post-R05)

  R05 ran with thin replication budgets at the largest two classes (1 rep
  at 50×200 and 100×500). To support the §4.3 statistical analyses
  (Wilcoxon paired, 95 % bootstrap CIs, Cohen-d effect sizes) at those
  scales, the script `scripts/run-r05-stochastic-reps.sh` brings
  `cea-rust` and `p-sa-rust` to 10 reps in resumable nightly batches,
  writing variant files `benchmark-results-{cea,p-sa}-rust.reps10.json`
  alongside the existing R05 outputs.

  PSA finishes in a single ~20-minute invocation. CEA at 50×200 needs
  two ~6-hour batches; CEA at 100×500 needs five ~12-hour batches.
  The script enforces the canonical R05 problem timestamp
  (1778535813465) on every run so the comparison stays self-consistent.

  Spec: `docs/superpowers/specs/2026-05-13-r05-stochastic-reps-extension-design.md`
  Plan: `docs/superpowers/plans/2026-05-13-r05-stochastic-reps-extension.md`
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add BENCHMARKS.md
  git commit -m "docs(r05): document stochastic-replication extension script

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 9: Final verification

**Files:** none new.

- [ ] **Step 1: Re-run the merger unit test**

  ```bash
  bash scripts/tests/test-r05-merger.sh
  ```

  Expected: all 5 PASS lines, exit 0.

- [ ] **Step 2: Re-run the script (should be largely a no-op if everything in Task 5 / Task 6 already executed)**

  ```bash
  bash scripts/run-r05-stochastic-reps.sh
  ```

  Expected: depending on state, either continues with next CEA batch, or prints "all targets reached" with the Obsidian copy block.

- [ ] **Step 3: Hand off to user for night-1 run**

  Print this to the user:

  > Script ready. To start the production run:
  >
  > ```bash
  > bash scripts/run-r05-stochastic-reps.sh
  > ```
  >
  > Default budget per invocation: PSA × both classes (≈20 min) + one CEA batch (5 reps at 50×200, ≈6 h on night 1).
  > Re-invoke each night to advance the next CEA batch.

---

## Self-review notes (filled in at plan-writing time)

- **Spec coverage:**
  - §2 in-scope script — Tasks 1-7.
  - §2 problem-set guard — Task 2.
  - §3 file layout — Tasks 5, 6, 4 (merger).
  - §4 per-(algo, class) batch policy — Tasks 5, 6.
  - §5 script behavior pseudocode — Tasks 1-7.
  - §6 guard implementation — Task 2.
  - §7 determinism note — not enforced by the script; documented in the spec only. ✓
  - §8 verification — Tasks 4 (merger), 5 (PSA smoke), 6 (CEA smoke), 9 (final).
  - §9 implementation order — matches Tasks 1-9.
  - §10 risks — addressed by atomic mv-after-zero-exit in Tasks 5 & 6, problem-set guard in Task 2, and merge-time count verification in Task 4.

- **Placeholder scan:** no TBD/TODO/placeholder content. Every code block is complete.

- **Type / signature consistency:**
  - `count_reps_in_file(path) -> int` used uniformly (Tasks 3, 4, 5, 6, 7).
  - `count_reps_in_batch_set(paths...) -> int` defined in Task 3, used in Tasks 4, 6, 7.
  - `merge_cea_batches(class_dir, expected_reps) -> exit code` defined in Task 4, called in Task 6.
  - `next_cea_batch_number(class_dir) -> int` defined in Task 6, used in Task 6.
  - `stash_all_except(class) / restore_all_stashed()` defined in Task 5, used in Tasks 5 & 6.
  - Constants (`CLASSES`, `CEA_BATCH_SIZES`, `PSA_NAME`, `CEA_NAME`, `ALL_OTHER_ALGOS`, `EXPECTED_TS`, `MAX_CEA_BATCHES_PER_INVOCATION`) declared once at the top of Task 1 and referenced consistently.

- **Out-of-scope deferrals:**
  - The "inter-batch RNG sanity check" in spec §8 is a one-off post-condition the user can run with a single jq query after night 2 (CEA × 50_200 batches 1 and 2). Not worth automating in this plan.
  - The fallback `RUST_RNG_SEED` env in spec §10 is reserved for "if §8 check fails," which would be a follow-up implementation effort. Not started preemptively.

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
PER_GROUP=$(jq -c '[group_by([.problemPath, .optimizationTarget]) | .[] | length] | unique' "$OUT")
[[ "$PER_GROUP" == "[4]" ]] && pass_msg "per-group count uniform at 4" || fail_msg "per-group counts: $PER_GROUP"

RUN_INDICES=$(jq -c '[group_by([.problemPath, .optimizationTarget]) | .[] | sort_by(.runIndex) | map(.runIndex)] | unique' "$OUT")
[[ "$RUN_INDICES" == "[[0,1,2,3]]" ]] && pass_msg "runIndex globally renumbered to 0..3 per group" || fail_msg "runIndex shape: $RUN_INDICES"

# Refuses when the batch total mismatches the expected total.
# Reset by removing the merged file (otherwise the second call has 3 inputs).
rm -f "$OUT"
if merge_cea_batches "$TMP" 99 2>/dev/null; then
  fail_msg "merge_cea_batches should reject mismatched expected total"
else
  pass_msg "merge rejected mismatched expected total"
fi

echo "----"
echo "Tests: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]

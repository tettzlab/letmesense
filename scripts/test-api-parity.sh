#!/usr/bin/env bash
#
# API Parity Test Script
# Runs CLI and API with identical inputs and compares results.
#
# Usage: ./scripts/test-api-parity.sh [--verbose] [--keep-output] [--report <file>]
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Configuration
VERBOSE="${VERBOSE:-false}"
KEEP_OUTPUT="${KEEP_OUTPUT:-false}"
REPORT_FILE=""
TEST_LLM="${TEST_LLM:-true}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TSX="$PROJECT_DIR/node_modules/.bin/tsx"
CLI="$PROJECT_DIR/cli/letmesense.ts"
API_RUNNER="$PROJECT_DIR/scripts/api-parity-runner.ts"
DOTENV_FILE="$PROJECT_DIR/.env"
TMP_DIR=""

# Load .env if it exists
if [[ -f "$DOTENV_FILE" ]]; then
  set -a
  source "$DOTENV_FILE"
  set +a
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --verbose|-v)
      VERBOSE="true"
      shift
      ;;
    --keep-output|-k)
      KEEP_OUTPUT="true"
      shift
      ;;
    --report|-r)
      REPORT_FILE="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--verbose] [--keep-output] [--report <file>]"
      echo ""
      echo "Options:"
      echo "  --verbose, -v        Show detailed output including content previews"
      echo "  --keep-output, -k    Keep temporary output files for inspection"
      echo "  --report, -r <file>  Write detailed report to file (markdown)"
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

# Counters
TOTAL=0
PASSED=0
FAILED=0
SKIPPED=0

# Cleanup function
cleanup() {
  if [[ "$KEEP_OUTPUT" == "false" && -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

# Report writing
report() {
  if [[ -n "$REPORT_FILE" ]]; then
    echo "$1" >> "$REPORT_FILE"
  fi
}

# Setup
setup() {
  TMP_DIR=$(mktemp -d)
  echo -e "${BLUE}=== API Parity Test Suite ===${NC}"
  echo "Temp directory: $TMP_DIR"
  echo "Timestamp: $(date -Iseconds)"
  echo ""

  if [[ -n "$REPORT_FILE" ]]; then
    cat > "$REPORT_FILE" << EOF
# API Parity Test Report

**Generated:** $(date -Iseconds)
**Temp Directory:** $TMP_DIR

---

EOF
  fi
}

# Log functions
log_info() {
  if [[ "$VERBOSE" == "true" ]]; then
    echo -e "${BLUE}[INFO]${NC} $1"
  fi
}

log_pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $1"
}

log_skip() {
  echo -e "${YELLOW}[SKIP]${NC} $1"
}

# Show content preview (first and last few lines)
show_preview() {
  local file="$1"
  local label="$2"
  local lines=$(wc -l < "$file" 2>/dev/null || echo "0")
  local chars=$(wc -c < "$file" 2>/dev/null || echo "0")
  local md5=$(md5sum "$file" 2>/dev/null | cut -d' ' -f1 || echo "n/a")

  echo -e "    ${CYAN}${label}${NC}: $lines lines, $chars bytes, md5:${DIM}${md5:0:8}${NC}"

  if [[ "$VERBOSE" == "true" && -s "$file" ]]; then
    echo -e "    ${DIM}--- first 3 lines ---${NC}"
    head -3 "$file" | sed 's/^/    │ /'
    if [[ $lines -gt 6 ]]; then
      echo -e "    ${DIM}... ($((lines - 6)) lines omitted) ...${NC}"
    fi
    if [[ $lines -gt 3 ]]; then
      echo -e "    ${DIM}--- last 3 lines ---${NC}"
      tail -3 "$file" | sed 's/^/    │ /'
    fi
  fi
}

# Run a single test case
# Arguments: test_name input_file [extra_flags...]
run_test() {
  local test_name="$1"
  local input_file="$2"
  shift 2
  local extra_flags=("$@")

  TOTAL=$((TOTAL + 1))

  # Check if input file exists
  if [[ ! -f "$PROJECT_DIR/$input_file" ]]; then
    log_skip "$test_name (input file not found: $input_file)"
    report "### ⏭️ $test_name (SKIPPED)"
    report "Input file not found: \`$input_file\`"
    report ""
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi

  local safe_name="${test_name//[^a-zA-Z0-9]/_}"
  local cli_output="$TMP_DIR/cli-${safe_name}.txt"
  local api_output="$TMP_DIR/api-${safe_name}.txt"
  local diff_output="$TMP_DIR/diff-${safe_name}.txt"
  local cli_cmd="$TSX $CLI --dotenv $PROJECT_DIR/$input_file -q ${extra_flags[*]:-}"
  local api_cmd="$TSX $API_RUNNER --dotenv $PROJECT_DIR/$input_file ${extra_flags[*]:-}"

  echo -e "\n${BLUE}┌─ Test: ${NC}${test_name}"
  echo -e "${BLUE}│${NC} Input: $input_file"
  echo -e "${BLUE}│${NC} Flags: ${extra_flags[*]:-<none>}"
  echo -e "${BLUE}│${NC}"
  echo -e "${BLUE}│${NC} CLI command: ${DIM}$cli_cmd${NC}"
  echo -e "${BLUE}│${NC} API command: ${DIM}$api_cmd${NC}"

  report "### $test_name"
  report ""
  report "- **Input:** \`$input_file\`"
  report "- **Flags:** \`${extra_flags[*]:-<none>}\`"
  report ""
  report "**Commands:**"
  report "\`\`\`bash"
  report "# CLI"
  report "$cli_cmd"
  report "# API"
  report "$api_cmd"
  report "\`\`\`"
  report ""

  # Run CLI
  local cli_exit=0
  local cli_stderr="$TMP_DIR/cli-${safe_name}.stderr"
  if ! $TSX "$CLI" --dotenv "$PROJECT_DIR/$input_file" -q "${extra_flags[@]}" > "$cli_output" 2>"$cli_stderr"; then
    cli_exit=$?
  fi

  # Run API
  local api_exit=0
  local api_stderr="$TMP_DIR/api-${safe_name}.stderr"
  if ! $TSX "$API_RUNNER" --dotenv "$PROJECT_DIR/$input_file" "${extra_flags[@]}" > "$api_output" 2>"$api_stderr"; then
    api_exit=$?
  fi

  echo -e "${BLUE}│${NC}"
  show_preview "$cli_output" "CLI output"
  show_preview "$api_output" "API output"

  report "**Results:**"
  report "| Metric | CLI | API |"
  report "|--------|-----|-----|"
  report "| Exit code | $cli_exit | $api_exit |"
  report "| Lines | $(wc -l < "$cli_output") | $(wc -l < "$api_output") |"
  report "| Bytes | $(wc -c < "$cli_output") | $(wc -c < "$api_output") |"
  report "| MD5 | \`$(md5sum "$cli_output" | cut -d' ' -f1)\` | \`$(md5sum "$api_output" | cut -d' ' -f1)\` |"
  report ""

  # Compare exit codes
  if [[ $cli_exit -ne $api_exit ]]; then
    echo -e "${BLUE}└─${NC} ${RED}[FAIL]${NC} Exit codes differ: CLI=$cli_exit, API=$api_exit"
    report "**Status:** ❌ FAIL (exit codes differ)"
    report ""
    FAILED=$((FAILED + 1))
    return 1
  fi

  # Compare outputs
  if diff -q "$cli_output" "$api_output" > /dev/null 2>&1; then
    echo -e "${BLUE}└─${NC} ${GREEN}[PASS]${NC} Outputs identical"
    report "**Status:** ✅ PASS (outputs identical)"
    report ""
    PASSED=$((PASSED + 1))
    return 0
  else
    # Generate diff for inspection
    diff -u "$cli_output" "$api_output" > "$diff_output" 2>&1 || true

    # Check if difference is only whitespace
    if diff -qwB "$cli_output" "$api_output" > /dev/null 2>&1; then
      echo -e "${BLUE}└─${NC} ${GREEN}[PASS]${NC} Whitespace-only difference"
      report "**Status:** ✅ PASS (whitespace-only difference)"
      report ""
      PASSED=$((PASSED + 1))
      return 0
    fi

    echo -e "${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} ${RED}Difference detected:${NC}"
    echo -e "${BLUE}│${NC} ${DIM}--- CLI / +++ API ---${NC}"
    head -30 "$diff_output" | sed "s/^/${BLUE}│${NC}   /"
    if [[ $(wc -l < "$diff_output") -gt 30 ]]; then
      echo -e "${BLUE}│${NC}   ${DIM}... ($(( $(wc -l < "$diff_output") - 30 )) more lines)${NC}"
    fi

    echo -e "${BLUE}└─${NC} ${RED}[FAIL]${NC} Outputs differ"

    report "**Status:** ❌ FAIL (outputs differ)"
    report ""
    report "<details>"
    report "<summary>View diff</summary>"
    report ""
    report "\`\`\`diff"
    cat "$diff_output" >> "$REPORT_FILE" 2>/dev/null || true
    report "\`\`\`"
    report "</details>"
    report ""

    FAILED=$((FAILED + 1))
    return 1
  fi
}

# Run JSON output test
run_json_test() {
  local test_name="$1"
  local input_file="$2"
  shift 2
  local extra_flags=("$@")

  TOTAL=$((TOTAL + 1))

  if [[ ! -f "$PROJECT_DIR/$input_file" ]]; then
    log_skip "$test_name (input file not found: $input_file)"
    report "### ⏭️ $test_name (SKIPPED)"
    report "Input file not found: \`$input_file\`"
    report ""
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi

  local safe_name="${test_name//[^a-zA-Z0-9]/_}"
  local cli_output="$TMP_DIR/cli-json-${safe_name}.json"
  local api_output="$TMP_DIR/api-json-${safe_name}.json"

  echo -e "\n${BLUE}┌─ Test: ${NC}${test_name} ${DIM}(JSON)${NC}"
  echo -e "${BLUE}│${NC} Input: $input_file"
  echo -e "${BLUE}│${NC} Flags: --json ${extra_flags[*]:-}"

  report "### $test_name (JSON)"
  report ""
  report "- **Input:** \`$input_file\`"
  report "- **Flags:** \`--json ${extra_flags[*]:-}\`"
  report ""

  # Run CLI with JSON output
  $TSX "$CLI" --dotenv "$PROJECT_DIR/$input_file" -q --json "${extra_flags[@]}" > "$cli_output" 2>/dev/null || true

  # Run API with JSON output
  $TSX "$API_RUNNER" --dotenv "$PROJECT_DIR/$input_file" --json "${extra_flags[@]}" > "$api_output" 2>/dev/null || true

  # Compare key fields (text, format, unitCount, runCount)
  local cli_text=$(jq -r '.text' "$cli_output" 2>/dev/null || echo "")
  local api_text=$(jq -r '.text' "$api_output" 2>/dev/null || echo "")
  local cli_format=$(jq -r '.format' "$cli_output" 2>/dev/null || echo "")
  local api_format=$(jq -r '.format' "$api_output" 2>/dev/null || echo "")
  local cli_units=$(jq -r '.unitCount' "$cli_output" 2>/dev/null || echo "")
  local api_units=$(jq -r '.unitCount' "$api_output" 2>/dev/null || echo "")
  local cli_runs=$(jq -r '.runCount' "$cli_output" 2>/dev/null || echo "")
  local api_runs=$(jq -r '.runCount' "$api_output" 2>/dev/null || echo "")
  local cli_errors=$(jq -r '.errors | length' "$cli_output" 2>/dev/null || echo "0")
  local api_errors=$(jq -r '.errors | length' "$api_output" 2>/dev/null || echo "0")
  local cli_text_len=${#cli_text}
  local api_text_len=${#api_text}

  echo -e "${BLUE}│${NC}"
  echo -e "${BLUE}│${NC} ${CYAN}Field comparison:${NC}"
  echo -e "${BLUE}│${NC}   format:    CLI=${cli_format}, API=${api_format}"
  echo -e "${BLUE}│${NC}   unitCount: CLI=${cli_units}, API=${api_units}"
  echo -e "${BLUE}│${NC}   runCount:  CLI=${cli_runs}, API=${api_runs}"
  echo -e "${BLUE}│${NC}   errors:    CLI=${cli_errors}, API=${api_errors}"
  echo -e "${BLUE}│${NC}   text.len:  CLI=${cli_text_len}, API=${api_text_len}"

  report "**Field Comparison:**"
  report "| Field | CLI | API | Match |"
  report "|-------|-----|-----|-------|"
  report "| format | $cli_format | $api_format | $([ "$cli_format" = "$api_format" ] && echo "✅" || echo "❌") |"
  report "| unitCount | $cli_units | $api_units | $([ "$cli_units" = "$api_units" ] && echo "✅" || echo "❌") |"
  report "| runCount | $cli_runs | $api_runs | $([ "$cli_runs" = "$api_runs" ] && echo "✅" || echo "❌") |"
  report "| errors | $cli_errors | $api_errors | $([ "$cli_errors" = "$api_errors" ] && echo "✅" || echo "❌") |"
  report "| text.length | $cli_text_len | $api_text_len | $([ "$cli_text_len" = "$api_text_len" ] && echo "✅" || echo "❌") |"
  report ""

  local failed=false
  local fail_reasons=""

  if [[ "$cli_text" != "$api_text" ]]; then
    fail_reasons+="text mismatch, "
    failed=true
  fi

  if [[ "$cli_format" != "$api_format" ]]; then
    fail_reasons+="format mismatch, "
    failed=true
  fi

  if [[ "$cli_units" != "$api_units" ]]; then
    fail_reasons+="unitCount mismatch, "
    failed=true
  fi

  if [[ "$cli_runs" != "$api_runs" ]]; then
    fail_reasons+="runCount mismatch, "
    failed=true
  fi

  if [[ "$failed" == "true" ]]; then
    echo -e "${BLUE}└─${NC} ${RED}[FAIL]${NC} ${fail_reasons%, }"
    report "**Status:** ❌ FAIL (${fail_reasons%, })"
    report ""
    FAILED=$((FAILED + 1))
    return 1
  else
    echo -e "${BLUE}└─${NC} ${GREEN}[PASS]${NC} All fields match"
    report "**Status:** ✅ PASS (all fields match)"
    report ""
    PASSED=$((PASSED + 1))
    return 0
  fi
}

# Print summary
print_summary() {
  echo ""
  echo -e "${BLUE}╔════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║${NC}          ${CYAN}Summary${NC}                   ${BLUE}║${NC}"
  echo -e "${BLUE}╠════════════════════════════════════╣${NC}"
  printf "${BLUE}║${NC}  Total:   %-24s${BLUE}║${NC}\n" "$TOTAL"
  printf "${BLUE}║${NC}  Passed:  ${GREEN}%-24s${NC}${BLUE}║${NC}\n" "$PASSED"
  printf "${BLUE}║${NC}  Failed:  ${RED}%-24s${NC}${BLUE}║${NC}\n" "$FAILED"
  printf "${BLUE}║${NC}  Skipped: ${YELLOW}%-24s${NC}${BLUE}║${NC}\n" "$SKIPPED"
  echo -e "${BLUE}╚════════════════════════════════════╝${NC}"

  report "---"
  report ""
  report "## Summary"
  report ""
  report "| Metric | Count |"
  report "|--------|-------|"
  report "| Total | $TOTAL |"
  report "| Passed | $PASSED |"
  report "| Failed | $FAILED |"
  report "| Skipped | $SKIPPED |"
  report ""

  if [[ "$KEEP_OUTPUT" == "true" ]]; then
    echo ""
    echo -e "Output files: ${CYAN}$TMP_DIR${NC}"
    echo "  - cli-*.txt    CLI outputs"
    echo "  - api-*.txt    API outputs"
    echo "  - diff-*.txt   Differences (if any)"
  fi

  if [[ -n "$REPORT_FILE" ]]; then
    echo ""
    echo -e "Report written to: ${CYAN}$REPORT_FILE${NC}"
  fi

  if [[ $FAILED -gt 0 ]]; then
    echo ""
    echo -e "${RED}✗ Some tests failed!${NC}"
    return 1
  else
    echo ""
    echo -e "${GREEN}✓ All tests passed!${NC}"
    return 0
  fi
}

# ============================================================================
# LLM-based comparison for non-deterministic outputs
# ============================================================================

LLM_COMPARE="$PROJECT_DIR/scripts/llm-compare.ts"

# Run LLM test with semantic comparison
# Arguments: test_name input_file [extra_flags...]
run_llm_test() {
  local test_name="$1"
  local input_file="$2"
  shift 2
  local extra_flags=("$@")

  TOTAL=$((TOTAL + 1))

  if [[ ! -f "$PROJECT_DIR/$input_file" ]]; then
    log_skip "$test_name (input file not found: $input_file)"
    report "### ⏭️ $test_name (SKIPPED)"
    report "Input file not found: \`$input_file\`"
    report ""
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi

  local safe_name="${test_name//[^a-zA-Z0-9]/_}"
  local cli_output="$TMP_DIR/cli-${safe_name}.txt"
  local api_output="$TMP_DIR/api-${safe_name}.txt"
  local compare_output="$TMP_DIR/compare-${safe_name}.json"
  local cli_cmd="$TSX $CLI --dotenv $PROJECT_DIR/$input_file -q ${extra_flags[*]:-}"
  local api_cmd="$TSX $API_RUNNER --dotenv $PROJECT_DIR/$input_file ${extra_flags[*]:-}"

  echo -e "\n${BLUE}┌─ Test: ${NC}${test_name} ${CYAN}(LLM semantic comparison)${NC}"
  echo -e "${BLUE}│${NC} Input: $input_file"
  echo -e "${BLUE}│${NC} Flags: ${extra_flags[*]:-<none>}"
  echo -e "${BLUE}│${NC}"
  echo -e "${BLUE}│${NC} CLI: ${DIM}$cli_cmd${NC}"
  echo -e "${BLUE}│${NC} API: ${DIM}$api_cmd${NC}"

  report "### $test_name (LLM comparison)"
  report ""
  report "- **Input:** \`$input_file\`"
  report "- **Flags:** \`${extra_flags[*]:-<none>}\`"
  report "- **Comparison:** LLM semantic analysis"
  report ""

  # Run CLI
  local cli_exit=0
  local cli_stderr="$TMP_DIR/cli-${safe_name}.stderr"
  if ! $TSX "$CLI" --dotenv "$PROJECT_DIR/$input_file" -q "${extra_flags[@]}" > "$cli_output" 2>"$cli_stderr"; then
    cli_exit=$?
  fi

  # Run API
  local api_exit=0
  local api_stderr="$TMP_DIR/api-${safe_name}.stderr"
  if ! $TSX "$API_RUNNER" --dotenv "$PROJECT_DIR/$input_file" "${extra_flags[@]}" > "$api_output" 2>"$api_stderr"; then
    api_exit=$?
  fi

  echo -e "${BLUE}│${NC}"
  show_preview "$cli_output" "CLI output"
  show_preview "$api_output" "API output"

  # If both succeeded (exit 0), use LLM comparison
  # If both failed, check error parity
  # If one failed and one succeeded, that's a failure

  if [[ $cli_exit -eq 0 && $api_exit -eq 0 ]]; then
    # Both succeeded - use LLM to compare semantic equivalence
    echo -e "${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} ${CYAN}Running LLM semantic comparison...${NC}"

    local compare_exit=0
    if $TSX "$LLM_COMPARE" "$cli_output" "$api_output" > "$compare_output" 2>/dev/null; then
      compare_exit=0
    else
      compare_exit=$?
    fi

    if [[ $compare_exit -eq 0 ]]; then
      local reason=$(jq -r '.reason' "$compare_output" 2>/dev/null || echo "Semantically equivalent")
      local confidence=$(jq -r '.confidence' "$compare_output" 2>/dev/null || echo "?")
      echo -e "${BLUE}└─${NC} ${GREEN}[PASS]${NC} $reason (confidence: $confidence)"
      report "**Status:** ✅ PASS - $reason (confidence: $confidence)"
      report ""
      PASSED=$((PASSED + 1))
      return 0
    elif [[ $compare_exit -eq 1 ]]; then
      local reason=$(jq -r '.reason' "$compare_output" 2>/dev/null || echo "Semantically different")
      local diffs=$(jq -r '.differences | join(", ")' "$compare_output" 2>/dev/null || echo "")
      echo -e "${BLUE}│${NC} ${RED}Differences: $diffs${NC}"
      echo -e "${BLUE}└─${NC} ${RED}[FAIL]${NC} $reason"
      report "**Status:** ❌ FAIL - $reason"
      report "**Differences:** $diffs"
      report ""
      FAILED=$((FAILED + 1))
      return 1
    else
      echo -e "${BLUE}└─${NC} ${YELLOW}[WARN]${NC} LLM comparison failed, falling back to exact match"
      # Fall back to exact comparison
      if diff -qwB "$cli_output" "$api_output" > /dev/null 2>&1; then
        echo -e "         ${GREEN}[PASS]${NC} Exact match (whitespace-normalized)"
        report "**Status:** ✅ PASS (exact match, LLM comparison unavailable)"
        report ""
        PASSED=$((PASSED + 1))
        return 0
      else
        echo -e "         ${RED}[FAIL]${NC} Outputs differ"
        report "**Status:** ❌ FAIL (outputs differ, LLM comparison unavailable)"
        report ""
        FAILED=$((FAILED + 1))
        return 1
      fi
    fi

  elif [[ $cli_exit -ne 0 && $api_exit -ne 0 ]]; then
    # Both failed - check if they failed the same way
    echo -e "${BLUE}│${NC} ${YELLOW}Both tools failed (CLI=$cli_exit, API=$api_exit)${NC}"

    # Compare error messages
    if diff -qwB "$cli_output" "$api_output" > /dev/null 2>&1; then
      echo -e "${BLUE}└─${NC} ${GREEN}[PASS]${NC} Error parity (both failed identically)"
      report "**Status:** ✅ PASS - Both failed with same error"
      report ""
      PASSED=$((PASSED + 1))
      return 0
    else
      echo -e "${BLUE}└─${NC} ${GREEN}[PASS]${NC} Error parity (both failed)"
      report "**Status:** ✅ PASS - Both failed (error messages may differ)"
      report ""
      PASSED=$((PASSED + 1))
      return 0
    fi

  else
    # One succeeded, one failed
    echo -e "${BLUE}└─${NC} ${RED}[FAIL]${NC} CLI exit=$cli_exit, API exit=$api_exit"
    report "**Status:** ❌ FAIL - Exit code mismatch (CLI=$cli_exit, API=$api_exit)"
    report ""
    FAILED=$((FAILED + 1))
    return 1
  fi
}

# ============================================================================
# Test Cases
# ============================================================================

# Check if any LLM API key is available
has_llm_keys() {
  [[ -n "${OPENAI_API_KEY:-}" ]] || \
  [[ -n "${ANTHROPIC_API_KEY:-}" ]] || \
  [[ -n "${GOOGLE_API_KEY:-}" ]]
}

run_tests() {
  # Fixture paths
  local OFFICE_FIXTURES="lib/office/fixtures"
  local IMAGE_FIXTURES="cli/fixtures"

  echo -e "${BLUE}--- PDF Tests ---${NC}"

  # Basic PDF extraction (using office fixture)
  run_test "pdf-basic" "$OFFICE_FIXTURES/sample.pdf"
  run_test "pdf-with-separator" "$OFFICE_FIXTURES/sample.pdf" "--separator" "\\n---\\n"
  run_test "pdf-no-parallel" "$OFFICE_FIXTURES/sample.pdf" "--no-parallel"

  # JSON output
  run_json_test "pdf-json" "$OFFICE_FIXTURES/sample.pdf"
  run_json_test "pdf-json-no-parallel" "$OFFICE_FIXTURES/sample.pdf" "--no-parallel"

  # Scanned PDF (if available in samples/)
  run_test "pdf-scanned" "samples/scanned-image.pdf"
  run_test "pdf-scanned-ocr-eng" "samples/scanned-image.pdf" "--ocr-lang" "eng"

  echo ""
  echo -e "${BLUE}--- Office Tests ---${NC}"

  # DOCX
  run_test "docx-basic" "$OFFICE_FIXTURES/sample.docx"
  run_json_test "docx-json" "$OFFICE_FIXTURES/sample.docx"

  # PPTX
  run_test "pptx-basic" "$OFFICE_FIXTURES/sample.pptx"
  run_test "pptx-with-notes" "$OFFICE_FIXTURES/sample.pptx" "--include-notes"
  run_json_test "pptx-json" "$OFFICE_FIXTURES/sample.pptx"

  # XLSX
  run_test "xlsx-basic" "$OFFICE_FIXTURES/sample.xlsx"
  run_test "xlsx-headers" "$OFFICE_FIXTURES/sample.xlsx" "--headers"
  run_test "xlsx-max-rows" "$OFFICE_FIXTURES/sample.xlsx" "--max-rows" "10"
  run_json_test "xlsx-json" "$OFFICE_FIXTURES/sample.xlsx"

  # ODF formats
  run_test "odt-basic" "$OFFICE_FIXTURES/sample.odt"
  run_test "odp-basic" "$OFFICE_FIXTURES/sample.odp"
  run_test "ods-basic" "$OFFICE_FIXTURES/sample.ods"

  echo ""
  echo -e "${BLUE}--- Image Tests ---${NC}"

  # Images (using CLI fixtures)
  run_test "image-png" "$IMAGE_FIXTURES/gradient.png"
  run_test "image-jpg" "$IMAGE_FIXTURES/gradient.jpg"
  run_test "image-webp" "$IMAGE_FIXTURES/gradient.webp"
  run_test "image-gif" "$IMAGE_FIXTURES/solid-yellow.gif"
  run_test "image-svg" "$IMAGE_FIXTURES/test.svg"
  run_test "image-max-dim" "$IMAGE_FIXTURES/large.png" "--max-dimension" "512"
  run_json_test "image-json" "$IMAGE_FIXTURES/gradient.png"

  echo ""
  echo -e "${BLUE}--- Edge Cases ---${NC}"

  # Strict mode
  run_test "pdf-strict" "$OFFICE_FIXTURES/sample.pdf" "--strict"

  echo ""
  echo -e "${BLUE}--- Sample Files (auto-discovered) ---${NC}"

  # Auto-discover and test all sample files
  local sample_count=0
  shopt -s nullglob
  for ext in pdf pptx docx xlsx odt odp ods png jpg jpeg gif webp; do
    for file in "$PROJECT_DIR"/samples/*."$ext"; do
      if [[ -f "$file" ]]; then
        local basename=$(basename "$file")
        local name="${basename%.*}"
        local relative_path="samples/$basename"
        run_test "sample-${name}" "$relative_path"
        sample_count=$((sample_count + 1))
      fi
    done
  done
  shopt -u nullglob

  if [[ $sample_count -eq 0 ]]; then
    echo -e "${YELLOW}No sample files found in samples/*.{pdf,pptx,docx,xlsx,png,jpg,jpeg,gif,webp}${NC}"
  else
    echo -e "${CYAN}Tested $sample_count sample file(s)${NC}"
  fi

  echo ""
  echo -e "${BLUE}--- LLM Tests ---${NC}"

  if [[ "$TEST_LLM" != "true" ]]; then
    echo -e "${YELLOW}LLM tests disabled (set TEST_LLM=true to enable)${NC}"
    report "## LLM Tests"
    report ""
    report "LLM tests disabled (set TEST_LLM=true to enable)"
    report ""
  else
    if has_llm_keys; then
      echo -e "${CYAN}API keys detected, testing LLM functionality${NC}"
      echo -e "${CYAN}Using LLM-based semantic comparison for non-deterministic outputs${NC}"
      report "## LLM Tests"
      report ""
      report "API keys detected. Using LLM-based semantic comparison."
      report ""
    else
      echo -e "${YELLOW}No API keys found - testing error parity${NC}"
      report "## LLM Tests"
      report ""
      report "No API keys found - testing error parity."
      report ""
    fi

    # LLM text formatting (--llm)
    run_llm_test "llm-basic" "$OFFICE_FIXTURES/sample.pdf" "--llm" "-y"

    # Vision mode (--vision)
    run_llm_test "vision-pdf" "$OFFICE_FIXTURES/sample.pdf" "--vision" "-y"
    run_llm_test "vision-image" "$IMAGE_FIXTURES/gradient.png" "--vision" "-y"

    # LLM with specific model (if keys available, otherwise tests error parity)
    run_llm_test "llm-with-model" "$OFFICE_FIXTURES/sample.pdf" "--llm" "-m" "openai:gpt-4o-mini" "-y"
    run_llm_test "vision-with-model" "$OFFICE_FIXTURES/sample.pdf" "--vision" "-m" "openai:gpt-4o-mini" "-y"
  fi
}

# ============================================================================
# Main
# ============================================================================

main() {
  setup
  run_tests
  print_summary
}

main

#!/usr/bin/env bash
#
# Layered parallel sense() stress test.
#
# Spawns N processes, each running M concurrent sense() calls.
# Total concurrent calls = N × M (default: 4 × 4 = 16).
#
# Note: File paths must not contain spaces (round-robin distribution uses
# space-delimited strings internally).
#
# Usage:
#   ./scripts/test-parallel-sense.sh [options] <files...>
#
# Options:
#   -p, --processes N      Number of parallel processes (default: 4)
#   -c, --concurrency N    In-process concurrency per process (default: 4)
#   -r, --repeat N         Repeat each file N times per process (default: 1)
#   -t, --timeout SECS     Per-file timeout (default: 120)
#   --vision               Enable vision mode
#   --model SPEC           Model spec for vision (e.g. openai:gpt-4o)
#   --format FMT           Force format detection
#   -v, --verbose          Verbose output per file
#   -q, --quiet            Minimal output (JSON summaries only)
#   --generate N           Generate N dummy test files instead of providing files
#   -e, --env-file PATH    Load env file (default: .env if it exists)
#   --no-env               Skip auto-loading .env
#   -h, --help             Show this help
#
# Examples:
#   # Basic: 4 processes × 4 concurrent on a batch of PDFs
#   ./scripts/test-parallel-sense.sh docs/*.pdf
#
#   # Heavy: 8 processes × 8 concurrent, each file repeated 3 times
#   ./scripts/test-parallel-sense.sh -p 8 -c 8 -r 3 docs/*.pdf
#
#   # Vision mode with specific model
#   ./scripts/test-parallel-sense.sh --vision --model openai:gpt-4o slides/*.pptx
#
#   # Generate dummy test files for pure stress testing
#   ./scripts/test-parallel-sense.sh --generate 20 -p 4 -c 4

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Defaults
# ──────────────────────────────────────────────────────────────────────────────

PROCESSES=4
CONCURRENCY=4
REPEAT=1
TIMEOUT=120
VISION=""
MODEL=""
FORMAT=""
VERBOSE=""
QUIET=""
GENERATE=0
ENV_FILE=""
NO_ENV=false
FILES=()

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ──────────────────────────────────────────────────────────────────────────────
# Parse args
# ──────────────────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--processes)    PROCESSES="$2"; shift 2 ;;
    -c|--concurrency)  CONCURRENCY="$2"; shift 2 ;;
    -r|--repeat)       REPEAT="$2"; shift 2 ;;
    -t|--timeout)      TIMEOUT="$2"; shift 2 ;;
    --vision)          VISION="--vision"; shift ;;
    --model)           MODEL="$2"; shift 2 ;;
    --format)          FORMAT="$2"; shift 2 ;;
    -v|--verbose)      VERBOSE="-v"; shift ;;
    -q|--quiet)        QUIET="-q"; shift ;;
    --generate)        GENERATE="$2"; shift 2 ;;
    -e|--env-file)     ENV_FILE="$2"; shift 2 ;;
    --no-env)          NO_ENV=true; shift ;;
    -h|--help)
      head -n 35 "$0" | tail -n +2 | sed 's/^#\( \|$\)//'
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      FILES+=("$1"); shift ;;
  esac
done

# ──────────────────────────────────────────────────────────────────────────────
# Load .env
# ──────────────────────────────────────────────────────────────────────────────

if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: Env file not found: $ENV_FILE" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo "Loaded env from: $ENV_FILE" >&2
elif [[ "$NO_ENV" == false && -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
  echo "Loaded env from: $PROJECT_ROOT/.env" >&2
fi

# ──────────────────────────────────────────────────────────────────────────────
# Generate dummy test files if requested
# ──────────────────────────────────────────────────────────────────────────────

TEMP_DIR=""

generate_test_files() {
  local count="$1"
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/parallel-sense-XXXXXX")"

  echo "Generating $count test HTML files in $TEMP_DIR ..." >&2

  for i in $(seq 1 "$count"); do
    local file="$TEMP_DIR/test-$(printf '%03d' "$i").html"
    cat > "$file" <<CONTENT
<!DOCTYPE html>
<html><head><title>Test Document #$i</title></head>
<body>
<h1>Test Document #$i</h1>
<p>Generated for parallel sense() stress test.</p>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.</p>
<h2>Section 1: Data Table</h2>
<table>
<tr><th>ID</th><th>Name</th><th>Value</th></tr>
<tr><td>1</td><td>Alpha</td><td>100</td></tr>
<tr><td>2</td><td>Beta</td><td>200</td></tr>
<tr><td>3</td><td>Gamma</td><td>300</td></tr>
</table>
<h2>Section 2: Technical Notes</h2>
<p>This is test document number $i of $count.
It contains enough text to exercise the extraction pipeline
without requiring heavy resources like LibreOffice or OCR.</p>
<p>End of document #$i.</p>
</body></html>
CONTENT
    FILES+=("$file")
  done
}

cleanup_temp() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}

trap cleanup_temp EXIT

if [[ "$GENERATE" -gt 0 ]]; then
  generate_test_files "$GENERATE"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Validate inputs
# ──────────────────────────────────────────────────────────────────────────────

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "Error: No input files. Provide files as arguments or use --generate N." >&2
  echo "Run with -h for help." >&2
  exit 1
fi

# Verify all files exist
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Error: File not found: $f" >&2
    exit 1
  fi
done

TOTAL_CONCURRENT=$((PROCESSES * CONCURRENCY))

echo "═══════════════════════════════════════════════════════════════" >&2
echo "  Parallel sense() Stress Test" >&2
echo "═══════════════════════════════════════════════════════════════" >&2
echo "  Files:            ${#FILES[@]}" >&2
echo "  Repeat:           ${REPEAT}x per process" >&2
echo "  Processes (N):    ${PROCESSES}" >&2
echo "  Concurrency (M):  ${CONCURRENCY} per process" >&2
echo "  Max concurrent:   ${TOTAL_CONCURRENT} (N×M)" >&2
echo "  Per-file timeout: ${TIMEOUT}s" >&2
[[ -n "$VISION" ]] && echo "  Vision mode:      enabled" >&2
[[ -n "$MODEL" ]]  && echo "  Model:            ${MODEL}" >&2
[[ -n "$FORMAT" ]] && echo "  Format:           ${FORMAT}" >&2
echo "═══════════════════════════════════════════════════════════════" >&2
echo "" >&2

# ──────────────────────────────────────────────────────────────────────────────
# Distribute files round-robin across processes
# ──────────────────────────────────────────────────────────────────────────────

declare -a PROC_FILES
for i in $(seq 0 $((PROCESSES - 1))); do
  PROC_FILES[$i]=""
done

idx=0
for f in "${FILES[@]}"; do
  proc_idx=$((idx % PROCESSES))
  if [[ -n "${PROC_FILES[$proc_idx]}" ]]; then
    PROC_FILES[$proc_idx]="${PROC_FILES[$proc_idx]} $f"
  else
    PROC_FILES[$proc_idx]="$f"
  fi
  idx=$((idx + 1))
done

# ──────────────────────────────────────────────────────────────────────────────
# Launch processes
# ──────────────────────────────────────────────────────────────────────────────

RESULTS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/parallel-sense-results-XXXXXX")"

WALL_START=$(date +%s%N)
PIDS=()

for i in $(seq 0 $((PROCESSES - 1))); do
  files_for_proc="${PROC_FILES[$i]}"

  # Skip empty process slots (more processes than files)
  if [[ -z "$files_for_proc" ]]; then
    continue
  fi

  # Build command
  CMD=(npx tsx "$SCRIPT_DIR/parallel-sense.ts"
    -c "$CONCURRENCY"
    -r "$REPEAT"
    -t "$TIMEOUT"
  )
  [[ -n "$VISION" ]]  && CMD+=("$VISION")
  [[ -n "$MODEL" ]]   && CMD+=(--model "$MODEL")
  [[ -n "$FORMAT" ]]  && CMD+=(--format "$FORMAT")
  [[ -n "$VERBOSE" ]] && CMD+=("$VERBOSE")
  [[ -n "$QUIET" ]]   && CMD+=("$QUIET")

  # shellcheck disable=SC2086
  CMD+=($files_for_proc)

  # Launch in background, capture stdout to result file
  if [[ -n "$QUIET" ]]; then
    "${CMD[@]}" > "$RESULTS_DIR/proc-$i.json" 2>/dev/null &
  else
    "${CMD[@]}" > "$RESULTS_DIR/proc-$i.json" &
  fi
  PIDS+=($!)

  if [[ -z "$QUIET" ]]; then
    echo "Launched process $((i+1))/$PROCESSES (PID ${PIDS[-1]}): $(echo "$files_for_proc" | wc -w | tr -d ' ') files" >&2
  fi
done

echo "" >&2

# ──────────────────────────────────────────────────────────────────────────────
# Wait for all processes
# ──────────────────────────────────────────────────────────────────────────────

EXIT_CODES=()
for pid in "${PIDS[@]}"; do
  set +e
  wait "$pid"
  EXIT_CODES+=($?)
  set -e
done

WALL_END=$(date +%s%N)
WALL_MS=$(( (WALL_END - WALL_START) / 1000000 ))

# ──────────────────────────────────────────────────────────────────────────────
# Aggregate results
# ──────────────────────────────────────────────────────────────────────────────

TOTAL_SUCCEEDED=0
TOTAL_FAILED=0
TOTAL_CHARS=0
TOTAL_UNITS=0
PROCESS_SUMMARIES="["

first=true
for i in $(seq 0 $((${#PIDS[@]} - 1))); do
  result_file="$RESULTS_DIR/proc-$i.json"
  if [[ -f "$result_file" ]]; then
    data=$(cat "$result_file")
    if parsed=$(echo "$data" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log([j.succeeded??0,j.failed??0,j.totalChars??0,j.totalUnits??0].join(' '))}catch{process.exit(1)}})" 2>/dev/null); then
      read -r succeeded failed chars units <<< "$parsed"

      TOTAL_SUCCEEDED=$((TOTAL_SUCCEEDED + succeeded))
      TOTAL_FAILED=$((TOTAL_FAILED + failed))
      TOTAL_CHARS=$((TOTAL_CHARS + chars))
      TOTAL_UNITS=$((TOTAL_UNITS + units))

      if $first; then first=false; else PROCESS_SUMMARIES+=","; fi
      PROCESS_SUMMARIES+="$data"
    else
      TOTAL_FAILED=$((TOTAL_FAILED + 1))
      if $first; then first=false; else PROCESS_SUMMARIES+=","; fi
      PROCESS_SUMMARIES+="{\"error\":\"Invalid JSON from process $i\",\"exitCode\":${EXIT_CODES[$i]}}"
    fi
  fi
done
PROCESS_SUMMARIES+="]"

# Cleanup result files
rm -rf "$RESULTS_DIR"

# ──────────────────────────────────────────────────────────────────────────────
# Report
# ──────────────────────────────────────────────────────────────────────────────

TOTAL=$((TOTAL_SUCCEEDED + TOTAL_FAILED))
THROUGHPUT="0"
if [[ "$WALL_MS" -gt 0 ]]; then
  THROUGHPUT=$(node -e "console.log(Math.round($TOTAL / ($WALL_MS / 1000) * 100) / 100)")
fi

echo "" >&2
echo "═══════════════════════════════════════════════════════════════" >&2
echo "  Results" >&2
echo "═══════════════════════════════════════════════════════════════" >&2
echo "  Total tasks:      $TOTAL" >&2
echo "  Succeeded:        $TOTAL_SUCCEEDED" >&2
echo "  Failed:           $TOTAL_FAILED" >&2
echo "  Total chars:      $TOTAL_CHARS" >&2
echo "  Total units:      $TOTAL_UNITS" >&2
echo "  Wall time:        ${WALL_MS}ms" >&2
echo "  Throughput:       ${THROUGHPUT} files/sec" >&2
echo "═══════════════════════════════════════════════════════════════" >&2

# Machine-readable aggregate to stdout
echo "{\"totalTasks\":$TOTAL,\"succeeded\":$TOTAL_SUCCEEDED,\"failed\":$TOTAL_FAILED,\"totalChars\":$TOTAL_CHARS,\"totalUnits\":$TOTAL_UNITS,\"wallTimeMs\":$WALL_MS,\"throughput\":$THROUGHPUT,\"processes\":${#PIDS[@]},\"concurrency\":$CONCURRENCY,\"processSummaries\":$PROCESS_SUMMARIES}"

# Exit with failure if any task failed
if [[ "$TOTAL_FAILED" -gt 0 ]]; then
  exit 1
fi

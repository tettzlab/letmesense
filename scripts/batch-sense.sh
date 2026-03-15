#!/usr/bin/env bash
# Batch-convert documents to markdown using letmesense.
#
# Supports local directories and S3 buckets. Runs conversions in parallel.
#
# Usage:
#   batch-sense.sh [OPTIONS] <source> [-- extra letmesense args]
#
#   <source>   Local directory or s3://bucket/prefix
#
# Options:
#   -j, --jobs N        Concurrency 2-128 (default: 4)
#   -m, --model SPEC    Model spec (default: openai:mini:minimal)
#   -d, --dir DIR       Local working directory (default: source dir, or ./batch-sense-out for S3)
#   -f, --force         Re-process files even if .md already exists
#   -h, --help          Show this help
#
# Examples:
#   batch-sense.sh ./documents -- --dotenv -Jy --vision
#   batch-sense.sh -j 16 s3://my-bucket/docs -- --dotenv -Jy --vision
#   batch-sense.sh -j 8 -m anthropic:haiku -d ./local-cache s3://bucket/prefix

set -euo pipefail

# ── defaults ──────────────────────────────────────────────────────────────────
CONCURRENCY=4
MODEL="openai:mini:minimal"
SOURCE=""
LOCAL_DIR=""
FORCE=false
EXTRA_ARGS=()

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# //; s/^#//'
  exit 0
}

# ── parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -j|--jobs)  [[ $# -ge 2 ]] || { echo "Error: $1 requires a value" >&2; exit 1; }; CONCURRENCY="$2"; shift 2 ;;
    -m|--model) [[ $# -ge 2 ]] || { echo "Error: $1 requires a value" >&2; exit 1; }; MODEL="$2"; shift 2 ;;
    -d|--dir)   [[ $# -ge 2 ]] || { echo "Error: $1 requires a value" >&2; exit 1; }; LOCAL_DIR="$2"; shift 2 ;;
    -f|--force) FORCE=true; shift ;;
    -h|--help)  usage ;;
    --)         shift; EXTRA_ARGS=("$@"); break ;;
    -*)         echo "Unknown option: $1" >&2; exit 1 ;;
    *)          SOURCE="$1"; shift ;;
  esac
done

[[ -z "$SOURCE" ]] && { echo "Error: <source> required." >&2; usage; }

if ! [[ "$CONCURRENCY" =~ ^[0-9]+$ ]] || [[ "$CONCURRENCY" -lt 2 || "$CONCURRENCY" -gt 128 ]]; then
  echo "Error: --jobs must be 2-128" >&2
  exit 1
fi

# ── supported extensions (single source of truth) ────────────────────────────
EXTS=(pdf doc docx xls xlsx ppt pptx png jpg jpeg gif webp tiff tif bmp)

# build find -name predicates
FIND_ARGS=()
for ext in "${EXTS[@]}"; do
  [[ ${#FIND_ARGS[@]} -gt 0 ]] && FIND_ARGS+=("-o")
  FIND_ARGS+=(-name "*.${ext}")
done

# build aws s3 sync --include flags
S3_INCLUDES=(--exclude '*')
for ext in "${EXTS[@]}"; do
  S3_INCLUDES+=(--include "*.${ext}")
done

# ── S3 vs local ──────────────────────────────────────────────────────────────
IS_S3=false
S3_PREFIX=""

if [[ "$SOURCE" == s3://* ]]; then
  IS_S3=true
  S3_PREFIX="${SOURCE%/}"
  LOCAL_DIR="${LOCAL_DIR:-./batch-sense-out}"
  mkdir -p "$LOCAL_DIR"

  echo "Syncing $S3_PREFIX -> $LOCAL_DIR ..."
  aws s3 sync "$S3_PREFIX" "$LOCAL_DIR" "${S3_INCLUDES[@]}"
else
  LOCAL_DIR="${LOCAL_DIR:-$SOURCE}"
fi

# ── find files ────────────────────────────────────────────────────────────────
FILELIST=$(mktemp)
EXTRA_ARGS_FILE=$(mktemp)
FAIL_LOG=$(mktemp)
OK_LOG=$(mktemp)
trap 'rm -f "$FILELIST" "$EXTRA_ARGS_FILE" "$FAIL_LOG" "$OK_LOG"' EXIT

find "$LOCAL_DIR" -type f \( "${FIND_ARGS[@]}" \) -print0 > "$FILELIST"

TOTAL=$(tr '\0' '\n' < "$FILELIST" | wc -l | tr -d ' ')
if [[ "$TOTAL" -eq 0 ]]; then
  echo "No supported files found in $LOCAL_DIR"
  exit 0
fi

echo "Found $TOTAL files. Processing with $CONCURRENCY workers..."
echo

# ── worker function ───────────────────────────────────────────────────────────
if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  printf '%s\0' "${EXTRA_ARGS[@]}" > "$EXTRA_ARGS_FILE"
fi
export MODEL FORCE IS_S3 S3_PREFIX LOCAL_DIR EXTRA_ARGS_FILE FAIL_LOG OK_LOG

process_one() {
  local file="$1"
  local outfile="${file}.md"

  local -a extra=()
  if [[ -s "$EXTRA_ARGS_FILE" ]]; then
    while IFS= read -r -d '' arg; do extra+=("$arg"); done < "$EXTRA_ARGS_FILE"
  fi

  if [[ "$FORCE" != "true" && -f "$outfile" ]]; then
    echo "[skip] $(basename "$file") — .md exists"
    return 0
  fi

  echo "[run]  $(basename "$file")"

  # ${arr[@]+...} avoids "unbound variable" under set -u when array is empty
  if letmesense -m "$MODEL" -o "$outfile" ${extra[@]+"${extra[@]}"} "$file" 2>&1; then
    echo "[done] $(basename "$outfile")"
    echo x >> "$OK_LOG"

    if [[ "$IS_S3" == "true" ]]; then
      local rel="${outfile#"$LOCAL_DIR"/}"
      aws s3 cp "$outfile" "${S3_PREFIX}/${rel}" --quiet && \
        echo "[s3]   ${rel}"
    fi
  else
    echo "[FAIL] $(basename "$file")" >&2
    echo x >> "$FAIL_LOG"
    return 1
  fi
}
export -f process_one

# ── run in parallel ───────────────────────────────────────────────────────────
xargs -0 -P "$CONCURRENCY" -I {} bash -c 'process_one "$@"' _ {} < "$FILELIST" || true

OK_COUNT=$(wc -l < "$OK_LOG" 2>/dev/null | tr -d ' ' || echo 0)
FAIL_COUNT=$(wc -l < "$FAIL_LOG" 2>/dev/null | tr -d ' ' || echo 0)
SKIP_COUNT=$(( TOTAL - OK_COUNT - FAIL_COUNT ))

echo
echo "Done. $TOTAL files: $OK_COUNT ok, $FAIL_COUNT failed, $SKIP_COUNT skipped."
[[ "$FAIL_COUNT" -gt 0 ]] && exit 1
exit 0

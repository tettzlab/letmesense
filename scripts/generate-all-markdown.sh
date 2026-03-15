#!/usr/bin/env bash
# Generate markdown from all document files in samples/
# Requires: letmesense binary installed (pnpm link --global)
#
# Usage: ./generate-all-markdown.sh [options]
#
# All options are passed through to letmesense.
# Examples:
#   ./generate-all-markdown.sh                    # Basic extraction
#   ./generate-all-markdown.sh --vision           # Use vision mode
#   ./generate-all-markdown.sh --ocr-lang jpn     # Japanese OCR
#   ./generate-all-markdown.sh --model openai:gpt # Specific model

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SAMPLES_DIR="$ROOT_DIR/samples"
OUTPUT_DIR="$ROOT_DIR/out"

mkdir -p "$OUTPUT_DIR"

# Supported extensions
EXTENSIONS=("pdf" "png" "jpg" "jpeg" "gif" "webp" "docx" "pptx" "xlsx")

echo "Generating markdown from samples..."
echo "Output directory: $OUTPUT_DIR"
[[ $# -gt 0 ]] && echo "Options: $*"
echo

for ext in "${EXTENSIONS[@]}"; do
  for file in "$SAMPLES_DIR"/*."$ext"; do
    [ -e "$file" ] || continue

    filename=$(basename "$file")
    markdown_file="$OUTPUT_DIR/${filename}.md"
    output_file="$OUTPUT_DIR/${filename}.log"

    echo "Processing: $filename"
    echo letmesense "$file $@ --output $markdown_file > $output_file 2>&1"
    letmesense "$file" "$@" --output "$markdown_file" > "$output_file" 2>&1 || {
      echo "  Warning: failed to process $filename"
      continue
    }
    echo "  -> $markdown_file"
  done
done

echo
echo "Done!"

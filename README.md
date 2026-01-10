# letmesense

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Extract text from PDFs and Office documents with automatic OCR fallback and optional LLM enhancement.

## Overview

**PDFs are treacherous.** A single document may contain:
- **Born-digital** pages with selectable text
- **Scanned images** requiring OCR
- **Mixed** pages with both text and embedded scans

This library analyzes each page, groups consecutive pages with the same characteristics into "runs", and extracts text using the optimal strategy for each run.

## Features

| Feature | Description |
|---------|-------------|
| **Smart Classification** | Detect `born-digital`, `scanned-image`, `mixed`, or `empty` pages |
| **Run Splitting** | Group consecutive pages by kind, paper size, orientation, language |
| **Automatic OCR** | Use PDF.js for digital text, Tesseract.js for scans |
| **Office Support** | DOCX, PPTX, XLSX, ODT, ODP, ODS extraction |
| **LLM Enhancement** | Clean and structure text using OpenAI, Anthropic, Google, or Ollama |
| **Vision Mode** | Send page images to LLM for layout-aware extraction |
| **Flexible Output** | Plain text, JSON with metadata, CSV, TSV |

## Quick Start

```bash
# Install
pnpm install

# Extract text (auto-detects format)
pnpm cli document.pdf
pnpm cli presentation.pptx

# Add metadata wrapper
pnpm cli document.pdf --json

# LLM-enhanced extraction (outputs clean markdown)
pnpm cli document.pdf --llm

# Vision mode (sends images + text to LLM)
pnpm cli document.pdf --vision
```

---

## CLI Design Philosophy

The CLI separates two orthogonal concerns:

| Concern | Flags | Description |
|---------|-------|-------------|
| **Extraction Mode** | `--llm`, `--vision` | *How* to extract content |
| **Output Format** | `--json`, `--csv`, `--tsv` | *How* to format the result |

These can be combined freely:

```bash
letmesense doc.pdf              # Plain text extraction
letmesense doc.pdf --json       # Plain text + metadata wrapper
letmesense doc.pdf --llm        # LLM-enhanced markdown
letmesense doc.pdf --llm --json # LLM markdown + metadata wrapper
letmesense doc.pdf --vision     # Vision mode (text + images to LLM)
```

### Migration from --format

| Old | New |
|-----|-----|
| `--format text` | (default) |
| `--format markdown` | `--llm` |
| `--format json` | `--json` |
| `--format csv` | `--csv` |

---

## Installation

### Requirements

- Node.js >= 18.18
- pnpm (recommended) or npm
- Linux: Cairo/Pango for canvas (`sudo apt install libcairo2-dev libpango1.0-dev`)

### Install

```bash
pnpm install
pnpm build  # For CLI global install
```

### Global CLI (optional)

```bash
pnpm build
pnpm link --global
letmesense --help
```

---

## CLI Reference

### Unified CLI (`letmesense`)

Auto-detects file format and delegates to the appropriate extractor.

```bash
letmesense <input> [options]

Arguments:
  input              File path, URL, or "-" for stdin

Options:
  --input-format     Specify format explicitly (required for stdin)
                     Values: pdf, docx, pptx, xlsx, odt, odp, ods
  -h, --help         Show help
  -V, --version      Show version

All other options are passed through to the PDF or Office extractor.
```

**Examples:**

```bash
letmesense document.pdf
letmesense presentation.pptx
letmesense https://example.com/report.pdf
cat doc.pdf | letmesense - --input-format pdf

# With options
letmesense document.pdf --json
letmesense document.pdf --llm
letmesense spreadsheet.xlsx --csv
```

---

### PDF Options

```bash
letmesense <input> [options]

Arguments:
  input              PDF file path, URL, or "-" for stdin

General Options:
  -o, --output <file>    Write output to file instead of stdout
  -q, --quiet            Suppress progress messages
  -j, --json             Wrap output in JSON with metadata
  --ocr-lang <lang>      OCR language code (default: "eng")
  -V, --version          Show version
  -h, --help             Show help

LLM Options:
  --llm                  LLM-enhanced extraction (outputs markdown)
  --vision               Vision mode (renders to images, sends to LLM)
  -m, --model <spec>     LLM model as 'provider:model' (auto-detects if omitted)
  -p, --prompt <text>    Custom prompt for LLM/vision
  -y, --yes              Skip cost confirmation
```

**Examples:**

```bash
# Basic extraction
letmesense document.pdf
letmesense https://example.com/doc.pdf --ocr-lang eng+deu

# With metadata
letmesense document.pdf --json

# LLM-enhanced (auto-detects provider from API key)
letmesense document.pdf --llm
letmesense document.pdf --llm -m anthropic:haiku

# Vision mode (best for complex layouts)
letmesense document.pdf --vision
letmesense document.pdf --vision -m openai:mini

# Skip cost confirmation
letmesense document.pdf --llm -y
```

---

### Office Options

```bash
letmesense <input> [options]

Arguments:
  input              Office file path, URL, or "-" for stdin

General Options:
  -o, --output <file>    Write output to file instead of stdout
  -q, --quiet            Suppress progress messages
  -j, --json             JSON with metadata (structured for spreadsheets)
  --input-format <fmt>   Specify format (required for stdin)
  -h, --help             Show help

LLM Options:
  --llm                  LLM-enhanced extraction (outputs markdown)
  --vision               Vision mode (requires LibreOffice)
  -m, --model <spec>     LLM model as 'provider:model' (auto-detects if omitted)
  -p, --prompt <text>    Custom prompt for LLM/vision
  -y, --yes              Skip cost confirmation

Output Format:
  --csv                  CSV format (spreadsheets only)

Document Options:
  --slides <range>       Extract specific slides (e.g., 1-5,7,9-12)
  --sheets <names>       Extract specific sheets (comma-separated)
  --headers              Treat first row as headers (XLSX, ODS)
```

**Examples:**

```bash
# Basic extraction
letmesense presentation.pptx
letmesense document.docx

# Spreadsheet formats
letmesense data.xlsx --csv
letmesense data.xlsx --tsv
letmesense data.xlsx --json              # Structured arrays
letmesense data.xlsx --json --headers    # Objects with keys

# LLM-enhanced
letmesense presentation.pptx --llm
letmesense document.docx --llm --json
letmesense data.xlsx --llm                # Markdown tables
letmesense data.xlsx --llm --max-rows 20  # Limit to 20 rows

# Vision mode (best for complex layouts)
letmesense presentation.pptx --vision

# Filtering
letmesense presentation.pptx --slides 1-5,10
letmesense data.xlsx --sheets "Sheet1,Summary"
letmesense presentation.pptx --include-notes
```

---

## Output Formats

### Plain Text (default)

Raw extracted text, suitable for piping to other tools.

```bash
letmesense document.pdf
```

```
Chapter 1: Introduction

This document covers the basics of...

===

Chapter 2: Methods

We employed several techniques...
```

---

### JSON (`--json`)

Adds metadata wrapper. Structure varies by document type.

#### PDF JSON Output

```bash
letmesense document.pdf --json
```

```json
{
  "text": "Chapter 1: Introduction\n\nThis document covers...",
  "metadata": {
    "runs": [
      {
        "pageIndices": [0, 1, 2, 3],
        "kind": "born-digital",
        "language": "eng",
        "orientation": "portrait",
        "paperKey": "letter"
      },
      {
        "pageIndices": [4, 5],
        "kind": "scanned-image",
        "language": "eng"
      }
    ],
    "totalPages": 6
  }
}
```

#### Office JSON Output (PPTX, DOCX)

```bash
letmesense presentation.pptx --json
```

```json
{
  "format": "pptx",
  "text": "Slide 1: Project Overview\n\nQ4 2024 Results...",
  "units": [
    {
      "index": 0,
      "label": "Slide 1",
      "text": "Project Overview\n\nQ4 2024 Results..."
    },
    {
      "index": 1,
      "label": "Slide 2",
      "text": "Key Metrics\n\nMonthly Active Users: 2.4M..."
    }
  ],
  "metadata": {
    "unitCount": 2,
    "dominantLanguage": "eng"
  },
  "errors": []
}
```

#### Spreadsheet JSON Output (XLSX, ODS)

Spreadsheets output **structured arrays**, not text blobs:

```bash
letmesense data.xlsx --json
```

```json
{
  "format": "xlsx",
  "sheets": [
    {
      "name": "Sheet1",
      "rows": [
        ["Name", "Age", "Department"],
        ["Alice", "32", "Engineering"],
        ["Bob", "28", "Design"]
      ]
    }
  ],
  "metadata": {
    "sheetCount": 1,
    "totalRows": 3
  },
  "errors": []
}
```

With `--headers`, rows become objects:

```bash
letmesense data.xlsx --json --headers
```

```json
{
  "format": "xlsx",
  "sheets": [
    {
      "name": "Sheet1",
      "headers": ["Name", "Age", "Department"],
      "data": [
        { "Name": "Alice", "Age": "32", "Department": "Engineering" },
        { "Name": "Bob", "Age": "28", "Department": "Design" }
      ]
    }
  ]
}
```

Note: `--headers` applies uniformly to all sheets. Sheets with empty first rows use column indices as keys (`column_0`, `column_1`, etc.).

---

### CSV / TSV (spreadsheets only)

```bash
letmesense data.xlsx --csv
letmesense data.xlsx --tsv
```

```
Name,Age,Department
Alice,32,Engineering
Bob,28,Design
```

---

## LLM Enhancement

### Why LLM?

Raw PDF text extraction loses semantic structure:
- Headings appear as plain text
- Tables become flat text
- Lists lose formatting
- Multi-column layouts get scrambled

LLM enhancement infers structure and produces clean markdown.

### Extraction Modes

| Mode | Flag | What happens | Cost |
|------|------|--------------|------|
| **Plain** | (default) | Text extraction only | Free |
| **LLM** | `--llm` | Text → LLM → Markdown | $ |
| **Vision** | `--vision` | Text + Images → LLM → Markdown | $$$ |

### How Vision Mode Works

Vision mode sends **both** extracted text and rendered images to the LLM:

```
Document → Extract text ─────────────┐
         → Render images ────────────┼→ LLM → Markdown
```

The LLM cross-references both:
- **Text**: Accurate characters (no OCR errors)
- **Images**: Visual layout, tables, diagrams

This produces better results than either alone.

### When to Use Vision Mode

| Scenario | `--llm` | `--vision` |
|----------|---------|------------|
| Clean born-digital PDF | Good | Overkill |
| Complex multi-column layout | Misses structure | Sees layout |
| Charts/diagrams | Can't see them | Describes them |
| Tables with merged cells | Often broken | Sees visual structure |
| Scanned documents | OCR text only | Sees original |

### LLM on Spreadsheets

When `--llm` is used with spreadsheets, data is rendered as markdown tables:

```bash
letmesense data.xlsx --llm --max-rows 10
```

```markdown
## Sheet: Sales

| Name  | Q1   | Q2   |
|-------|------|------|
| Alice | 1200 | 1350 |
| Bob   | 980  | 1100 |

... (98 more rows)
```

Use `--max-rows` to control truncation (default: 50, 0=unlimited).

### Providers

| Provider | Text Models | Vision Models | Offline |
|----------|-------------|---------------|---------|
| OpenAI | gpt-5.2, gpt-5-mini, gpt-5-nano | gpt-5.2, gpt-5-mini, gpt-5-nano | No |
| Anthropic | claude-3-5-haiku, claude-sonnet-4 | claude-sonnet-4 | No |
| Google | gemini-3-flash-preview, gemini-3-pro-preview | gemini-3-pro-preview | No |
| Ollama | llama3.2, mistral | llava | Yes |

### Configuration

Set API keys via environment variables:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GOOGLE_GENERATIVE_AI_API_KEY=...
export OLLAMA_HOST=http://localhost:11434  # Optional
```

Provider is auto-detected from available keys (OpenAI → Anthropic → Google → Ollama).

### Expert Options (Environment Variables)

Fine-tuning options are available via environment variables:

```bash
# OCR render scale (default: 2.5, range: 0.1-10)
# Higher = better quality but slower and more memory
LETMESENSE_OCR_SCALE=3.0 letmesense scanned.pdf

# Min chars to classify page as text (default: 20)
LETMESENSE_TEXT_THRESHOLD=50 letmesense doc.pdf

# OCR fallback threshold for mixed pages (default: 50)
LETMESENSE_OCR_THRESHOLD=100 letmesense doc.pdf
```

### Model Aliases

Use `-m provider:alias` for convenience:

```bash
letmesense doc.pdf --llm -m anthropic:sonnet   # → claude-sonnet-4-5-20250929
letmesense doc.pdf --llm -m anthropic:haiku    # → claude-haiku-4-5-20251001
letmesense doc.pdf --llm -m openai:mini        # → gpt-5-mini
```

JSON output always contains the full model ID.

### Cost Estimation

Before LLM calls, the CLI shows estimated cost:

```
Estimated API cost: ~$0.12
  Pages: 5
  Mode: vision
  Provider: anthropic (claude-sonnet-4)
Proceed? [Y/n]
```

Use `-y` / `--yes` to skip confirmation.

### LLM with JSON Output

Combine `--llm` or `--vision` with `--json` to get LLM-enhanced markdown wrapped in JSON with usage stats:

```bash
letmesense document.pdf --llm --json
```

```json
{
  "text": "# Chapter 1: Introduction\n\nThis document covers...",
  "metadata": {
    "runs": [...],
    "totalPages": 6
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5-20250929",
    "mode": "text",
    "inputTokens": 1250,
    "outputTokens": 890,
    "cost": 0.0124
  }
}
```

The `mode` field is `"text"` for `--llm` or `"vision"` for `--vision`.

---

## Programmatic API

### PDF Extraction

```typescript
import { extractFromPdf } from './lib/pdf/index.js'

// Basic extraction
const result = await extractFromPdf('document.pdf')
console.log(result.text)

// With options
const result = await extractFromPdf(pdfBytes, {
  ocrLang: 'eng+jpn',
  includeMetadata: true,
})
console.log(result.metadata?.runs)
```

### Office Extraction

```typescript
import { extractFromOffice } from './lib/office/index.js'

// Basic extraction
const result = await extractFromOffice('presentation.pptx')
console.log(result.text)

// With options
const result = await extractFromOffice('spreadsheet.xlsx', {
  headers: true,
  sheetNames: 'Data',
})
```

### LLM Formatting

```typescript
import { formatAsMarkdown } from './lib/ai/index.js'

const formatted = await formatAsMarkdown(
  [{ text: extractedText, pageIndex: 0 }],
  {
    format: 'markdown',
    llm: { provider: 'openai', model: 'gpt-5-mini' },
  }
)
console.log(formatted.content)

// With vision mode
const formatted = await formatAsMarkdown(pages, {
  format: 'markdown',
  vision: true,
  llm: { provider: 'anthropic' },
})

// With streaming
const formatted = await formatAsMarkdown(pages, {
  format: 'markdown',
  onProgress: (event) => {
    if (event.type === 'content') process.stdout.write(event.content)
  },
})
```

---

## Configuration

### Classification Thresholds

Thresholds in `lib/pdf/classify.ts` control page classification:

| Threshold | Default | Purpose |
|-----------|---------|---------|
| `minCharsForTextPage` | 20 | Min chars to count as "has text" |
| `scannedIfMaxImageCoverageAtLeast` | 0.6 | Image coverage for scanned |
| `mixedIfMaxImageCoverageAtLeast` | 0.1 | Image coverage for mixed |
| `ignoreSmallImagesBelowCoverage` | 0.02 | Filter decorative images |

### Offline OCR

For air-gapped environments:

```bash
mkdir tessdata
curl -L -o tessdata/eng.traineddata.gz \
  https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/eng.traineddata.gz
```

The library auto-detects local files and skips CDN fetch.

### Vision Mode Requirements

For Office documents, vision mode requires LibreOffice:

```bash
# macOS
brew install --cask libreoffice

# Ubuntu/Debian
sudo apt install libreoffice-core

# Windows
choco install libreoffice-fresh
```

---

## Troubleshooting

### Canvas Build Errors (Linux)

```bash
sudo apt install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

### OCR Language Not Found

```bash
# Correct format: 3 lowercase letters
letmesense doc.pdf --ocr-lang eng      # Correct
letmesense doc.pdf --ocr-lang english  # Wrong

# Multiple languages
letmesense doc.pdf --ocr-lang eng+deu+fra
```

### Memory Issues

- Reduce OCR scale: `LETMESENSE_OCR_SCALE=1.5 letmesense doc.pdf`
- Process large PDFs in chunks using `splitIntoRuns()`

### Empty Output from Scanned PDF

- Check OCR language matches document language
- Increase OCR scale for low-quality scans: `LETMESENSE_OCR_SCALE=4.0 letmesense doc.pdf`
- Verify tessdata is available

### LibreOffice Not Found (Vision Mode)

Vision mode for Office documents requires LibreOffice:

```bash
# macOS
brew install --cask libreoffice

# Ubuntu/Debian
sudo apt install libreoffice-core

# Windows
choco install libreoffice-fresh
```

Use `--llm` instead for text-only LLM enhancement (no LibreOffice needed).

---

## Development

```bash
pnpm validate          # typecheck + lint + test
pnpm test              # Run tests
pnpm test:watch        # Watch mode
pnpm test:cov          # Coverage report
pnpm typecheck         # TypeScript only
pnpm lint              # Biome linter
pnpm lint:fix          # Auto-fix
```

---

## License

Apache-2.0

### Dependency Note

The `xlsx` package is pinned to version 0.18.5, which is the last Apache-2.0 licensed release before SheetJS moved to a proprietary license. Do not upgrade without reviewing their new licensing terms.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical documentation.

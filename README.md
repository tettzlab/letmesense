# letmesense

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Extract text from PDFs and Office documents with automatic OCR fallback and optional LLM enhancement.

## Overview

**PDFs are treacherous.** A single document may contain:
- **Born-digital** pages with selectable text
- **Scanned images** requiring OCR
- **Mixed** pages with both text and embedded scans

This library analyzes each page, groups consecutive pages with the same characteristics into "runs", and extracts text using the optimal strategy for each run.

## Implementations

| | TypeScript | Python |
|--|------------|--------|
| Directory | `/` (root) | `letmesense-py/` |
| Runtime | Node.js ≥24 | Python ≥3.11 |
| Package manager | pnpm | uv |
| LLM abstraction | Vercel AI SDK | PydanticAI |

Both implementations share the same architecture, CLI interface, and feature set.

## Features

| Feature | Description |
|---------|-------------|
| **Smart Classification** | Detect `born-digital`, `scanned-image`, `mixed`, or `empty` pages |
| **Run Splitting** | Group consecutive pages by kind, paper size, orientation, language |
| **Automatic OCR** | PDF.js/Tesseract.js (TS) or pypdf/pytesseract (Py) |
| **Office Support** | DOCX, PPTX, XLSX, ODT, ODP, ODS |
| **Image Support** | PNG, JPG, GIF, WebP, SVG |
| **HTML/Web Support** | Local HTML files and remote URLs (Readability + Turndown) |
| **LLM Enhancement** | OpenAI, Anthropic, Google, or Ollama |
| **Vision Mode** | Send page images + text to LLM for layout-aware extraction |
| **Flexible Output** | Plain text, JSON with metadata, CSV, TSV |
| **Condensation** | Map-reduce LLM summarization for long documents |

## Quick Start

```bash
# TypeScript
pnpm install && pnpm build
pnpm cli document.pdf

# Python
cd letmesense-py && uv sync
uv run letmesense document.pdf
```

## CLI

```bash
letmesense <input> [options]
```

`<input>` is a file path, URL, or `-` for stdin.

### Extraction modes

| Mode | Flag | Description | Cost |
|------|------|-------------|------|
| Plain | (default) | Text extraction only | Free |
| LLM | `--llm` | Text → LLM → Markdown | $ |
| Vision | `--vision` | Text + Images → LLM → Markdown | $$$ |

### Output formats

| Flag | Description |
|------|-------------|
| (default) | Plain text |
| `--json`, `-j` | JSON with metadata |
| `--csv` | CSV (spreadsheets only) |
| `--tsv` | TSV (spreadsheets only) |

### Common options

| Flag | Description |
|------|-------------|
| `-o`, `--output` | Write to file |
| `-m`, `--model` | LLM model as `provider:alias[:effort]` (e.g. `openai:mini:low`) |
| `-p`, `--prompt` | Custom prompt for LLM/vision extraction |
| `--prompt-file` | Custom prompt template file |
| `-y`, `--yes` | Skip cost confirmation |
| `-q`, `--quiet` | Suppress progress |
| `--strict` | Fail on first error |
| `--stream` / `--no-stream` | Force streaming or atomic output |
| `--separator <str>` | Separator between document units |
| `--ocr-lang` | OCR language codes (default: `eng`) |
| `--playwright <mode>` | Playwright rendering: `always`, `auto`, `none` |
| `--models-file <path>` | Path to custom `models.json` |
| `--models-json <json>` | Raw JSON string for model registry |
| `--dotenv` | Load environment variables from `.env` file |
| `-J`, `--journal` | Enable journaling |
| `--journal-dir <path>` | Journal directory (default: `./experiments`) |
| `--journal-format <fmt>` | Journal format: `markdown` (default) or `jsonl` |

### Examples

```bash
# Basic extraction
letmesense document.pdf
letmesense presentation.pptx

# JSON with metadata
letmesense document.pdf --json

# LLM-enhanced markdown
letmesense document.pdf --llm
letmesense document.pdf --llm -m anthropic:haiku
letmesense document.pdf --llm -m openai:mini:low

# Vision mode (complex layouts, charts, scans)
letmesense document.pdf --vision

# HTML / web pages
letmesense page.html
letmesense https://example.com/article

# Spreadsheets
letmesense data.xlsx --csv
letmesense data.xlsx --json --headers

# Custom prompt
letmesense document.pdf --llm -p "Extract only the tables"
```

## Condense CLI

```bash
letmedense <input> [options]
```

`<input>` is a file path or `-` for stdin. Condenses long text via LLM map-reduce.

### Target (at least one required)

| Flag | Description |
|------|-------------|
| `--max-chars <n>` | Target max character count |
| `--max-tokens <n>` | Target max token count |
| `--ratio <n>` | Target compression ratio (0–1) |

### Options

| Flag | Description |
|------|-------------|
| `-m`, `--model` | LLM model (e.g. `openai:mini`) |
| `-o`, `--output` | Write to file |
| `-q`, `--quiet` | Suppress progress |
| `--json` | Full result with usage/cost |
| `--chunk-strategy` | `heading` (default), `paragraph`, or `tokens` |
| `--concurrency <n>` | Max parallel LLM calls (default: 5) |
| `--max-depth <n>` | Max reduce recursion depth (default: 10) |
| `--models-file <path>` | Path to custom `models.json` |
| `--models-json <json>` | Raw JSON string for model registry |
| `--dotenv` | Load environment variables from `.env` file |

### Examples

```bash
# Condense to 30% of original
letmedense article.md --ratio 0.3

# Condense to token budget
letmedense long.txt --max-tokens 500 -m openai:mini

# Pipe from stdin, output JSON with cost info
cat document.md | letmedense - --max-chars 2000 --json
```

## LLM Providers

| Provider | Text Models | Vision Models |
|----------|-------------|---------------|
| OpenAI | gpt-5.2, gpt-5-mini, gpt-5-nano | All |
| Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | All |
| Google | gemini-3-pro-preview, gemini-3-flash-preview, gemini-2.5-pro, gemini-2.5-flash | All |
| Ollama | llama3.3, qwen2.5 | llama3.2-vision |

Model spec format: `provider:alias[:effort]` (e.g. `openai:mini`, `anthropic:sonnet:high`).

Set API keys:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

Provider auto-detects from available keys. Use `-m provider:alias` to override.

## Programmatic API

### TypeScript

```typescript
import { sense } from 'letmesense'

const result = await sense('document.pdf')
console.log(result.text)

// With LLM formatting
const formatted = await sense('document.pdf', { llm: true })

// Vision mode
const vision = await sense('document.pdf', { vision: true })
```

### Python

```python
from letmesense import sense, SenseOptions

result = await sense("document.pdf")
print(result.text)

# With LLM formatting
formatted = await sense("document.pdf", SenseOptions(mode="llm"))

# Vision mode
vision = await sense("document.pdf", SenseOptions(mode="vision"))
```

## Development

### TypeScript

```bash
pnpm validate          # typecheck + lint + test
pnpm test              # Fast tests
pnpm test:full         # All tests
pnpm lint:fix          # Auto-fix
```

### Python

```bash
cd letmesense-py
uv run task validate   # typecheck + lint + test
uv run task test       # Fast tests
uv run task test:full  # All tests
uv run task lint:fix   # Auto-fix
```

## Installation Notes

### Canvas (Linux)

```bash
sudo apt install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

### Vision Mode (Office)

Requires LibreOffice:

```bash
# macOS
brew install --cask libreoffice

# Ubuntu/Debian
sudo apt install libreoffice-core
```

### Offline OCR

Download tessdata files to `tessdata/`:
- TypeScript: `*.traineddata.gz` (compressed)
- Python: `*.traineddata` (uncompressed)

## License

Apache-2.0

**Note:** `xlsx` is pinned to 0.18.5 (last Apache-2.0 release before SheetJS license change).
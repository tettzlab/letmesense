# letmesense

[![CI](https://github.com/tettzlab/letmesense/actions/workflows/ci.yml/badge.svg)](https://github.com/tettzlab/letmesense/actions/workflows/ci.yml)
[![CodeQL](https://github.com/tettzlab/letmesense/actions/workflows/codeql.yml/badge.svg)](https://github.com/tettzlab/letmesense/actions/workflows/codeql.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-brightgreen)](https://nodejs.org)

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
| **Automatic OCR** | PDF.js + Tesseract.js |
| **Office Support** | DOCX, PPTX, XLSX, ODT, ODP, ODS |
| **Image Support** | PNG, JPG, GIF, WebP, SVG |
| **HTML/Web Support** | Local HTML files and remote URLs (Readability + Turndown) |
| **LLM Enhancement** | OpenAI, Anthropic, Google, or Ollama |
| **Vision Mode** | Send page images + text to LLM for layout-aware extraction |
| **Flexible Output** | Plain text, JSON with metadata, CSV, TSV |
| **Condensation** | Map-reduce LLM summarization for long documents |

## Quick Start

```bash
pnpm install && pnpm build
pnpm cli document.pdf
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

> **Note:** Cost estimates shown before confirmation prompts are approximate. Actual charges depend on content complexity, model-specific tokenization, and provider pricing at the time of the request. Always review your provider's billing dashboard for precise usage.

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

### Office options

| Flag | Description |
|------|-------------|
| `--include-notes` | Include speaker notes (PPTX) |
| `--slides <range>` | Slide range (e.g. `1-5,7,9-12`) |
| `--sheets <names>` | Sheet names (comma-separated) |
| `--headers` | Treat first row as headers (XLSX) |
| `--max-rows <n>` | Max rows for tabular output (default: 50) |

### Image options

| Flag | Description |
|------|-------------|
| `--max-dimension <n>` | Max image dimension (default: 1024) |
| `--quality <n>` | JPEG/WebP quality (default: 85) |

### HTML/Web options

| Flag | Description |
|------|-------------|
| `--no-links` | Strip links, keep text only |
| `--no-images` | Strip images from output |

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
| Azure OpenAI | gpt-5.4, gpt-5.2, gpt-5-mini, gpt-5-nano | All |

Model spec format: `provider:alias[:effort]` (e.g. `openai:mini`, `anthropic:sonnet:high`).

Set API keys:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GOOGLE_API_KEY=...
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
```

Provider auto-detects from available keys. Use `-m provider:alias` to override.

### Custom Model Registry

The bundled `models.json` defines all supported models, their pricing, context windows, and capabilities. You can override it to add custom models, update pricing, or restrict available models.

```bash
# Generate a starter template
letmesense init-models

# Or copy the full bundled registry to customize
letmesense init-models --full

# Use a custom file
letmesense doc.pdf --models-file models.json

# Or pass JSON inline
letmesense doc.pdf --models-json '{"defaultProvider":"anthropic", ...}'

# Or via environment variables
export MODELS_FILE=/path/to/my-models.json
# or
export MODELS_JSON='...'
```

The file structure:

```json
{
  "defaultProvider": "openai",
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "defaultModel": "gpt-5-mini",
      "defaultVisionModel": "gpt-5-mini"
    }
  ],
  "models": [
    {
      "id": "gpt-5-mini",
      "name": "GPT-5 Mini",
      "provider": "openai",
      "encoding": "o200k_base",
      "contextWindow": 400000,
      "maxOutputTokens": 128000,
      "aliases": ["mini"],
      "pricing": { "input": 0.25, "output": 2.0, "image": 0.25 },
      "capabilities": { "vision": true }
    }
  ]
}
```

Each model entry supports:
- **`aliases`** — short names for `-m provider:alias` (e.g. `openai:mini`)
- **`pricing`** — per-million-token costs (used for `--yes` cost estimates)
- **`capabilities.vision`** — whether the model accepts images
- **`capabilities.pdfInput`** — whether the model accepts PDF files directly
- **`capabilities.reasoning`** — object with `levels` array (`none`, `low`, `medium`, `high`, `xhigh`) and a `default` effort for reasoning models

See the bundled [`models.json`](models.json) for the full list.

## Programmatic API

```typescript
import { sense } from 'letmesense'

const result = await sense('document.pdf')
console.log(result.text)

// With LLM formatting
const formatted = await sense('document.pdf', { llm: true })

// Vision mode
const vision = await sense('document.pdf', { vision: true })
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and pull request guidelines.

## Development

```bash
pnpm validate          # typecheck + lint + test
pnpm test              # Fast tests
pnpm test:full         # All tests
pnpm lint:fix          # Auto-fix
```

## Installation Notes

### Canvas (Linux)

```bash
sudo apt install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

### LibreOffice (for Vision Mode)

Vision mode (`--vision`) on Office documents (DOCX, PPTX, XLSX, etc.) requires LibreOffice to render pages as images. Basic text extraction works without it.

**macOS**

```bash
brew install --cask libreoffice
```

The app installs to `/Applications/LibreOffice.app` and is auto-detected — no PATH changes needed.

**Linux**

```bash
# Ubuntu / Debian
sudo apt install libreoffice-core libreoffice-impress libreoffice-writer libreoffice-calc

# Fedora
sudo dnf install libreoffice-core libreoffice-impress libreoffice-writer libreoffice-calc

# Arch
sudo pacman -S libreoffice-fresh
```

Snap, Flatpak, NixOS, and Homebrew installs are also auto-detected.

**Windows**

```bash
choco install libreoffice-fresh
```

Or download from [libreoffice.org](https://www.libreoffice.org/download/).

**Custom install path**

If LibreOffice is installed in a non-standard location, set the `LIBREOFFICE_PATH` environment variable:

```bash
export LIBREOFFICE_PATH=/path/to/soffice
```

**Verify installation**

```bash
soffice --version
```

### Playwright (for PDF/Web Vision Mode)

Vision mode (`--vision`) on PDFs and web pages uses [Playwright](https://playwright.dev/) to render pages as images in a headless Chromium browser. This provides accurate font rendering for all scripts including CJK.

```bash
npx playwright install
```

Without Playwright browsers installed, PDF vision mode falls back to `@napi-rs/canvas` rendering, which may produce poor results for CJK text. Web page vision mode requires Playwright. The `--playwright` flag controls this behavior:

| Value | Behavior |
|-------|----------|
| `auto` (default) | Use Playwright if available, fall back to canvas |
| `always` | Require Playwright, fail if browsers not installed |
| `none` | Skip Playwright, always use canvas rendering |

### Offline OCR

Download `*.traineddata.gz` files to `tessdata/`.

## License

Apache-2.0

**Note:** Spreadsheet fixture generation uses [ExcelJS](https://github.com/exceljs/exceljs) (MIT licensed).
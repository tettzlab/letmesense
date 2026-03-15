# letmesense — How It Works

## The Big Picture

letmesense is a **universal document reader**. You throw any document at it — PDF, Word, PowerPoint, Excel, images, HTML — and it gives you clean text back. Optionally, it can use an LLM to make the output beautiful markdown, or even "see" the pages with vision models.

```
        ┌──────────────────────────────────────────────────┐
        │                   INPUTS                         │
        │   PDF  DOCX  PPTX  XLSX  PNG  JPG  HTML  URL    │
        └──────────────────┬───────────────────────────────┘
                           │
                    sense("report.pdf")
                           │
                           ▼
        ┌──────────────────────────────────────────────────┐
        │              FORMAT DETECTION                    │
        │   extension → MIME type → magic bytes → sniff    │
        │         "Ah, this is a PDF" → pdfPlugin          │
        └──────────────────┬───────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────────────────┐
        │          THE PIPELINE (6 stages)                 │
        │                                                  │
        │   Load → Parse → Analyze → Classify → Group → Extract
        │                                                  │
        └──────────────────┬───────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         Plain Text    LLM Format   Vision Mode
         (fast,free)   (AI cleanup)  (sees images)
              │            │            │
              └────────────┴────────────┘
                           │
                           ▼
                    "Here's your text"
```

---

## The Pipeline — What Happens to Your Document

Think of it like an **assembly line** where each document goes through 6 stations:

```
 ① LOAD          ② PARSE           ③ ANALYZE        ④ CLASSIFY
 ─────────       ─────────         ─────────        ─────────
 Read bytes      Split into        Inspect each     Label each
 from file,      "units" —         unit: how much   unit's nature
 URL, or         pages, slides,    text? what
 buffer          sheets            language?         text-only
                                   any images?       image-only
                                                     mixed
 "Got 2.1MB"     "20 pages"        "pg3: 850 chars   tabular
                                    English, 70%      empty
                                    image coverage"

 ⑤ GROUP RUNS                      ⑥ EXTRACT
 ─────────────                     ─────────
 Cluster consecutive units         Pull text from each run
 that look alike into "runs"       using the right strategy

 Run 1: pages 0-7  (text-only)    Run 1 → PDF.js digital text
 Run 2: pages 8-15 (scanned)      Run 2 → OCR via Tesseract
 Run 3: pages 16-19 (empty)       Run 3 → skip
```

**Why runs?** A 50-page PDF might have 40 digital pages and 10 scanned pages. Instead of checking each page individually, the pipeline groups them — digital pages get fast text extraction, scanned pages get OCR. Runs are consecutive pages with the same (kind + language + paper size).

---

## The Plugin System — One Interface, Many Formats

Each format has a plugin that speaks the same language:

```
         FormatPlugin interface
         ┌─────────────────────────────────┐
         │  load()        → raw bytes      │
         │  parse()       → units          │
         │  analyzeUnit() → stats          │
         │  classifyUnit()→ content kind   │
         │  extractUnit() → text           │
         │  renderUnit()  → image (opt)    │
         └─────────────────────────────────┘
                    │
      ┌─────────┬──┴──────┬──────────┬──────────┐
      ▼         ▼         ▼          ▼          ▼
   pdfPlugin  officePlugin  imagePlugin  webPlugin
   ─────────  ────────────  ───────────  ─────────
   PDF.js     officeparser  sharp        readability
   Tesseract  LibreOffice   (single      + turndown
   canvas     (DOCX/PPTX/   unit per    (HTML→md)
   rendering   XLSX/OD*)     image)
```

Plugins auto-register on import — just `import 'lib/formats/pdf/index.js'` and the registry knows about PDFs. Detection cascades: extension → MIME → magic bytes.

---

## Three Extraction Modes

```
 ┌─────────────────────────────────────────────────────────────┐
 │                                                             │
 │  MODE 1: Plain Text (default)                               │
 │  ────────────────────────────                               │
 │  sense("doc.pdf")                                           │
 │  → Fast, free, no API keys needed                           │
 │  → Digital text via PDF.js, scanned via Tesseract OCR       │
 │  → Returns: concatenated text string                        │
 │                                                             │
 │  MODE 2: LLM Formatting                                     │
 │  ──────────────────────                                     │
 │  sense("doc.pdf", { llm: { model: "openai:gpt-4o" } })     │
 │  → Extracts text first, then sends each unit to LLM         │
 │  → LLM cleans up formatting → nice markdown                 │
 │  → Returns: formatted text + token usage + cost             │
 │                                                             │
 │  MODE 3: Vision                                             │
 │  ──────────────                                             │
 │  senseStream("slides.pptx", { vision: "anthropic:sonnet" }) │
 │  → Renders each page to an image                            │
 │  → Sends image + text to multimodal LLM                     │
 │  → LLM "reads" the visual layout                            │
 │  → Streams results as they arrive                           │
 │                                                             │
 └─────────────────────────────────────────────────────────────┘
```

---

## The AI Layer

```
  Model spec:  "provider:alias[:effort]"
               "openai:mini"  "anthropic:sonnet:high"

  ┌──────────────────────────────────────────────┐
  │              Model Registry                  │
  │  models.json — pricing, context windows,     │
  │  aliases, capabilities, token encodings      │
  └──────────┬───────────────────────────────────┘
             │
  ┌──────────▼───────────────────────────────────┐
  │         Provider Resolution                  │
  │  env vars → auto-detect available providers  │
  │  OPENAI_API_KEY    → openai                  │
  │  ANTHROPIC_API_KEY → anthropic               │
  │  GOOGLE_..._KEY    → google                  │
  │  OLLAMA_HOST       → ollama                  │
  └──────────┬───────────────────────────────────┘
             │
  ┌──────────▼───────────────────────────────────┐
  │     Vercel AI SDK adapters                   │
  │  generateText() / streamText()               │
  │  + exponential backoff retry                 │
  │  + token counting (per-encoding tokenizers)  │
  │  + cost calculation from pricing tables      │
  │  + journaling (log every LLM call)           │
  └──────────────────────────────────────────────┘
```

Every LLM call is tracked: tokens in/out, cost, latency, prompt used. The **journal** captures this for debugging and experiment tracking.

---

## PDF Deep Dive — The Trickiest Format

PDFs are the most complex because pages can be any mix of digital text, scanned images, or both:

```
  Page Analysis
  ─────────────
  For each page, measure:
  • charCount (how much digital text?)
  • maxImageCoverageRatio (how much is raster image?)
  • language (CJK detection matters for rendering)

  Classification Thresholds
  ─────────────────────────
  charCount ≥ 20  AND  imageCoverage < 10%  → born-digital  (fast extract)
  charCount < 20  AND  imageCoverage ≥ 60%  → scanned       (needs OCR)
  charCount ≥ 20  AND  imageCoverage ≥ 10%  → mixed         (try both)
  nothing                                    → empty         (skip)

  Rendering (for vision/OCR)
  ──────────────────────────
  canvas (@napi-rs/canvas) ──── fast, default
  playwright ─────────────── CJK font support, auto-detected
```

---

## The Condense Engine — Shrinking Long Documents

A separate system for **map-reduce summarization** when documents are too long:

```
  Input: 50,000 words of text
  Target: 5,000 words (ratio: 0.1)

  MAP PHASE                          REDUCE PHASE
  ─────────                          ────────────
  ┌─────────┐
  │ Chunk 1 │──→ LLM → Summary 1 ─┐
  │ Chunk 2 │──→ LLM → Summary 2 ──┤  If still too long:
  │ Chunk 3 │──→ LLM → Summary 3 ──┼──→ Re-chunk summaries
  │ Chunk 4 │──→ LLM → Summary 4 ──┤    → LLM → merged summary
  │ Chunk 5 │──→ LLM → Summary 5 ─┘    → Repeat until target met
  └─────────┘                             (max 10 recursions by default)
  (parallel)

  Chunking is markdown-aware: respects headers, code blocks, lists
  Chunks overlap ~200 tokens so context isn't lost at boundaries
```

---

## Observability — Everything is Instrumented

```
  Every pipeline stage emits:
  ┌─────────────────────────────────────────┐
  │  Traces (spans)     "pipeline.extract"  │──→ Grafana / Jaeger
  │  Metrics (counters) "pdf.load.bytes"    │──→ Prometheus
  │  Logs (structured)  pino JSON           │──→ stdout / Loki
  │  Progress events    onProgress callback │──→ CLI progress bar
  └─────────────────────────────────────────┘

  Local dev: pnpm otel:up → Docker Grafana LGTM stack
  Each module owns its signal names in signals.ts
```

---

## Two CLIs

```
  letmesense report.pdf                       # plain text extraction
  letmesense report.pdf --llm -m openai:gpt-4o  # with LLM formatting
  letmesense report.pdf --vision -m anthropic:sonnet # vision mode, streaming

  letmedense report.pdf --model openai:mini --ratio 0.2
                                              # condense to 20% size
```

---

## In One Sentence

**letmesense detects your document format, splits it into units (pages/slides/sheets), classifies each unit's content type, groups similar consecutive units into runs, extracts text using the right strategy (digital/OCR/vision), and optionally polishes the output with an LLM — all while tracking every token, dollar, and millisecond.**

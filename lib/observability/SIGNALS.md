# Signal Naming Conventions

How to name and organize spans, metrics, and span attributes across projects that share the observability module.

## Architecture

```
lib/observability/types.ts      → SemanticAttributes (cross-cutting span attribute keys)
lib/<module>/signals.ts         → Spans, Metrics (module-owned signal names)
```

The observability module (`lib/observability/`) is a **shared SDK**. It exports interfaces, config types, boundary constants, and `SemanticAttributes`. It does **not** contain domain-specific span or metric names.

Each domain module owns its signal names in a co-located `signals.ts` file that exports two `as const` objects:

```ts
// lib/condense/signals.ts
export const Spans = {
  RUN: 'condense.run',
  MAP: 'condense.map',
} as const

export const Metrics = {
  RUN_COUNT: 'condense.run.count',
  RUN_DURATION_MS: 'condense.run.duration_ms',
} as const
```

- `Spans` — operation names passed to `tracer.startSpan()`
- `Metrics` — instrument names passed to `metrics.counter()` / `.histogram()` / `.gauge()`

## Value Format

All values use **dotted lowercase** notation, following [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/).

No camelCase segments. Multi-word concepts are dot-separated:

```
loadDocument   → load.document
extractRuns    → extract.runs
convertToPdf   → convert.to.pdf
```

### Spans

Pattern: `<domain>.<operation>`

```
pipeline.extract
pdf.render.page
office.libreoffice.convert
condense.map
```

### Metrics

Pattern: `<domain>.<noun>.<type_suffix>`

```
pipeline.extraction.count
ai.request.duration_ms
pdf.render.bytes
ocr.confidence.score
```

### Span Attributes

Pattern: `<noun>` or `<noun>.<qualifier>` (no domain prefix — context comes from the span)

```
model
input.tokens
cost.total.usd
```

## Metric Key Suffixes

Constant names carry a type suffix indicating the instrument kind and unit. The same suffix appears in the string value.

| Suffix | Instrument | Example |
|---|---|---|
| `_COUNT` | counter | `EXTRACTION_COUNT → 'pipeline.extraction.count'` |
| `_DURATION_MS` | histogram | `RUN_DURATION_MS → 'condense.run.duration_ms'` |
| `_BYTES` | histogram | `RENDER_BYTES → 'pdf.render.bytes'` |
| `_CHARS` | histogram | `EXTRACTION_CHARS → 'pipeline.extraction.chars'` |
| `_SCORE` | histogram | `CONFIDENCE_SCORE → 'ocr.confidence.score'` |
| `_USD` | histogram | `COST_USD → 'ai.cost.usd'` |

Gauges have no suffix convention: `REDUCE_DEPTH → 'condense.reduce.depth'`.

## Namespace Ownership

Each module owns a dotted prefix. All span and metric values must stay within their module's namespace.

| Module | Prefix |
|---|---|
| `lib/pipeline/` | `pipeline.*` |
| `lib/ai/` | `ai.*` |
| `lib/condense/` | `condense.*` |
| `lib/pdf/` | `pdf.*` |
| `lib/office/` | `office.*` |
| `lib/ocr/` | `ocr.*` |
| `lib/formats/pdf/` | `pdf.plugin.*` |
| `lib/formats/office/` | `office.plugin.*` |
| `lib/formats/image/` | `image.plugin.*` |
| `lib/formats/web/` | `web.plugin.*` |
| `cli/` | `cli.*` |

## SemanticAttributes

`SemanticAttributes` in `types.ts` holds **cross-cutting span attribute keys** that appear in 2+ modules. Module-local attributes (e.g. `'pageNumber'`, `'hasAlpha'`, `'renderer'`) stay as inline strings at the call site.

Promote an inline string to `SemanticAttributes` when it appears in 2+ modules. Remove it if usage drops back to 1.

### Collision avoidance

Span attribute values must **not** collide with metric instrument names. If a metric is `'condense.reduce.depth'`, the span attribute for the same concept should use a shorter key (e.g. `'reduce.depth'`). Attributes are unscoped short names; metrics are namespaced.

## Adding New Signals

| What | Where |
|---|---|
| Module-local span or metric | `lib/<module>/signals.ts` |
| Span attribute used in 1 module | inline string at call site |
| Span attribute used in 2+ modules | `SemanticAttributes` in `types.ts` |
| New module | create `signals.ts`, pick a unique namespace prefix |

## Testing

When mocking `'../observability/index.js'` in tests, also mock `'./signals.js'` for the module's `Spans` and `Metrics`. Mock values must match the actual `signals.ts` definitions.

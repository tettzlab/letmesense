/**
 * Plugin interface for the unified extraction pipeline.
 * Format-specific implementations provide these methods.
 */

import type {
  ContentKind,
  DocumentInput,
  DocumentRun,
  DocumentUnit,
  FormatId,
  UnitExtractionResult,
} from './types.js'

// ============================================================================
// Plugin Capabilities
// ============================================================================

/**
 * Declares what features a plugin supports.
 * Used by processor to determine available strategies.
 */
export interface PluginCapabilities {
  /** Supports OCR extraction */
  ocr: boolean

  /** Supports vision-based extraction (LLM) */
  vision: boolean

  /** Supports streaming extraction */
  streaming: boolean

  /** Supports parallel unit extraction */
  parallel: boolean

  /** Supports run-based grouping (vs unit-per-run) */
  supportsRuns: boolean

  /** Document has multiple units (pages/slides/sheets) */
  multiUnit: boolean
}

// ============================================================================
// Loaded Document
// ============================================================================

/**
 * Result of loading a document. Opaque to the processor.
 * Plugin controls internal structure.
 */
export interface LoadedDocument {
  /** Raw document bytes */
  bytes: Uint8Array

  /** Detected or specified format */
  format: FormatId
}

// ============================================================================
// Parsed Document
// ============================================================================

/**
 * Result of parsing a document into units.
 *
 * @template U - Unit type (extends DocumentUnit)
 */
export interface ParsedDocument<U extends DocumentUnit = DocumentUnit> {
  /** Extracted document units */
  units: U[]

  /** Optional document metadata */
  metadata?: Record<string, unknown>
}

// ============================================================================
// Rendered Content
// ============================================================================

/**
 * Result of rendering a unit to an image.
 * Used for OCR and vision extraction.
 */
export interface RenderedContent {
  /** Base64-encoded image data */
  base64: string

  /** MIME type of the image */
  mimeType: 'image/png' | 'image/jpeg'

  /** Image width in pixels */
  width: number

  /** Image height in pixels */
  height: number
}

/**
 * Options for rendering a unit to an image.
 */
export interface RenderOptions {
  /** Render scale (higher = better quality, more memory) */
  scale?: number

  /**
   * Playwright rendering mode.
   * - 'always': Always use Playwright
   * - 'auto': Auto-detect CJK (default)
   * - 'none': Never use Playwright
   */
  usePlaywright?: 'always' | 'auto' | 'none'

  /** Text content for CJK detection (passed from extractUnit in vision mode) */
  textForCjkDetection?: string

  /** Additional format-specific options */
  [key: string]: unknown
}

// ============================================================================
// CLI Option
// ============================================================================

/**
 * Defines a CLI option that a plugin can expose.
 */
export interface CliOption {
  /** CLI flags: "-r, --range <range>" */
  flags: string

  /** Description shown in help */
  description: string

  /** Default value (if any) */
  defaultValue?: string | boolean | number
}

// ============================================================================
// Plugin Interface
// ============================================================================

/**
 * Plugin interface for format-specific extraction.
 * Plugins implement this interface to support a document format.
 *
 * @template TUnit - Unit type (extends DocumentUnit)
 * @template TOptions - Plugin-specific options
 */
export interface FormatPlugin<
  TUnit extends DocumentUnit = DocumentUnit,
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> {
  // -------------------- Identity --------------------

  /** Unique plugin identifier (matches FormatId) */
  id: FormatId

  /** Human-readable plugin name */
  name: string

  /** File extensions this plugin handles: ['.pdf', '.PDF'] */
  extensions: string[]

  /** MIME types this plugin handles */
  mimeTypes: string[]

  /** Plugin capabilities */
  capabilities: PluginCapabilities

  // -------------------- Lifecycle --------------------

  /**
   * Load a document from input.
   * Handles file paths, URLs, buffers, and stdin.
   */
  load(input: DocumentInput, options?: TOptions): Promise<LoadedDocument>

  /**
   * Parse a loaded document into units.
   * Returns units with minimal analysis (index, label, kind=unknown).
   */
  parse(doc: LoadedDocument, options?: TOptions): Promise<ParsedDocument<TUnit>>

  /**
   * Analyze a single unit to determine content characteristics.
   * Populates kind, charCount, language, textSample.
   */
  analyzeUnit(unit: TUnit, doc: LoadedDocument, options?: TOptions): Promise<TUnit>

  /**
   * Classify a unit's content kind based on analysis.
   * Called after analyzeUnit to determine final classification.
   */
  classifyUnit(unit: TUnit): ContentKind

  /**
   * Extract text from a single unit.
   * Returns extracted text with provenance information.
   */
  extractUnit(unit: TUnit, doc: LoadedDocument, options?: TOptions): Promise<UnitExtractionResult>

  // -------------------- Optional --------------------

  /**
   * Build a run key for grouping consecutive units.
   * Returns null if runs are not supported or unit should be its own run.
   *
   * Default: `${kind}|${language}`
   */
  buildRunKey?(unit: TUnit): string | null

  /**
   * Render a unit to an image for OCR or vision.
   * Required if capabilities.ocr or capabilities.vision is true.
   */
  renderUnit?(unit: TUnit, doc: LoadedDocument, options?: RenderOptions): Promise<RenderedContent>

  /**
   * Clean up resources after processing.
   * Called in finally block after extraction completes.
   */
  cleanup?(doc: LoadedDocument): Promise<void>

  /**
   * Get CLI options specific to this plugin.
   * Used by CLI to build format-specific flags.
   */
  getCliOptions?(): CliOption[]
}

// ============================================================================
// Plugin Utilities
// ============================================================================

/**
 * Default run key builder: groups by kind and language.
 */
export function defaultBuildRunKey(unit: DocumentUnit): string {
  return `${unit.kind}|${unit.language}`
}

/**
 * Build runs from units using a key function.
 * Groups consecutive units with the same key.
 */
export function buildRuns<U extends DocumentUnit>(
  units: U[],
  buildKey: (unit: U) => string | null = defaultBuildRunKey,
): DocumentRun<U>[] {
  const runs: DocumentRun<U>[] = []

  for (const unit of units) {
    const key = buildKey(unit)

    // If key is null, each unit is its own run
    if (key === null) {
      runs.push({
        key: `unit-${unit.index}`,
        kind: unit.kind,
        language: unit.language,
        unitIndices: [unit.index],
        units: [unit],
      })
      continue
    }

    const lastRun = runs[runs.length - 1]

    // Start new run if key differs
    if (!lastRun || lastRun.key !== key) {
      runs.push({
        key,
        kind: unit.kind,
        language: unit.language,
        unitIndices: [unit.index],
        units: [unit],
      })
    } else {
      // Extend existing run
      lastRun.unitIndices.push(unit.index)
      lastRun.units?.push(unit)
    }
  }

  return runs
}

/**
 * Type guard to check if a plugin supports rendering.
 */
export function canRender<U extends DocumentUnit, O extends Record<string, unknown>>(
  plugin: FormatPlugin<U, O>,
): plugin is FormatPlugin<U, O> & { renderUnit: NonNullable<FormatPlugin<U, O>['renderUnit']> } {
  return typeof plugin.renderUnit === 'function'
}

/**
 * Type guard to check if a plugin supports OCR.
 */
export function supportsOcr<U extends DocumentUnit, O extends Record<string, unknown>>(
  plugin: FormatPlugin<U, O>,
): boolean {
  return plugin.capabilities.ocr && canRender(plugin)
}

/**
 * Type guard to check if a plugin supports vision.
 */
export function supportsVision<U extends DocumentUnit, O extends Record<string, unknown>>(
  plugin: FormatPlugin<U, O>,
): boolean {
  return plugin.capabilities.vision && canRender(plugin)
}

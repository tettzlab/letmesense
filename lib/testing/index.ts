/**
 * Shared test helpers — reusable factories for unit tests.
 *
 * Usage:
 *   import { createUnit, createMockPlugin, mockObs, useTmpDir } from '../testing/index.js'
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { SemanticAttributes } from '../observability/types.js'
import type { FormatPlugin, LoadedDocument, ParsedDocument } from '../pipeline/plugin.js'
import type { ContentKind, DocumentUnit, FormatId } from '../pipeline/types.js'
import { createPathResolver } from '../utils/path.js'

// ─── Document Unit Factory ───────────────────────────────────────────────────

export function createUnit(index: number, kind?: ContentKind, language?: string): DocumentUnit
export function createUnit(overrides: Partial<DocumentUnit>): DocumentUnit
export function createUnit(
  indexOrOverrides: number | Partial<DocumentUnit>,
  kind: ContentKind = 'text-only',
  language = 'eng',
): DocumentUnit {
  if (typeof indexOrOverrides === 'number') {
    return {
      index: indexOrOverrides,
      label: `Unit ${indexOrOverrides}`,
      kind,
      charCount: 100,
      language,
      textSample: 'Sample text',
    }
  }
  return {
    index: 0,
    label: 'Page 1',
    kind: 'text-only',
    charCount: 100,
    language: 'eng',
    textSample: 'Sample text',
    ...indexOrOverrides,
  }
}

// ─── Mock Plugin Factory ─────────────────────────────────────────────────────

export function createMockPlugin(overrides: Partial<FormatPlugin> = {}): FormatPlugin {
  return {
    id: 'pdf' as FormatId,
    name: 'Mock Plugin',
    extensions: ['.mock'],
    mimeTypes: ['application/mock'],
    capabilities: {
      ocr: false,
      vision: false,
      streaming: false,
      parallel: true,
      supportsRuns: true,
      multiUnit: true,
    },
    load: vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      format: 'pdf',
    } as LoadedDocument),
    parse: vi.fn().mockResolvedValue({
      units: [createUnit(0), createUnit(1), createUnit(2)],
      metadata: { title: 'Test Document' },
    } as ParsedDocument),
    analyzeUnit: vi.fn().mockImplementation((unit) => Promise.resolve(unit)),
    classifyUnit: vi.fn().mockReturnValue('text-only' as ContentKind),
    extractUnit: vi.fn().mockResolvedValue({
      text: 'Extracted text',
      charCount: 14,
      extraction: { method: 'digital', reliability: 'exact' },
    }),
    buildRunKey: vi
      .fn()
      .mockImplementation((unit: DocumentUnit) => `${unit.kind}|${unit.language}`),
    ...overrides,
  }
}

// ─── Observability Mock ──────────────────────────────────────────────────────

/**
 * Returns a vi.mock factory for `../observability/index.js`.
 *
 * Usage in test files:
 *   vi.mock('../observability/index.js', () => mockObs())
 *   vi.mock('./signals.js', () => mockSignals({ Spans: {...}, Metrics: {...} }))
 */
export function mockObs(extra: Record<string, unknown> = {}) {
  const startSpan = vi.fn(async (...args: unknown[]) => {
    const fn = args[args.length - 1] as (span: unknown) => unknown
    return fn({
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setError: vi.fn(),
      recordException: vi.fn(),
      addEvent: vi.fn(),
      end: vi.fn(),
    })
  })
  return {
    obs: vi.fn(() => ({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      tracer: { startSpan },
      metrics: {
        counter: vi.fn(() => ({ add: vi.fn() })),
        histogram: vi.fn(() => ({ record: vi.fn() })),
        gauge: vi.fn(() => ({ set: vi.fn(), get: vi.fn() })),
      },
    })),
    SemanticAttributes,
    classifyError: () => ({ category: 'unknown', retryable: false }),
    getErrorSpanAttributes: () => ({}),
    // Audit stubs — always included so agent tests don't need to list them
    auditContextCompacted: vi.fn(),
    auditInterruptReceived: vi.fn(),
    auditLlmError: vi.fn(),
    auditLlmRequest: vi.fn(),
    auditLlmResponse: vi.fn(),
    auditRunEnded: vi.fn(),
    auditRunStarted: vi.fn(),
    auditSessionEnded: vi.fn(),
    auditSessionStarted: vi.fn(),
    auditToolApproved: vi.fn(),
    auditToolCached: vi.fn(),
    auditToolCalled: vi.fn(),
    auditToolDenied: vi.fn(),
    auditToolFailed: vi.fn(),
    auditToolSucceeded: vi.fn(),
    ...extra,
  }
}

/** Convenience for mocking a module's `./signals.js` */
export function mockSignals(signals: {
  Spans?: Record<string, string>
  Metrics?: Record<string, string>
}) {
  return {
    Spans: signals.Spans ?? {},
    Metrics: signals.Metrics ?? {},
  }
}

// ─── Temporary Directory Helper ──────────────────────────────────────────────

export interface TmpDir {
  /** Absolute path to the temporary directory. Available after setup runs. */
  get path(): string
  /** Resolve a relative path inside the tmpDir (workspace-safe). */
  get resolve(): (p: string) => string
}

/**
 * Creates a temporary directory for tests, cleaned up automatically.
 *
 * @param prefix - Prefix for the temp directory name (default: 'test-')
 * @param scope - Lifecycle scope: 'each' uses beforeEach/afterEach, 'all' uses beforeAll/afterAll
 */
export function useTmpDir(prefix = 'test-', scope: 'each' | 'all' = 'each'): TmpDir {
  let dir = ''
  let resolver: (p: string) => string = () => {
    throw new Error(
      'useTmpDir.resolve accessed before setup — call useTmpDir() inside a describe block so beforeEach/beforeAll can run first',
    )
  }

  const setup = async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    resolver = createPathResolver(dir)
  }
  const teardown = async () => {
    await fs.rm(dir, { recursive: true, force: true })
  }

  if (scope === 'all') {
    beforeAll(setup)
    afterAll(teardown)
  } else {
    beforeEach(setup)
    afterEach(teardown)
  }

  return {
    get path() {
      return dir
    },
    get resolve() {
      return resolver
    },
  }
}

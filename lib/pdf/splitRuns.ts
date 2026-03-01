import { obs } from '../observability/index.js'
import { SemanticAttributes } from '../observability/types.js'
import { throwIfAborted } from '../pipeline/errors.js'
import { analyzePage } from './analyzePage.js'
import { loadPdfDocumentFromBytes } from './pdfjs.js'
import { cleanupPdfDocument } from './pdfjsTypes.js'
import { Spans } from './signals.js'
import type { PageAttributes, ProgressCallbacks, SplitPdfOptions, SplitRun } from './types.js'

export interface SplitRunsOptions extends SplitPdfOptions {
  /** Progress callbacks */
  progress?: ProgressCallbacks
}

/**
 * Split a PDF into homogeneous runs (consecutive pages with same attributes).
 * Each run contains pages with identical kind, paper size, orientation, and language.
 */
export async function splitIntoRuns(
  pdfBytes: Uint8Array,
  options: SplitRunsOptions = {},
): Promise<{ runs: SplitRun[]; pages: PageAttributes[] }> {
  const { tracer } = obs('pdf')

  return tracer.startSpan(Spans.SPLIT, async (span) => {
    const includePdfBytes = options.includePdfBytes ?? true
    const { progress } = options

    // Copy bytes because pdfjs detaches the underlying ArrayBuffer
    const pdf = await loadPdfDocumentFromBytes(new Uint8Array(pdfBytes))
    span.setAttribute(SemanticAttributes.PAGE_COUNT, pdf.numPages)

    // Analyze pages with pdfjs, then clean up BEFORE loading pdf-lib
    // This reduces peak memory by not holding both documents simultaneously
    let pages: PageAttributes[]
    try {
      pages = []
      for (let i = 0; i < pdf.numPages; i++) {
        throwIfAborted(options.signal, 'split')
        try {
          const page = await pdf.getPage(i + 1)
          pages.push(await analyzePage(page, i, options))
          progress?.onPageAnalyzed?.(i, pdf.numPages)
        } catch (err) {
          // Graceful degradation: mark failed page as 'unknown' with error info.
          // Error stored in page.error field (not logged to console).
          // Use unique paperKey per failed page to prevent incorrect grouping.
          pages.push({
            pageIndex: i,
            kind: 'unknown',
            rotationDeg: 0,
            widthPt: 0,
            heightPt: 0,
            paperKey: `failed-${i}`,
            orientation: 'portrait',
            charCount: 0,
            textSample: '',
            imageOpCount: 0,
            language: 'und',
            error: {
              unitIndex: i,
              phase: 'analyze',
              message: err instanceof Error ? err.message : String(err),
              cause: err instanceof Error ? err : undefined,
            },
          })
          progress?.onPageAnalyzed?.(i, pdf.numPages)
        }
      }
    } finally {
      await cleanupPdfDocument(pdf)
    }

    // Build runs from analyzed pages
    const runs: SplitRun[] = []
    for (const p of pages) {
      const attrs = {
        kind: p.kind,
        paperKey: p.paperKey,
        orientation: p.orientation,
        language: p.language,
      }
      const key = `${attrs.kind}|${attrs.paperKey}|${attrs.orientation}|${attrs.language}`
      const last = runs[runs.length - 1]

      if (!last || last.key !== key) {
        runs.push({ key, attrs, pageIndices: [p.pageIndex] })
      } else {
        last.pageIndices.push(p.pageIndex)
      }
    }

    span.setAttribute(SemanticAttributes.RUN_COUNT, runs.length)

    // Extract PDF bytes for each run using pdf-lib (pdfjs already cleaned up)
    // Dynamic import to defer loading pdf-lib until needed
    if (includePdfBytes) {
      const { PDFDocument } = await import('pdf-lib')
      const src = await PDFDocument.load(pdfBytes)
      for (const run of runs) {
        const out = await PDFDocument.create()
        const copied = await out.copyPages(src, run.pageIndices)
        for (const p of copied) out.addPage(p)
        run.pdfBytes = await out.save()
      }
    }

    return { runs, pages }
  })
}

import { createRequire } from 'node:module'
import path from 'node:path'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import { obs } from '../observability/index.js'
import { SemanticMetrics, SpanNames } from '../observability/types.js'
import type { PdfjsDocumentInitParameters } from './pdfjsTypes.js'

export { pdfjsLib }

// Re-export types for use in other modules
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

function resolvePdfjsAssetDir(exampleFile: string): string {
  const require = createRequire(import.meta.url)
  const filePath = require.resolve(exampleFile)
  return path.dirname(filePath)
}

export function getStandardFontDataUrl(): string {
  // Resolve a known font file inside pdfjs-dist and return its parent directory.
  // Return as file path (not file:// URL) because pdfjs-dist's node_utils_fetchData
  // passes the URL directly to fs.promises.readFile which expects paths.
  const dir = resolvePdfjsAssetDir('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf')
  // Ensure trailing slash so PDF.js can append file names.
  return dir + path.sep
}

export function getCMapUrl(): string {
  // Some PDFs require CMaps for CID fonts.
  // Return as file path (not file:// URL) because pdfjs-dist's node_utils_fetchData
  // passes the URL directly to fs.promises.readFile which expects paths.
  const dir = resolvePdfjsAssetDir('pdfjs-dist/cmaps/Adobe-Japan1-UCS2.bcmap')
  return dir + path.sep
}

export async function loadPdfDocumentFromBytes(pdfBytes: Uint8Array) {
  const { tracer, metrics, logger } = obs('pdf.pdfjs')

  return tracer.startSpan(SpanNames.PDF_LOAD_DOCUMENT, async (span) => {
    span.setAttribute('bytes', pdfBytes.length)

    const params: PdfjsDocumentInitParameters = {
      data: pdfBytes,
      disableWorker: true,
      // Avoid font warnings / missing font data in Node
      standardFontDataUrl: getStandardFontDataUrl(),
      cMapUrl: getCMapUrl(),
      cMapPacked: true,
    }
    // biome-ignore lint/suspicious/noExplicitAny: pdfjs-dist type definition incomplete
    const loadingTask = pdfjsLib.getDocument(params as any)
    const doc = await loadingTask.promise

    span.setAttribute('numPages', doc.numPages)
    metrics.counter(SemanticMetrics.PDF_DOCUMENTS_LOADED_COUNT).add(1)
    metrics.histogram(SemanticMetrics.PDF_DOCUMENT_BYTES).record(pdfBytes.length)
    logger.debug({ bytes: pdfBytes.length, numPages: doc.numPages }, 'PDF document loaded')

    return doc
  })
}

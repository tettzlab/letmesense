import { createRequire } from 'node:module'
import path from 'node:path'

import { obs } from '../observability/index.js'
import { SemanticAttributes } from '../observability/types.js'
import type { PdfjsDocumentInitParameters } from './pdfjsTypes.js'
import { Metrics, Spans } from './signals.js'

// Re-export types for use in other modules
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

/**
 * Lazy-loaded pdfjs-dist module.
 *
 * pdfjs-dist requires globalThis.Path2D to be set before it loads for proper
 * canvas rendering in Node.js. We use dynamic import to ensure @napi-rs/canvas
 * Path2D is available before pdfjs-dist initializes.
 */
let pdfjsLibPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null

async function getPdfjsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      // Set up Path2D from @napi-rs/canvas before pdfjs-dist loads.
      // pdfjs-dist checks globalThis.Path2D during initialization and uses it
      // for font rendering via ctx.fill(path). Without this, rendering fails with:
      // "Error: Value is none of these types `String`, `Path`"
      if (!globalThis.Path2D) {
        const canvas = await import('@napi-rs/canvas')
        // Use type assertion - @napi-rs/canvas Path2D is compatible at runtime
        // but has additional methods that the standard Path2D type doesn't include
        globalThis.Path2D = canvas.Path2D as unknown as typeof globalThis.Path2D
      }

      // Now safe to import pdfjs-dist
      return import('pdfjs-dist/legacy/build/pdf.mjs')
    })().catch((err) => {
      // Reset so subsequent calls can retry instead of caching a rejected promise
      pdfjsLibPromise = null
      throw err
    })
  }
  return pdfjsLibPromise
}

/**
 * Get the lazily-loaded pdfjs-dist library.
 * Ensures Path2D polyfill is available before returning.
 */
export { getPdfjsLib }

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

export function getWasmUrl(): string {
  // JPEG2000 (JPX) images require OpenJPEG WASM for decoding.
  const dir = resolvePdfjsAssetDir('pdfjs-dist/wasm/openjpeg.wasm')
  return dir + path.sep
}

export async function loadPdfDocumentFromBytes(pdfBytes: Uint8Array) {
  const { tracer, metrics, logger } = obs('pdf.pdfjs')

  return tracer.startSpan(Spans.LOAD_DOCUMENT, async (span) => {
    span.setAttribute(SemanticAttributes.BYTES, pdfBytes.length)

    // Get lazily-initialized pdfjs with Path2D polyfill
    const pdfjs = await getPdfjsLib()

    const params: PdfjsDocumentInitParameters = {
      data: pdfBytes,
      disableWorker: true,
      // Avoid font warnings / missing font data in Node
      standardFontDataUrl: getStandardFontDataUrl(),
      cMapUrl: getCMapUrl(),
      cMapPacked: true,
      // JPEG2000 (JPX) image decoding via OpenJPEG WASM
      wasmUrl: getWasmUrl(),
    }
    // biome-ignore lint/suspicious/noExplicitAny: pdfjs-dist type definition incomplete
    const loadingTask = pdfjs.getDocument(params as any)
    const doc = await loadingTask.promise

    span.setAttribute('numPages', doc.numPages)
    metrics.counter(Metrics.DOCUMENT_LOAD_COUNT).add(1)
    metrics.histogram(Metrics.DOCUMENT_BYTES).record(pdfBytes.length)
    logger.debug({ bytes: pdfBytes.length, numPages: doc.numPages }, 'PDF document loaded')

    return doc
  })
}

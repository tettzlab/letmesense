/**
 * PDF format plugin for the unified extraction pipeline.
 *
 * @example
 * ```ts
 * import '../lib/formats/pdf'  // Registers the plugin
 *
 * import { extract } from '../lib/pipeline'
 *
 * const result = await extract('document.pdf')
 * console.log(result.text)
 * ```
 */

// Export OCR helper
export { ocrSinglePage, type SinglePageOcrOptions, type SinglePageOcrResult } from './ocr.js'
// Export plugin
export { pdfPlugin } from './plugin.js'
// Export types
export type { PdfExtractOptions, PdfLoadedDocument, PdfUnit } from './types.js'
export { mapContentKindToPageKind, mapPageKindToContentKind } from './types.js'

// ============================================================================
// Auto-registration
// ============================================================================

import { registerPlugin } from '../../pipeline/registry.js'
import { pdfPlugin } from './plugin.js'

// Register the PDF plugin with the default registry on import
registerPlugin(pdfPlugin)

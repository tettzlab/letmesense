/**
 * Office format plugin for the unified extraction pipeline.
 * Supports: DOCX, PPTX, XLSX, ODT, ODP, ODS
 *
 * @example
 * ```ts
 * import '../lib/formats/office'  // Registers the plugin
 *
 * import { extract } from '../lib/pipeline'
 *
 * const result = await extract('presentation.pptx')
 * console.log(result.text)
 * ```
 */

// Export plugin
export { officePlugin } from './plugin.js'
// Export types
export type { OfficeExtractOptions, OfficeLoadedDocument, OfficeUnit } from './types.js'
export { mapContentKindToOfficeKind, mapOfficeKindToContentKind } from './types.js'

// ============================================================================
// Auto-registration
// ============================================================================

import { registerPlugin } from '../../pipeline/registry.js'
import { officePlugin } from './plugin.js'

// Register the Office plugin with the default registry on import
registerPlugin(officePlugin)

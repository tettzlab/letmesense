/**
 * HTML/web format plugin for the unified extraction pipeline.
 * Supports: HTML, HTM, XHTML
 *
 * @example
 * ```ts
 * import '../lib/formats/web'  // Registers the plugin
 *
 * import { extract } from '../lib/pipeline'
 *
 * const result = await extract('page.html')
 * console.log(result.text)
 * ```
 */

// Export plugin
export { webPlugin } from './plugin.js'
// Export types
export type { HtmlElementCounts, WebExtractOptions, WebLoadedDocument, WebUnit } from './types.js'
export { classifyHtml } from './types.js'

// ============================================================================
// Auto-registration
// ============================================================================

import { registerPlugin } from '../../pipeline/registry.js'
import { webPlugin } from './plugin.js'

// Register the HTML plugin with the default registry on import
registerPlugin(webPlugin)

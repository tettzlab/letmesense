/**
 * Image format plugin for the unified extraction pipeline.
 * Supports: PNG, JPG, GIF, WEBP, SVG
 *
 * @example
 * ```ts
 * import '../lib/formats/image'  // Registers the plugin
 *
 * import { extract } from '../lib/pipeline'
 *
 * const result = await extract('photo.jpg')
 * console.log(result.metadata)
 * ```
 */

// Export plugin
export { imagePlugin } from './plugin.js'
// Export types
export type {
  ImageExtractOptions,
  ImageFormat,
  ImageLoadedDocument,
  ImageMetadata,
  ImageUnit,
} from './types.js'
export { classifyImage, detectImageFormat, getMimeType } from './types.js'

// ============================================================================
// Auto-registration
// ============================================================================

import { registerPlugin } from '../../pipeline/registry.js'
import { imagePlugin } from './plugin.js'

// Register the Image plugin with the default registry on import
registerPlugin(imagePlugin)

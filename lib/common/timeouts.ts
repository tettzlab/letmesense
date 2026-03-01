/**
 * Shared timeout constants for fetch and per-unit operations.
 *
 * Centralizes values previously duplicated across pdf, office, ocr, and image modules.
 */

/**
 * Default timeout for URL fetch operations in milliseconds.
 * 30 seconds allows for slow servers while preventing indefinite hangs.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 30000

/**
 * Default per-page/per-unit timeout for extraction/OCR operations in milliseconds.
 * 60 seconds allows for slow OCR on complex pages while preventing indefinite hangs.
 * Set to 0 to disable timeout.
 */
export const DEFAULT_PAGE_TIMEOUT_MS = 60000

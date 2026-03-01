/**
 * High-level library API for letmesense.
 *
 * This module re-exports the public API from api.ts.
 *
 * @example
 * ```ts
 * import { sense, senseStream, estimateCost } from 'letmesense/api'
 *
 * const result = await sense('document.pdf')
 * ```
 */

export * from './api.js'

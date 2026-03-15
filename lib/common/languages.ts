/**
 * Language code mappings and utilities
 */

import type { Lang } from './types.js'

/**
 * Map from ISO 639-3 codes (franc output) to Tesseract language codes.
 * Most codes are identical, but some differ (e.g., zho → chi_sim).
 */
export const ISO_TO_TESSERACT = {
  eng: 'eng',
  jpn: 'jpn',
  deu: 'deu',
  fra: 'fra',
  spa: 'spa',
  zho: 'chi_sim',
  kor: 'kor',
  por: 'por',
  ita: 'ita',
  rus: 'rus',
  ara: 'ara',
  hin: 'hin',
  nld: 'nld',
  pol: 'pol',
  vie: 'vie',
  tha: 'tha',
} as const

/** ISO 639-3 codes with Tesseract OCR support */
export type SupportedOcrLang = keyof typeof ISO_TO_TESSERACT

/** Tesseract language codes */
export type TesseractLang = (typeof ISO_TO_TESSERACT)[SupportedOcrLang]

/**
 * Check if a language code is supported by our Tesseract mapping.
 * Type guard that narrows Lang to SupportedOcrLang.
 */
export function isSupportedOcrLang(lang: Lang): lang is SupportedOcrLang {
  return lang != null && lang in ISO_TO_TESSERACT
}

/**
 * Convert ISO 639-3 language code to Tesseract language code.
 * Falls back to fallback (default 'eng') for unsupported languages.
 * Accepts any string as fallback to support custom Tesseract language codes.
 */
export function toTesseractLang<T extends string = TesseractLang>(
  lang: Lang,
  fallback: T = 'eng' as T,
): TesseractLang | T {
  return isSupportedOcrLang(lang) ? ISO_TO_TESSERACT[lang] : fallback
}

/**
 * Types for output formatters.
 */

import type { ExtractResult, OutputFormat } from '../types.js'

/** Cell value types for spreadsheet data */
export type CellValue = string | number | boolean | null | undefined

/** 2D array of cell values */
export type SheetData = CellValue[][]

/** Options for formatting output */
export interface FormatterOptions {
  /** Output format */
  format: OutputFormat

  /** For XLSX: treat first row as headers */
  headers?: boolean

  /** For JSON: pretty print with indentation */
  prettyPrint?: boolean

  /** For JSON: indentation spaces */
  indent?: number

  /** For CSV: field delimiter */
  delimiter?: string

  /** For CSV: line ending */
  lineEnding?: string

  /** For markdown: table alignment */
  alignment?: 'left' | 'center' | 'right'
}

/** A formatter converts extracted data to a specific output format */
export interface Formatter {
  /** Format name */
  name: OutputFormat

  /** Format extracted result to string */
  format(data: ExtractResult, options?: Partial<FormatterOptions>): string

  /** Format sheet data (for XLSX formatters) */
  formatSheet?(data: SheetData, options?: Partial<FormatterOptions>): string
}

/** Default formatter options */
export const DEFAULT_FORMATTER_OPTIONS: FormatterOptions = {
  format: 'text',
  headers: false,
  prettyPrint: true,
  indent: 2,
  delimiter: ',',
  lineEnding: '\n',
  alignment: 'left',
}

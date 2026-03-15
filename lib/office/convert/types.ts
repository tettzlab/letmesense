/**
 * Types for Office to PDF conversion.
 */

/** Supported conversion backends */
export type ConversionBackend = 'libreoffice' | 'unoserver'

/** Status of LibreOffice availability check */
export interface LibreOfficeStatus {
  available: boolean
  version?: string
  path?: string
  error?: string
}

/** Options for converting Office documents to PDF */
export interface ConvertOptions {
  /** Conversion backend to use */
  backend?: ConversionBackend

  /** Output directory for converted files */
  outputDir?: string

  /** Timeout in milliseconds */
  timeout?: number

  /** Keep temporary files for debugging */
  keepTemp?: boolean

  /** Number of retry attempts for transient OS-level failures (default: 2) */
  retries?: number
}

/** Options for the worker pool */
export interface PoolOptions {
  /** Number of parallel workers */
  poolSize?: number

  /** Timeout per conversion in milliseconds */
  timeout?: number

  /** Directory for worker profile directories */
  profileBaseDir?: string
}

/** Result of a conversion operation */
export interface ConversionResult {
  /** Input file path */
  inputPath: string

  /** Output PDF path */
  outputPath: string

  /** Time taken in milliseconds */
  duration: number

  /** Worker index (for pool operations) */
  workerIndex?: number
}

/** A queued conversion job */
export interface ConversionJob {
  /** Input file path */
  inputPath: string

  /** Resolve callback */
  resolve: (result: ConversionResult) => void

  /** Reject callback */
  reject: (error: Error) => void

  /** Job start time */
  startTime?: number
}

/** Pool statistics */
export interface PoolStats {
  /** Total jobs processed */
  totalJobs: number

  /** Currently active workers */
  activeWorkers: number

  /** Jobs waiting in queue */
  queueLength: number

  /** Average conversion time in ms */
  avgDuration: number

  /** Pool size */
  poolSize: number
}

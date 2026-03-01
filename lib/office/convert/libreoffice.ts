/**
 * LibreOffice headless conversion utilities.
 */

import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { DEFAULT_PAGE_TIMEOUT_MS } from '../../common/timeouts.js'
import { obs } from '../../observability/index.js'
import { OfficeConvertError } from '../errors.js'
import { Metrics, Spans } from '../signals.js'
import type { ConversionResult, ConvertOptions, LibreOfficeStatus } from './types.js'

/** Default conversion timeout */
const DEFAULT_TIMEOUT = DEFAULT_PAGE_TIMEOUT_MS

/**
 * Patterns for harmless LibreOffice warnings that can appear in stderr
 * without indicating an actual conversion failure.
 */
const HARMLESS_STDERR_PATTERNS = [/javaldx[^\n]*/g, /java may not function correctly[^\n]*/g]

/** Returns true when all non-zero-exit stderr content is known-harmless. */
function isHarmlessStderr(raw: string): boolean {
  return cleanStderr(raw) === ''
}

/** Strip known harmless warnings from stderr to surface real errors. */
function cleanStderr(raw: string): string {
  let cleaned = raw
  for (const pattern of HARMLESS_STDERR_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }
  return cleaned.trim()
}

/** Build environment for LibreOffice subprocess — disables Java (not needed for headless conversion). */
function libreOfficeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, SAL_DISABLE_JAVA: '1' }
}

/** LibreOffice executable names to search for */
const LIBREOFFICE_EXECUTABLES = [
  'libreoffice',
  'soffice',
  'libreoffice7.6',
  'libreoffice7.5',
  'libreoffice7.4',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice', // macOS
  '/usr/bin/libreoffice',
  '/usr/local/bin/libreoffice',
]

/**
 * Find the LibreOffice executable on the system.
 */
export function findLibreOffice(): string | null {
  const isWindows = process.platform === 'win32'

  for (const exe of LIBREOFFICE_EXECUTABLES) {
    try {
      if (isWindows) {
        execSync(`where ${exe}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      } else {
        execSync(`which ${exe}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      }
      return exe
    } catch {
      // Try direct path check for absolute paths
      if (exe.startsWith('/') && existsSync(exe)) {
        return exe
      }
    }
  }
  return null
}

/**
 * Check if LibreOffice is available on the system.
 */
export function checkLibreOffice(): LibreOfficeStatus {
  const exe = findLibreOffice()

  if (!exe) {
    return {
      available: false,
      error: 'LibreOffice not found. Install it for --vision mode support.',
    }
  }

  try {
    const output = execSync(`${exe} --version`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const versionMatch = output.match(/LibreOffice\s+([\d.]+)/)
    const version = versionMatch?.[1] ?? 'unknown'

    return {
      available: true,
      version,
      path: exe,
    }
  } catch (err) {
    return {
      available: false,
      path: exe,
      error: `Failed to get LibreOffice version: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Convert an Office document to PDF using LibreOffice.
 *
 * @param inputPath - Path to the Office document
 * @param options - Conversion options
 * @returns Conversion result with output path
 */
export async function convertToPdf(
  inputPath: string,
  options: ConvertOptions = {},
): Promise<ConversionResult> {
  const { tracer, metrics, logger } = obs('office.libreoffice')

  return tracer.startSpan(Spans.LIBREOFFICE_CONVERT, async (span) => {
    span.setAttribute('inputPath', inputPath)

    const startTime = Date.now()

    const { outputDir = tmpdir(), timeout = DEFAULT_TIMEOUT } = options
    span.setAttribute('timeout', timeout)

    // Check LibreOffice availability
    const status = checkLibreOffice()
    if (!status.available || !status.path) {
      throw new OfficeConvertError(status.error ?? 'LibreOffice not available')
    }
    const libreOfficePath = status.path
    span.setAttribute('libreOfficePath', libreOfficePath)

    // Ensure input exists
    if (!existsSync(inputPath)) {
      throw new OfficeConvertError(`Input file not found: ${inputPath}`)
    }

    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true })

    // Determine output filename
    const inputBasename = basename(inputPath)
    const outputBasename = inputBasename.replace(/\.[^.]+$/, '.pdf')
    const outputPath = join(outputDir, outputBasename)

    return new Promise((resolve, reject) => {
      const proc = spawn(
        libreOfficePath,
        [
          '--headless',
          '--invisible',
          '--nologo',
          '--nofirststartwizard',
          '--convert-to',
          'pdf',
          '--outdir',
          outputDir,
          inputPath,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: libreOfficeEnv(),
        },
      )

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data
      })
      proc.stderr.on('data', (data) => {
        stderr += data
      })

      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
        reject(new OfficeConvertError(`Conversion timed out after ${timeout}ms`))
      }, timeout)

      proc.on('close', (code) => {
        clearTimeout(timer)

        // Check file existence as primary success indicator.
        // LibreOffice may exit with non-zero code due to harmless warnings
        // (e.g., "failed to launch javaldx") while still producing valid output.
        // However, non-zero exit with real stderr errors likely means a partial/corrupt file.
        const stderrIsHarmless = code !== 0 ? isHarmlessStderr(stderr) : true

        if (existsSync(outputPath) && (code === 0 || stderrIsHarmless)) {
          if (code !== 0) {
            logger.debug(
              { inputPath, code, stderr: stderr.trim() },
              'LibreOffice exited with warnings but output file exists',
            )
          }
          const duration = Date.now() - startTime
          span.setAttribute('duration', duration)
          span.setAttribute('outputPath', outputPath)
          metrics.counter(Metrics.LIBREOFFICE_CONVERSION_COUNT).add(1, { status: 'success' })
          metrics.histogram(Metrics.LIBREOFFICE_DURATION_MS).record(duration)
          logger.debug({ inputPath, outputPath, duration }, 'LibreOffice conversion completed')

          resolve({
            inputPath,
            outputPath,
            duration,
          })
        } else {
          // Remove potentially corrupt partial output
          if (existsSync(outputPath)) {
            rm(outputPath, { force: true }).catch(() => {})
          }
          const cleaned = cleanStderr(stderr)
          const errorMsg = cleaned || stdout.trim() || `Exit code ${code}`
          metrics.counter(Metrics.LIBREOFFICE_CONVERSION_COUNT).add(1, { status: 'error' })
          reject(new OfficeConvertError(`LibreOffice conversion failed: ${errorMsg}`))
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        metrics.counter(Metrics.LIBREOFFICE_CONVERSION_COUNT).add(1, { status: 'error' })
        reject(new OfficeConvertError(`Failed to spawn LibreOffice: ${err.message}`))
      })
    })
  })
}

/**
 * Convert with an isolated user profile (for parallel execution).
 *
 * @param inputPath - Path to the Office document
 * @param profileDir - Path to the isolated profile directory
 * @param options - Conversion options
 * @returns Conversion result
 */
export async function convertWithProfile(
  inputPath: string,
  profileDir: string,
  options: ConvertOptions = {},
): Promise<ConversionResult> {
  const { tracer, metrics, logger } = obs('office.libreoffice')

  return tracer.startSpan(Spans.LIBREOFFICE_CONVERT_WITH_PROFILE, async (span) => {
    span.setAttribute('inputPath', inputPath)
    span.setAttribute('profileDir', profileDir)

    const startTime = Date.now()

    const { outputDir = tmpdir(), timeout = DEFAULT_TIMEOUT, keepTemp = false } = options

    const status = checkLibreOffice()
    if (!status.available || !status.path) {
      throw new OfficeConvertError(status.error ?? 'LibreOffice not available')
    }
    const libreOfficePath = status.path

    if (!existsSync(inputPath)) {
      throw new OfficeConvertError(`Input file not found: ${inputPath}`)
    }

    await mkdir(outputDir, { recursive: true })
    await mkdir(profileDir, { recursive: true })

    const inputBasename = basename(inputPath)
    const outputBasename = inputBasename.replace(/\.[^.]+$/, '.pdf')
    const outputPath = join(outputDir, outputBasename)

    return new Promise((resolve, reject) => {
      const proc = spawn(
        libreOfficePath,
        [
          '--headless',
          '--invisible',
          '--nologo',
          '--nofirststartwizard',
          `-env:UserInstallation=file://${profileDir}`,
          '--convert-to',
          'pdf',
          '--outdir',
          outputDir,
          inputPath,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: libreOfficeEnv(),
        },
      )

      let stderr = ''
      proc.stderr.on('data', (data) => {
        stderr += data
      })

      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
        reject(new OfficeConvertError(`Conversion timed out after ${timeout}ms`))
      }, timeout)

      proc.on('close', async (code) => {
        clearTimeout(timer)

        // Cleanup profile if not keeping temp files
        if (!keepTemp) {
          try {
            // Don't wait for cleanup, let it happen in background
            rm(profileDir, { recursive: true, force: true }).catch(() => {})
          } catch {
            // Ignore cleanup errors
          }
        }

        const stderrIsHarmless = code !== 0 ? isHarmlessStderr(stderr) : true

        if (existsSync(outputPath) && (code === 0 || stderrIsHarmless)) {
          if (code !== 0) {
            logger.debug(
              { inputPath, code, stderr: stderr.trim() },
              'LibreOffice exited with warnings but output file exists',
            )
          }
          const duration = Date.now() - startTime
          span.setAttribute('duration', duration)
          span.setAttribute('outputPath', outputPath)
          metrics
            .counter(Metrics.LIBREOFFICE_CONVERSION_PROFILE_COUNT)
            .add(1, { status: 'success' })
          metrics.histogram(Metrics.LIBREOFFICE_DURATION_MS).record(duration)
          logger.debug(
            { inputPath, outputPath, duration },
            'LibreOffice profile conversion completed',
          )

          resolve({
            inputPath,
            outputPath,
            duration,
          })
        } else {
          // Remove potentially corrupt partial output
          if (existsSync(outputPath)) {
            rm(outputPath, { force: true }).catch(() => {})
          }
          const cleaned = cleanStderr(stderr)
          const errorMsg = cleaned || `Exit code ${code}`
          metrics.counter(Metrics.LIBREOFFICE_CONVERSION_PROFILE_COUNT).add(1, { status: 'error' })
          reject(new OfficeConvertError(`LibreOffice conversion failed: ${errorMsg}`))
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        metrics.counter(Metrics.LIBREOFFICE_CONVERSION_PROFILE_COUNT).add(1, { status: 'error' })
        reject(new OfficeConvertError(`Failed to spawn LibreOffice: ${err.message}`))
      })
    })
  })
}

/**
 * Get installation instructions for LibreOffice.
 */
export function getInstallInstructions(): string {
  const platform = process.platform

  switch (platform) {
    case 'darwin':
      return `Install LibreOffice on macOS:
  brew install --cask libreoffice

Or download from: https://www.libreoffice.org/download/`

    case 'linux':
      return `Install LibreOffice on Linux:

Ubuntu/Debian:
  sudo apt-get install libreoffice-core libreoffice-impress libreoffice-writer libreoffice-calc

Fedora:
  sudo dnf install libreoffice-core libreoffice-impress libreoffice-writer libreoffice-calc

Arch:
  sudo pacman -S libreoffice-fresh`

    case 'win32':
      return `Install LibreOffice on Windows:
  Download from: https://www.libreoffice.org/download/
  Or: choco install libreoffice-fresh`

    default:
      return 'Download LibreOffice from: https://www.libreoffice.org/download/'
  }
}

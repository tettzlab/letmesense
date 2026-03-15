import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
// Note: afterAll is used in getInstallInstructions test
import { OfficeConvertError } from '../errors.js'
import {
  checkLibreOffice,
  convertToPdf,
  convertWithProfile,
  findLibreOffice,
  getInstallInstructions,
} from './libreoffice.js'

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}))

// Mock fs existsSync and statSync - need both named and default export
vi.mock('node:fs', () => {
  const existsSyncMock = vi.fn()
  const statSyncMock = vi.fn()
  return {
    default: { existsSync: existsSyncMock, statSync: statSyncMock },
    existsSync: existsSyncMock,
    statSync: statSyncMock,
  }
})

// Mock fs/promises
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    mkdtemp: vi.fn().mockResolvedValue('/tmp/lo-profile-abc123'),
    rm: vi.fn().mockResolvedValue(undefined),
  }
})

describe('findLibreOffice', () => {
  describe('LIBREOFFICE_PATH env var override', () => {
    const savedLibreOfficePath = process.env.LIBREOFFICE_PATH

    afterEach(() => {
      if (savedLibreOfficePath === undefined) {
        delete process.env.LIBREOFFICE_PATH
      } else {
        process.env.LIBREOFFICE_PATH = savedLibreOfficePath
      }
      vi.mocked(existsSync).mockReset()
      vi.mocked(statSync).mockReset()
      vi.mocked(execSync).mockReset()
    })

    it('returns LIBREOFFICE_PATH when set to a valid file path', () => {
      process.env.LIBREOFFICE_PATH = '/custom/path/to/libreoffice'
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(statSync).mockReturnValue({ isFile: () => true, isDirectory: () => false } as any)

      const result = findLibreOffice()

      expect(result).toBe('/custom/path/to/libreoffice')
      expect(existsSync).toHaveBeenCalledWith('/custom/path/to/libreoffice')
      expect(statSync).toHaveBeenCalledWith('/custom/path/to/libreoffice')
    })

    it('falls through when LIBREOFFICE_PATH points to a nonexistent path', () => {
      process.env.LIBREOFFICE_PATH = '/nonexistent/libreoffice'
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      const result = findLibreOffice()

      expect(result).toBeNull()
    })

    it('falls through when LIBREOFFICE_PATH points to a directory', () => {
      process.env.LIBREOFFICE_PATH = '/usr/lib/libreoffice'
      vi.mocked(existsSync).mockImplementation((p) => p === '/usr/lib/libreoffice')
      vi.mocked(statSync).mockReturnValue({ isFile: () => false, isDirectory: () => true } as any)
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not found')
      })

      const result = findLibreOffice()

      expect(result).toBeNull()
    })
  })

  it('returns executable path when found via which/where', () => {
    vi.mocked(execSync).mockReturnValueOnce('/usr/bin/libreoffice\n')

    const result = findLibreOffice()

    expect(result).toBe('libreoffice')
  })

  it('tries multiple executable names', () => {
    // Fail for first few, succeed for one
    vi.mocked(execSync)
      .mockImplementationOnce(() => {
        throw new Error('not found')
      })
      .mockImplementationOnce(() => {
        throw new Error('not found')
      })
      .mockReturnValueOnce('/usr/bin/libreoffice7.6\n')

    const result = findLibreOffice()

    expect(result).toBe('libreoffice7.6')
  })

  it('checks absolute paths with existsSync', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found')
    })
    // Use a Linux absolute path — platform is explicitly mocked above
    vi.mocked(existsSync).mockImplementation((p) => p === '/usr/bin/libreoffice')

    const result = findLibreOffice()

    expect(result).toBe('/usr/bin/libreoffice')
  })

  it('returns null when LibreOffice not found', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found')
    })
    vi.mocked(existsSync).mockReturnValue(false)

    const result = findLibreOffice()

    expect(result).toBeNull()
  })
})

describe('checkLibreOffice', () => {
  it('returns available: false when not found', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found')
    })
    vi.mocked(existsSync).mockReturnValue(false)

    const result = checkLibreOffice()

    expect(result.available).toBe(false)
    expect(result.error).toContain('LibreOffice not found')
  })

  it('returns available: true with version when found', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n') // findLibreOffice
      .mockReturnValueOnce('LibreOffice 7.6.3.2 abc123\n') // version check

    const result = checkLibreOffice()

    expect(result.available).toBe(true)
    expect(result.version).toBe('7.6.3.2')
    expect(result.path).toBe('libreoffice')
  })

  it('handles version check failure', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n') // findLibreOffice
      .mockImplementationOnce(() => {
        throw new Error('timeout')
      }) // version check fails

    const result = checkLibreOffice()

    expect(result.available).toBe(false)
    expect(result.error).toContain('Failed to get LibreOffice version')
  })

  it('returns unknown version when pattern not matched', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('Some unrecognized output\n')

    const result = checkLibreOffice()

    expect(result.available).toBe(true)
    expect(result.version).toBe('unknown')
  })
})

describe('convertToPdf', () => {
  const testFile = '/tmp/test-lo/test.pptx'
  const tmpDir = '/tmp/test-lo-out'

  beforeEach(() => {
    // Default: LibreOffice not available
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found')
    })
    vi.mocked(existsSync).mockReturnValue(false)
  })

  it('throws when LibreOffice not available', async () => {
    await expect(convertToPdf(testFile)).rejects.toThrow(OfficeConvertError)
  })

  it('throws when input file not found', async () => {
    // Make LibreOffice "available"
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('LibreOffice 7.6.0\n')
    vi.mocked(existsSync).mockReturnValue(false)

    await expect(convertToPdf('/nonexistent/file.pptx')).rejects.toThrow('Input file not found')
  })

  it('calls spawn with correct arguments', async () => {
    // Make LibreOffice available
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('LibreOffice 7.6.0\n')

    // Mock existsSync: true for input and output
    vi.mocked(existsSync).mockReturnValue(true)

    // Create mock child process
    const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
    mockProcess.stdout = new EventEmitter() as any
    mockProcess.stderr = new EventEmitter() as any
    mockProcess.kill = vi.fn()

    vi.mocked(spawn).mockReturnValue(mockProcess)

    const convertPromise = convertToPdf(testFile, { outputDir: tmpDir })

    // Simulate successful completion
    setTimeout(() => {
      mockProcess.emit('close', 0)
    }, 10)

    const result = await convertPromise

    expect(spawn).toHaveBeenCalledWith(
      'libreoffice',
      expect.arrayContaining([
        '--headless',
        '--invisible',
        '-env:UserInstallation=file:///tmp/lo-profile-abc123',
        '--convert-to',
        'pdf',
        '--outdir',
        tmpDir,
        testFile,
      ]),
      expect.any(Object),
    )
    expect(result.inputPath).toBe(testFile)
    expect(result.outputPath).toContain('.pdf')
  })

  it('handles conversion timeout', async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('LibreOffice 7.6.0\n')
    vi.mocked(existsSync).mockReturnValue(true)

    const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
    mockProcess.stdout = new EventEmitter() as any
    mockProcess.stderr = new EventEmitter() as any
    mockProcess.kill = vi.fn()

    vi.mocked(spawn).mockReturnValue(mockProcess)

    // Use very short timeout
    const convertPromise = convertToPdf(testFile, { timeout: 50 })

    await expect(convertPromise).rejects.toThrow('timed out')
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('handles spawn error', async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('LibreOffice 7.6.0\n')
    vi.mocked(existsSync).mockReturnValue(true)

    const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
    mockProcess.stdout = new EventEmitter() as any
    mockProcess.stderr = new EventEmitter() as any
    mockProcess.kill = vi.fn()

    vi.mocked(spawn).mockReturnValue(mockProcess)

    const convertPromise = convertToPdf(testFile)

    setTimeout(() => {
      mockProcess.emit('error', new Error('spawn failed'))
    }, 10)

    await expect(convertPromise).rejects.toThrow('spawn failed')
  })

  it('handles non-zero exit code', async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('LibreOffice 7.6.0\n')
    vi.mocked(existsSync).mockImplementation((p) => {
      // Input exists, output does not
      return String(p).endsWith('.pptx')
    })

    const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
    mockProcess.stdout = new EventEmitter() as any
    mockProcess.stderr = new EventEmitter() as any
    mockProcess.kill = vi.fn()

    vi.mocked(spawn).mockReturnValue(mockProcess)

    const convertPromise = convertToPdf(testFile)

    setTimeout(() => {
      ;(mockProcess.stderr as EventEmitter).emit('data', 'Error: conversion failed')
      mockProcess.emit('close', 1)
    }, 10)

    await expect(convertPromise).rejects.toThrow('conversion failed')
  })

  it('creates an isolated profile directory via mkdtemp', async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('LibreOffice 7.6.0\n')
    vi.mocked(existsSync).mockReturnValue(true)

    const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
    mockProcess.stdout = new EventEmitter() as any
    mockProcess.stderr = new EventEmitter() as any
    mockProcess.kill = vi.fn()
    vi.mocked(spawn).mockReturnValue(mockProcess)

    const convertPromise = convertToPdf(testFile)
    setTimeout(() => mockProcess.emit('close', 0), 10)
    await convertPromise

    expect(mkdtemp).toHaveBeenCalledWith(expect.stringContaining('lo-profile-'))
  })

  it('cleans up profile directory on successful conversion', async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('LibreOffice 7.6.0\n')
    vi.mocked(existsSync).mockReturnValue(true)

    const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
    mockProcess.stdout = new EventEmitter() as any
    mockProcess.stderr = new EventEmitter() as any
    mockProcess.kill = vi.fn()
    vi.mocked(spawn).mockReturnValue(mockProcess)

    const convertPromise = convertToPdf(testFile)
    setTimeout(() => mockProcess.emit('close', 0), 10)
    await convertPromise

    expect(rm).toHaveBeenCalledWith('/tmp/lo-profile-abc123', {
      recursive: true,
      force: true,
    })
  })

  it('cleans up profile directory on spawn error', async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('LibreOffice 7.6.0\n')
    vi.mocked(existsSync).mockReturnValue(true)

    const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
    mockProcess.stdout = new EventEmitter() as any
    mockProcess.stderr = new EventEmitter() as any
    mockProcess.kill = vi.fn()
    vi.mocked(spawn).mockReturnValue(mockProcess)

    const convertPromise = convertToPdf(testFile)
    setTimeout(() => mockProcess.emit('error', new Error('spawn failed')), 10)

    await expect(convertPromise).rejects.toThrow('spawn failed')
    expect(rm).toHaveBeenCalledWith('/tmp/lo-profile-abc123', {
      recursive: true,
      force: true,
    })
  })

  it('cleans up profile directory on timeout', async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('LibreOffice 7.6.0\n')
    vi.mocked(existsSync).mockReturnValue(true)

    const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
    mockProcess.stdout = new EventEmitter() as any
    mockProcess.stderr = new EventEmitter() as any
    mockProcess.kill = vi.fn()
    vi.mocked(spawn).mockReturnValue(mockProcess)

    const convertPromise = convertToPdf(testFile, { timeout: 50 })

    await expect(convertPromise).rejects.toThrow('timed out')
    expect(rm).toHaveBeenCalledWith('/tmp/lo-profile-abc123', {
      recursive: true,
      force: true,
    })
  })

  it('retries on transient macOS Task policy error', async () => {
    // First two calls: LibreOffice fails with Task policy error
    // Third call: succeeds
    let callCount = 0

    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd)
      if (cmdStr.includes('--version')) return 'LibreOffice 7.6.0\n' as any
      return '/usr/bin/libreoffice\n' as any
    })
    vi.mocked(existsSync).mockReturnValue(true)

    vi.mocked(spawn).mockImplementation(() => {
      callCount++
      const proc = new EventEmitter() as ChildProcess & EventEmitter
      proc.stdout = new EventEmitter() as any
      proc.stderr = new EventEmitter() as any
      proc.kill = vi.fn()

      setTimeout(() => {
        if (callCount <= 2) {
          ;(proc.stderr as EventEmitter).emit(
            'data',
            'Task policy set failed: 4 ((os/kern) invalid argument)',
          )
          proc.emit('close', 1)
        } else {
          proc.emit('close', 0)
        }
      }, 10)

      return proc
    })

    const result = await convertToPdf(testFile, { outputDir: tmpDir })
    expect(callCount).toBe(3)
    expect(result.inputPath).toBe(testFile)
  })

  it('gives up after exhausting retries on transient error', async () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd)
      if (cmdStr.includes('--version')) return 'LibreOffice 7.6.0\n' as any
      return '/usr/bin/libreoffice\n' as any
    })
    vi.mocked(existsSync).mockImplementation((p) => {
      return String(p).endsWith('.pptx')
    })

    vi.mocked(spawn).mockImplementation(() => {
      const proc = new EventEmitter() as ChildProcess & EventEmitter
      proc.stdout = new EventEmitter() as any
      proc.stderr = new EventEmitter() as any
      proc.kill = vi.fn()

      setTimeout(() => {
        ;(proc.stderr as EventEmitter).emit(
          'data',
          'Task policy set failed: 4 ((os/kern) invalid argument)',
        )
        proc.emit('close', 1)
      }, 10)

      return proc
    })

    await expect(convertToPdf(testFile, { retries: 1 })).rejects.toThrow('Task policy set failed')
  })

  it('does not retry non-transient errors', async () => {
    let callCount = 0

    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = String(cmd)
      if (cmdStr.includes('--version')) return 'LibreOffice 7.6.0\n' as any
      return '/usr/bin/libreoffice\n' as any
    })
    vi.mocked(existsSync).mockImplementation((p) => {
      return String(p).endsWith('.pptx')
    })

    vi.mocked(spawn).mockImplementation(() => {
      callCount++
      const proc = new EventEmitter() as ChildProcess & EventEmitter
      proc.stdout = new EventEmitter() as any
      proc.stderr = new EventEmitter() as any
      proc.kill = vi.fn()

      setTimeout(() => {
        ;(proc.stderr as EventEmitter).emit('data', 'Fatal error: corrupt file')
        proc.emit('close', 1)
      }, 10)

      return proc
    })

    await expect(convertToPdf(testFile)).rejects.toThrow('corrupt file')
    expect(callCount).toBe(1)
  })
})

describe('convertWithProfile', () => {
  it('includes profile directory in spawn arguments', async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('/usr/bin/libreoffice\n')
      .mockReturnValueOnce('LibreOffice 7.6.0\n')
    vi.mocked(existsSync).mockReturnValue(true)

    const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
    mockProcess.stdout = new EventEmitter() as any
    mockProcess.stderr = new EventEmitter() as any
    mockProcess.kill = vi.fn()

    vi.mocked(spawn).mockReturnValue(mockProcess)

    const profileDir = path.join(os.tmpdir(), 'test-profile')
    const convertPromise = convertWithProfile('/tmp/input.pptx', profileDir)

    setTimeout(() => {
      mockProcess.emit('close', 0)
    }, 10)

    await convertPromise

    expect(spawn).toHaveBeenCalledWith(
      'libreoffice',
      expect.arrayContaining([`-env:UserInstallation=file://${profileDir}`]),
      expect.any(Object),
    )
  })
})

describe('getInstallInstructions', () => {
  const originalPlatform = process.platform

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('returns macOS instructions for darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const instructions = getInstallInstructions()
    expect(instructions).toContain('brew install')
    expect(instructions).toContain('macOS')
  })

  it('returns Linux instructions for linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const instructions = getInstallInstructions()
    expect(instructions).toContain('apt-get')
    expect(instructions).toContain('dnf')
    expect(instructions).toContain('pacman')
  })

  it('returns Windows instructions for win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const instructions = getInstallInstructions()
    expect(instructions).toContain('Windows')
    expect(instructions).toContain('choco')
  })

  it('returns generic instructions for unknown platform', () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd' })
    const instructions = getInstallInstructions()
    expect(instructions).toContain('libreoffice.org/download')
  })
})

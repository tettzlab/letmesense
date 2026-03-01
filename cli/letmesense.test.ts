import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const CLI_PATH = path.resolve('cli/letmesense.ts')
const FIXTURES = path.resolve('lib/office/fixtures')
const SAMPLES = {
  pdf: path.join(FIXTURES, 'sample.pdf'),
  pptx: path.join(FIXTURES, 'sample.pptx'),
  docx: path.join(FIXTURES, 'sample.docx'),
  xlsx: path.join(FIXTURES, 'sample.xlsx'),
}

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function runCli(args: string[], stdin?: Buffer): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', CLI_PATH, ...args], {
      cwd: process.cwd(),
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    if (stdin) {
      // Handle EPIPE gracefully - process may close before we finish writing
      proc.stdin.on('error', () => {})
      proc.stdin.write(stdin)
      proc.stdin.end()
    }

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      })
    })
  })
}

describe('letmesense CLI (unified wrapper)', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'letmesense-test-'))
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // Consolidated: --help and --version flags (single subprocess each)
  test('--help shows usage info', async () => {
    const result = await runCli(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('letmesense')
    expect(result.stdout).toContain('Extract text from documents')
    expect(result.stdout).toContain('--input-format')
  }, 15000)

  test('--version shows version', async () => {
    const result = await runCli(['--version'])
    expect(result.exitCode).toBe(0)
    // Version output goes to stdout with commander
    const output = result.stdout + result.stderr
    expect(output.length).toBeGreaterThan(0)
  }, 15000)

  test('no arguments shows error', async () => {
    const result = await runCli([])
    // Commander requires the <input> argument, so exit 1 with error
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("missing required argument 'input'")
  }, 15000)

  // Consolidated: PDF file processing (single subprocess)
  test('routes and processes .pdf files with --json', async () => {
    const result = await runCli([SAMPLES.pdf, '--json', '--quiet'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0)
    const json = JSON.parse(result.stdout)
    expect(json).toHaveProperty('text')
    expect(json).toHaveProperty('metadata')
  }, 60000)

  // Consolidated: Office file processing (single subprocess)
  test('routes and processes .pptx files with --json', async () => {
    const result = await runCli([SAMPLES.pptx, '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0)
    const json = JSON.parse(result.stdout)
    expect(json).toHaveProperty('text')
    expect(json).toHaveProperty('metadata')
  }, 30000)

  // Consolidated: stdin handling (batch related tests)
  describe('stdin processing', () => {
    test('requires --input-format for stdin', async () => {
      // Send some dummy bytes to prevent hanging
      const dummyInput = Buffer.from('dummy content')
      const result = await runCli(['-'], dummyInput)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('--input-format is required')
    }, 15000)

    test('accepts PDF from stdin with --input-format pdf', async () => {
      const pdfBuffer = await fs.readFile(SAMPLES.pdf)
      const result = await runCli(['-', '--input-format', 'pdf', '--quiet'], pdfBuffer)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.length).toBeGreaterThan(0)
    }, 120000)

    test('accepts PPTX from stdin with --input-format pptx', async () => {
      const pptxBuffer = await fs.readFile(SAMPLES.pptx)
      const result = await runCli(['-', '--input-format', 'pptx'], pptxBuffer)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.length).toBeGreaterThan(0)
    }, 120000)
  })

  // Consolidated: error handling (batch related tests)
  describe('error handling', () => {
    test('errors for unknown/missing file extension', async () => {
      const unknownExt = await runCli(['file.xyz'])
      expect(unknownExt.exitCode).toBe(1)
      expect(unknownExt.stderr).toContain('Cannot detect format')

      const noExt = await runCli(['unknownfile'])
      expect(noExt.exitCode).toBe(1)
      expect(noExt.stderr).toContain('Cannot detect format')
    }, 30000)
  })

  // Consolidated: output to file (single subprocess per format)
  test('writes PDF output to file with -o', async () => {
    const outputPath = path.join(tempDir, 'output-pdf.txt')
    const result = await runCli([SAMPLES.pdf, '-o', outputPath, '--quiet'])
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content.length).toBeGreaterThan(0)
  }, 120000)

  test('writes PPTX output to file with -o', async () => {
    const outputPath = path.join(tempDir, 'output-pptx.txt')
    const result = await runCli([SAMPLES.pptx, '-o', outputPath])
    expect(result.exitCode).toBe(0)
    const content = await fs.readFile(outputPath, 'utf-8')
    expect(content.length).toBeGreaterThan(0)
  }, 30000)

  // Consolidated: URL format detection (single test)
  test('detects format from URL path', async () => {
    // PDF URL - will fail to fetch but should detect format correctly
    const pdfResult = await runCli(['https://example.com/document.pdf', '--quiet'])
    expect(pdfResult.exitCode).not.toBe(0)
    expect(pdfResult.stderr).not.toContain('Cannot detect format')

    // PPTX URL
    const pptxResult = await runCli(['https://example.com/slides.pptx'])
    expect(pptxResult.exitCode).not.toBe(0)
    expect(pptxResult.stderr).not.toContain('Cannot detect format')
  }, 30000)
})

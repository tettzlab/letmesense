/**
 * Tests for the shared OCR module.
 */

import path from 'node:path'
import { describe, expect, test } from 'vitest'

import {
  createOcrWorker,
  defaultTessdataDir,
  hasLocalLangFile,
  shouldUseOffline,
  terminateWorker,
} from './index.js'

describe('OCR tessdata utilities', () => {
  test('defaultTessdataDir returns repo tessdata directory', () => {
    const dir = defaultTessdataDir()
    expect(dir).toContain('tessdata')
    expect(path.isAbsolute(dir)).toBe(true)
  })

  test('hasLocalLangFile returns false for non-existent files', () => {
    const result = hasLocalLangFile('/nonexistent/path', 'eng')
    expect(result).toBe(false)
  })

  test('hasLocalLangFile handles multi-language specs', () => {
    // Should return false since files don't exist
    const result = hasLocalLangFile('/nonexistent/path', 'eng+jpn')
    expect(result).toBe(false)
  })

  test('shouldUseOffline returns false for non-existent directory', () => {
    const result = shouldUseOffline('/nonexistent/path', 'eng')
    expect(result).toBe(false)
  })
})

describe('OCR worker management', () => {
  test('createOcrWorker creates a worker', async () => {
    const worker = await createOcrWorker({ lang: 'eng' })
    expect(worker).toBeDefined()
    expect(typeof worker.recognize).toBe('function')
    await terminateWorker(worker)
  }, 30000)

  test('terminateWorker handles already terminated workers', async () => {
    const worker = await createOcrWorker({ lang: 'eng' })
    await terminateWorker(worker)
    // Should not throw when called again
    await terminateWorker(worker)
  }, 30000)
})

describe('OCR types', () => {
  test('OcrOptions type has expected shape', async () => {
    const { recognizeImage } = await import('./recognize.js')
    // TypeScript will catch type mismatches at compile time
    // This test just ensures the module exports work
    expect(typeof recognizeImage).toBe('function')
  })
})

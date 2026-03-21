/**
 * Vitest global setup — generates all test fixtures before tests run.
 *
 * Skips generation if fixture files already exist (fast no-op on repeat runs).
 * Force regeneration with: REGENERATE_FIXTURES=1 pnpm test
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

const FORCE = process.env.REGENERATE_FIXTURES === '1'

function allExist(dir: string, files: string[]): boolean {
  return files.every((f) => existsSync(join(dir, f)))
}

async function generateSamples() {
  const dir = 'samples'
  const files = ['born-digital.pdf', 'scanned-image.pdf', 'mixed.pdf', 'treacherous.pdf']
  if (!FORCE && allExist(dir, files)) return
  console.log('[globalSetup] Generating sample PDFs...')
  const { generate } = await import('./samples/generate-fixtures.js')
  await generate()
}

async function generateOfficeFixtures() {
  const dir = 'lib/office/fixtures'
  const files = [
    'sample.pdf',
    'sample.docx',
    'sample.pptx',
    'sample.xlsx',
    'sample.odt',
    'sample.odp',
    'sample.ods',
  ]
  if (!FORCE && allExist(dir, files)) return
  console.log('[globalSetup] Generating office fixtures...')
  const { generate } = await import('./lib/office/fixtures/generate-fixtures.js')
  await generate()
}

async function generateImageFixtures() {
  const dir = 'cli/fixtures'
  const files = ['solid-red.png', 'solid-green.jpg', 'test.svg']
  if (!FORCE && allExist(dir, files)) return
  console.log('[globalSetup] Generating image fixtures...')
  const { generate } = await import('./cli/fixtures/generate-image-fixtures.js')
  await generate()
}

export async function setup() {
  await Promise.all([generateSamples(), generateOfficeFixtures(), generateImageFixtures()])
}

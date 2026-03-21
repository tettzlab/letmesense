/**
 * Script to generate test image fixtures for E2E tests.
 * Run with: pnpm tsx cli/fixtures/generate-image-fixtures.ts
 *
 * These fixtures are generated before tests via vitest globalSetup.
 * They are gitignored and not committed to the repo.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const FIXTURES_DIR = path.dirname(new URL(import.meta.url).pathname)

interface RGB {
  r: number
  g: number
  b: number
}

async function createSolidPng(w: number, h: number, color: RGB): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: color },
  })
    .png()
    .toBuffer()
}

async function createSolidJpg(w: number, h: number, color: RGB): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: color },
  })
    .jpeg({ quality: 90 })
    .toBuffer()
}

async function createSolidWebp(w: number, h: number, color: RGB): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: color },
  })
    .webp({ quality: 90 })
    .toBuffer()
}

async function createSolidGif(w: number, h: number, color: RGB): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: color },
  })
    .gif()
    .toBuffer()
}

async function createTransparentPng(w: number, h: number): Promise<Buffer> {
  const pixels = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      pixels[idx] = 100 // R
      pixels[idx + 1] = 150 // G
      pixels[idx + 2] = 200 // B
      pixels[idx + 3] = 128 // A (semi-transparent)
    }
  }
  return sharp(pixels, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer()
}

async function createGradientPng(w: number, h: number): Promise<Buffer> {
  const pixels = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 3
      pixels[idx] = Math.floor((x / w) * 255)
      pixels[idx + 1] = Math.floor((y / h) * 255)
      pixels[idx + 2] = Math.floor(((x + y) / (w + h)) * 255)
    }
  }
  return sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer()
}

async function main() {
  console.log('Generating image fixtures...')

  // Standard test images
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'solid-red.png'),
    await createSolidPng(200, 150, { r: 255, g: 0, b: 0 }),
  )
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'solid-green.jpg'),
    await createSolidJpg(200, 150, { r: 0, g: 255, b: 0 }),
  )
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'solid-blue.webp'),
    await createSolidWebp(200, 150, { r: 0, g: 0, b: 255 }),
  )
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'solid-yellow.gif'),
    await createSolidGif(200, 150, { r: 255, g: 255, b: 0 }),
  )

  // SVG files
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'test.svg'),
    `<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="100" fill="#4a90d9"/>
  <circle cx="100" cy="50" r="40" fill="#ffffff"/>
</svg>`,
  )
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'no-viewbox.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg">
  <circle cx="25" cy="25" r="20" fill="#ff0000"/>
</svg>`,
  )

  // Special test images
  await fs.writeFile(path.join(FIXTURES_DIR, 'gradient.png'), await createGradientPng(400, 400))
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'transparent.png'),
    await createTransparentPng(100, 100),
  )
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'tiny.png'),
    await createSolidPng(1, 1, { r: 128, g: 128, b: 128 }),
  )
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'large.png'),
    await createSolidPng(4000, 3000, { r: 100, g: 100, b: 100 }),
  )
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'small.png'),
    await createSolidPng(50, 50, { r: 200, g: 100, b: 50 }),
  )

  // Edge case files
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'corrupt.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xff, 0xff]),
  )
  await fs.writeFile(path.join(FIXTURES_DIR, 'empty.png'), Buffer.alloc(0))
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'file.xyz'),
    await createSolidPng(50, 50, { r: 50, g: 50, b: 50 }),
  )
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'path with spaces.png'),
    await createSolidPng(100, 100, { r: 150, g: 150, b: 150 }),
  )

  // Gradient variants for quality comparison
  const gradientPng = await createGradientPng(400, 400)
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'gradient.jpg'),
    await sharp(gradientPng).jpeg({ quality: 100 }).toBuffer(),
  )
  await fs.writeFile(
    path.join(FIXTURES_DIR, 'gradient.webp'),
    await sharp(gradientPng).webp({ quality: 100 }).toBuffer(),
  )

  console.log('Done! Generated fixtures in', FIXTURES_DIR)
}

export { main as generate }

// Self-execute when run directly
const scriptArg = process.argv[1]
if (scriptArg && import.meta.url === `file://${path.resolve(scriptArg)}`) {
  main().catch(console.error)
}

#!/usr/bin/env npx tsx

/**
 * Generate sample PDF fixtures for tests.
 * Run with: npx tsx samples/generate-fixtures.ts
 *
 * Creates PDFs that satisfy classification thresholds in lib/pdf/classify.ts:
 * - born-digital: >=20 text chars, image coverage <2%
 * - scanned-image: <20 text chars, image coverage >=60%
 * - mixed: >=20 text chars, image coverage >=10%
 */

import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'

const FIXTURES_DIR = path.dirname(new URL(import.meta.url).pathname)

// Page dimensions in points
const A4_W = 595.28
const A4_H = 841.89
const LETTER_W = 612
const LETTER_H = 792

/** Create a solid-color JPEG buffer using sharp. */
async function solidJpeg(
  w: number,
  h: number,
  color = { r: 180, g: 180, b: 180 },
): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: color },
  })
    .jpeg({ quality: 50 })
    .toBuffer()
  return new Uint8Array(buf)
}

// ============================================================================
// born-digital.pdf — 1 page, A4, text only
// ============================================================================

async function generateBornDigital(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([A4_W, A4_H])

  page.drawText('BORN-DIGITAL SAMPLE (EN)', {
    x: 50,
    y: A4_H - 80,
    size: 20,
    font,
    color: rgb(0, 0, 0),
  })

  const body = [
    'This is a born-digital PDF page.',
    'This is a born-digital PDF page.',
    'This is a born-digital PDF page.',
    'This is a born-digital PDF page.',
    'This is a born-digital PDF page.',
    'This is a born-digital PDF page.',
    'This is a born-digital PDF page.',
    'This is a born-digital PDF page.',
  ]
  for (let i = 0; i < body.length; i++) {
    page.drawText(body[i], {
      x: 50,
      y: A4_H - 120 - i * 22,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    })
  }

  return pdf.save()
}

// ============================================================================
// scanned-image.pdf — 1 page, A4, full-page raster, no text
// ============================================================================

async function generateScannedImage(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([A4_W, A4_H])

  // Embed a JPEG that covers ~95% of the page
  const imgW = Math.round(A4_W * 0.97)
  const imgH = Math.round(A4_H * 0.97)
  const jpegBytes = await solidJpeg(imgW, imgH)
  const img = await pdf.embedJpg(jpegBytes)

  page.drawImage(img, {
    x: (A4_W - imgW) / 2,
    y: (A4_H - imgH) / 2,
    width: imgW,
    height: imgH,
  })

  // Minimal text for OCR test extraction (under 20-char threshold for scanned-image)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('SCANNED PAGE', {
    x: 50,
    y: 20,
    size: 6,
    font,
    color: rgb(1, 1, 1), // white on white — invisible but extractable
  })

  return pdf.save()
}

// ============================================================================
// mixed.pdf — 1 page, A4, text + large image
// ============================================================================

async function generateMixed(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([A4_W, A4_H])

  // Large image covering ~50% of the page (well above 10% threshold)
  const imgW = Math.round(A4_W * 0.9)
  const imgH = Math.round(A4_H * 0.5)
  const jpegBytes = await solidJpeg(imgW, imgH, { r: 220, g: 220, b: 240 })
  const img = await pdf.embedJpg(jpegBytes)

  page.drawImage(img, {
    x: (A4_W - imgW) / 2,
    y: A4_H - imgH - 20,
    width: imgW,
    height: imgH,
  })

  // Text below the image (>20 chars for 'mixed' classification)
  const lines = [
    'Hidden text layer that makes this page "mixed".',
    'more english words more english words more english words',
  ]
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i], {
      x: 50,
      y: A4_H - imgH - 60 - i * 20,
      size: 11,
      font,
      color: rgb(0, 0, 0),
    })
  }

  return pdf.save()
}

// ============================================================================
// treacherous.pdf — 6 pages with varying kinds, sizes, orientations
// ============================================================================

async function generateTreacherous(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  // --- Page 1: Born-digital, A4 portrait, English ---
  {
    const page = pdf.addPage([A4_W, A4_H])
    page.drawText('Treacherous PDF — Page 1 (Born-digital, A4 portrait, EN)', {
      x: 40,
      y: A4_H - 60,
      size: 14,
      font,
    })
    const body = Array(10).fill(
      'This page is born-digital and contains enough English text for language detection.',
    )
    for (let i = 0; i < body.length; i++) {
      page.drawText(body[i], { x: 40, y: A4_H - 100 - i * 20, size: 10, font })
    }
  }

  // --- Page 2: Scanned-image, A4 portrait ---
  {
    const page = pdf.addPage([A4_W, A4_H])
    const imgW = Math.round(A4_W * 0.97)
    const imgH = Math.round(A4_H * 0.97)
    const jpegBytes = await solidJpeg(imgW, imgH, { r: 200, g: 200, b: 200 })
    const img = await pdf.embedJpg(jpegBytes)
    page.drawImage(img, {
      x: (A4_W - imgW) / 2,
      y: (A4_H - imgH) / 2,
      width: imgW,
      height: imgH,
    })
    // Minimal text for OCR to find
    page.drawText('SCANNED PAGE', {
      x: 50,
      y: 20,
      size: 6,
      font,
      color: rgb(1, 1, 1),
    })
  }

  // --- Page 3: Mixed, A4 portrait ---
  {
    const page = pdf.addPage([A4_W, A4_H])
    const imgW = Math.round(A4_W * 0.9)
    const imgH = Math.round(A4_H * 0.5)
    const jpegBytes = await solidJpeg(imgW, imgH, { r: 210, g: 220, b: 230 })
    const img = await pdf.embedJpg(jpegBytes)
    page.drawImage(img, {
      x: (A4_W - imgW) / 2,
      y: A4_H - imgH - 20,
      width: imgW,
      height: imgH,
    })
    page.drawText("Hidden text layer that makes this page 'mixed'.", {
      x: 40,
      y: A4_H - imgH - 60,
      size: 11,
      font,
    })
    page.drawText('more english words more english words more english words', {
      x: 40,
      y: A4_H - imgH - 80,
      size: 11,
      font,
    })
  }

  // --- Page 4: Born-digital, Letter landscape, English ---
  {
    const page = pdf.addPage([LETTER_H, LETTER_W]) // landscape = swap W/H
    page.drawText('Treacherous PDF — Page 4 (Born-digital, Letter landscape, EN)', {
      x: 40,
      y: LETTER_W - 60,
      size: 14,
      font,
    })
    const body = Array(12).fill('Landscape born-digital page with different paper size.')
    for (let i = 0; i < body.length; i++) {
      page.drawText(body[i], { x: 40, y: LETTER_W - 100 - i * 20, size: 10, font })
    }
  }

  // --- Page 5: Scanned-image, Letter landscape ---
  {
    const pw = LETTER_H // landscape
    const ph = LETTER_W
    const page = pdf.addPage([pw, ph])
    const imgW = Math.round(pw * 0.97)
    const imgH = Math.round(ph * 0.97)
    const jpegBytes = await solidJpeg(imgW, imgH, { r: 190, g: 190, b: 190 })
    const img = await pdf.embedJpg(jpegBytes)
    page.drawImage(img, {
      x: (pw - imgW) / 2,
      y: (ph - imgH) / 2,
      width: imgW,
      height: imgH,
    })
    page.drawText('SCANNED (LANDSCAPE)', {
      x: 50,
      y: 20,
      size: 6,
      font,
      color: rgb(1, 1, 1),
    })
  }

  // --- Page 6: Born-digital, A4 portrait, distinct text ---
  // Uses Latin text (no CJK font available in pdf-lib standard fonts).
  // Tests only assert runCount > 1, satisfied by paper size differences.
  {
    const page = pdf.addPage([A4_W, A4_H])
    page.drawText('Treacherous PDF — Page 6 (Digital, A4 portrait)', {
      x: 40,
      y: A4_H - 60,
      size: 14,
      font,
    })
    const body = Array(10).fill(
      'Pagina sei del documento di prova con testo in lingua diversa per test.',
    )
    for (let i = 0; i < body.length; i++) {
      page.drawText(body[i], { x: 40, y: A4_H - 100 - i * 20, size: 10, font })
    }
  }

  return pdf.save()
}

// ============================================================================
// Main
// ============================================================================

export async function generate(): Promise<void> {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true })
  }

  const [bornDigital, scannedImage, mixed, treacherous] = await Promise.all([
    generateBornDigital(),
    generateScannedImage(),
    generateMixed(),
    generateTreacherous(),
  ])

  fs.writeFileSync(path.join(FIXTURES_DIR, 'born-digital.pdf'), bornDigital)
  console.log('  samples/born-digital.pdf')

  fs.writeFileSync(path.join(FIXTURES_DIR, 'scanned-image.pdf'), scannedImage)
  console.log('  samples/scanned-image.pdf')

  fs.writeFileSync(path.join(FIXTURES_DIR, 'mixed.pdf'), mixed)
  console.log('  samples/mixed.pdf')

  fs.writeFileSync(path.join(FIXTURES_DIR, 'treacherous.pdf'), treacherous)
  console.log('  samples/treacherous.pdf')
}

// Self-execute when run directly
const scriptArg = process.argv[1]
if (scriptArg && import.meta.url === `file://${path.resolve(scriptArg)}`) {
  console.log('Generating sample PDFs...')
  generate()
    .then(() => console.log('Done!'))
    .catch(console.error)
}

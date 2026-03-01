/**
 * PDF rendering using Playwright + pdf.js in browser.
 *
 * This renderer handles CJK fonts and other complex fonts that fail
 * with the Node.js pdf.js + @napi-rs/canvas approach. It spawns a
 * headless Chromium instance and uses pdf.js in the browser context
 * where system fonts are available for fallback.
 */

import { createServer, type Server } from 'node:http'

import { obs } from '../observability/index.js'

// Lazy-load playwright to avoid dependency issues when not needed
let chromium: typeof import('playwright').chromium | null = null

async function getChromium() {
  if (!chromium) {
    const playwright = await import('playwright')
    chromium = playwright.chromium
  }
  return chromium
}

/** Options for Playwright rendering */
export interface PlaywrightRenderOptions {
  /** Render scale (default: 2) */
  scale?: number
  /** Timeout in ms (default: 30000) */
  timeout?: number
  /** pdf.js version to use (default: 5.0.375) */
  pdfjsVersion?: string
}

/** Result of rendering a page */
export interface PlaywrightRenderedPage {
  /** PNG buffer */
  buffer: Buffer
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
}

/**
 * Render a single PDF page using Playwright + pdf.js in browser.
 */
export async function renderPageWithPlaywright(
  pdfBytes: Uint8Array,
  pageNumber: number,
  options: PlaywrightRenderOptions = {},
): Promise<PlaywrightRenderedPage> {
  const { logger } = obs('pdf.playwrightRender')
  const { scale = 2, timeout = 30000, pdfjsVersion = '5.0.375' } = options

  const pdfBase64 = Buffer.from(pdfBytes).toString('base64')

  // HTML page that renders PDF using pdf.js
  const html = generateRenderHtml(pdfBase64, pageNumber, scale, pdfjsVersion)

  // Start local server
  const { server, port } = await startServer(html)

  try {
    const chromiumLib = await getChromium()
    const browser = await chromiumLib.launch({
      args: ['--font-render-hinting=none'],
    })

    try {
      const page = await browser.newPage()

      // Collect console messages for debugging
      const warnings: string[] = []
      page.on('console', (msg) => {
        const text = msg.text()
        if (text.includes('Warning:')) {
          warnings.push(text)
        }
      })

      const url = `http://localhost:${port}/`
      await page.goto(url, { waitUntil: 'networkidle', timeout })

      // Wait for rendering to complete
      await page.waitForFunction('window.pdfRendered === true', { timeout })
      await page.waitForTimeout(200) // Small buffer for final paint

      // Get dimensions
      const dimensions = await page.evaluate(() => {
        const canvas = document.querySelector('canvas')
        return canvas ? { width: canvas.width, height: canvas.height } : null
      })

      if (!dimensions) {
        throw new Error('Canvas not found after rendering')
      }

      // Log warnings if any
      if (warnings.length > 0) {
        logger.debug({ warnings }, 'Playwright render warnings')
      }

      // Take screenshot of just the canvas
      const screenshot = await page.screenshot({ fullPage: true })

      return {
        buffer: Buffer.from(screenshot),
        width: dimensions.width,
        height: dimensions.height,
      }
    } finally {
      await browser.close()
    }
  } finally {
    await stopServer(server)
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

function generateRenderHtml(
  pdfBase64: string,
  pageNumber: number,
  scale: number,
  pdfjsVersion: string,
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; background: white; }
    canvas { display: block; }
  </style>
</head>
<body>
  <div id="container"></div>
  <script type="module">
    try {
      const pdfjsLib = await import('https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.mjs';

      const pdfData = atob('${pdfBase64}');
      const pdfArray = new Uint8Array(pdfData.length);
      for (let i = 0; i < pdfData.length; i++) {
        pdfArray[i] = pdfData.charCodeAt(i);
      }

      const pdf = await pdfjsLib.getDocument({
        data: pdfArray,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@${pdfjsVersion}/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@${pdfjsVersion}/standard_fonts/',
        useSystemFonts: true,
        disableFontFace: false
      }).promise;

      const page = await pdf.getPage(${pageNumber});
      const viewport = page.getViewport({ scale: ${scale} });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      document.getElementById('container').appendChild(canvas);

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      window.pdfRendered = true;
    } catch (e) {
      console.error('Render error:', e);
      window.pdfRendered = true;
    }
  </script>
</body>
</html>`
}

async function startServer(html: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((_, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(html)
    })

    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })
}

async function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

/**
 * Playwright session for rendering web pages with full JS/CSS fidelity.
 *
 * URL inputs navigate directly; file/buffer inputs are served via a local HTTP server.
 * Returns rendered text, screenshot, and dimensions for vision extraction.
 */

import { createServer, type Server } from 'node:http'

import { DEFAULT_FETCH_TIMEOUT_MS } from '../../common/timeouts.js'

// Lazy-load playwright to avoid dependency issues when not needed
let chromium: typeof import('playwright').chromium | null = null

async function getChromium() {
  if (!chromium) {
    const playwright = await import('playwright')
    chromium = playwright.chromium
  }
  return chromium
}

/** Options for rendering a web page with Playwright. */
export interface WebPlaywrightOptions {
  /** Navigate directly to this URL */
  url?: string
  /** Serve this HTML locally */
  html?: string
  /** Device scale factor (default: 2) */
  scale?: number
  /** Navigation timeout in ms (default: 30000) */
  timeout?: number
  /** Viewport width (default: 1280) */
  viewportWidth?: number
  /** Viewport height (default: 960) */
  viewportHeight?: number
  /** Maximum screenshot height in px (default: 16384) */
  maxHeight?: number
}

/** Result of a Playwright web page render. */
export interface WebPlaywrightResult {
  /** Rendered body text from page.innerText('body') */
  text: string
  /** PNG screenshot buffer */
  screenshotBuffer: Buffer
  /** Screenshot width in pixels */
  width: number
  /** Screenshot height in pixels */
  height: number
  /** html[lang] attribute value */
  language: string
  /** Browser instance — kept alive for cleanup() */
  browser: unknown
}

/**
 * Render a web page using Playwright, extracting text and screenshot.
 *
 * Either `url` or `html` must be provided.
 * The browser is returned open — caller must close it via cleanup.
 */
export async function renderWebPage(options: WebPlaywrightOptions): Promise<WebPlaywrightResult> {
  const {
    url,
    html,
    scale = 2,
    timeout = DEFAULT_FETCH_TIMEOUT_MS,
    viewportWidth = 1280,
    viewportHeight = 960,
    maxHeight = 16384,
  } = options

  if (!url && !html) {
    throw new Error('renderWebPage requires either url or html')
  }

  let server: Server | undefined
  const chromiumLib = await getChromium()
  const browser = await launchOrThrow(chromiumLib, [
    '--disable-dev-shm-usage',
    '--font-render-hinting=none',
  ])

  try {
    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      deviceScaleFactor: scale,
    })
    const page = await context.newPage()

    let navigateUrl: string
    if (url) {
      navigateUrl = url
    } else {
      // html is guaranteed non-null here since we checked url/html at the top
      const srv = await startServer(html as string)
      server = srv.server
      navigateUrl = `http://127.0.0.1:${srv.port}/`
    }

    await page.goto(navigateUrl, { waitUntil: 'networkidle', timeout })

    // Extract rendered text
    const text = await page.innerText('body')

    // Detect language from html[lang]
    const language = await page.evaluate(
      () => document.documentElement.getAttribute('lang')?.split('-')[0] ?? 'und',
    )

    // Get page dimensions for screenshot clipping
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))

    // Clip height to maxHeight
    const clipHeight = Math.min(dimensions.height, maxHeight)

    const screenshotBuffer = Buffer.from(
      await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: dimensions.width, height: clipHeight },
      }),
    )

    // Calculate actual pixel dimensions (accounting for device scale)
    const width = dimensions.width * scale
    const height = clipHeight * scale

    if (server) {
      await stopServer(server).catch(() => {})
      server = undefined
    }

    return { text, screenshotBuffer, width, height, language, browser }
  } catch (err) {
    if (server) {
      await stopServer(server).catch(() => {})
    }
    await browser.close().catch(() => {})
    throw err
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function launchOrThrow(chromiumLib: NonNullable<typeof chromium>, args: string[]) {
  try {
    return await chromiumLib.launch({ args })
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes("Executable doesn't exist") || msg.includes('playwright install')) {
      throw new Error(
        'Playwright browsers are not installed. Run: npx playwright install\n' +
          'Playwright is required for web/HTML vision mode.',
        { cause: err },
      )
    }
    throw err
  }
}

export async function startServer(html: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    // DeepCode ignore HttpToHttps: localhost-only ephemeral server for headless Playwright
    // DeepCode ignore XSS: html is served to a local headless browser, not to users
    const server = createServer((_, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(html)
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })
}

export async function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

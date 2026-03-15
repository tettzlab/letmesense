const mockClose = vi.fn().mockResolvedValue(undefined)
const mockScreenshot = vi.fn().mockResolvedValue(Buffer.from('png-screenshot'))
const mockGoto = vi.fn()
const mockInnerText = vi.fn().mockResolvedValue('Rendered body text')
const mockEvaluate = vi.fn()

// Default evaluate responses: lang, then dimensions
mockEvaluate.mockResolvedValueOnce('en').mockResolvedValueOnce({ width: 1280, height: 960 })

const mockNewPage = vi.fn().mockResolvedValue({
  goto: mockGoto,
  innerText: mockInnerText,
  evaluate: mockEvaluate,
  screenshot: mockScreenshot,
})

const mockNewContext = vi.fn().mockResolvedValue({
  newPage: mockNewPage,
})

const mockBrowser = {
  newContext: mockNewContext,
  close: mockClose,
}

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}))

import { renderWebPage, startServer, stopServer } from './playwrightSession.js'

describe('renderWebPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInnerText.mockResolvedValue('Rendered body text')
    mockEvaluate.mockResolvedValueOnce('en').mockResolvedValueOnce({ width: 1280, height: 960 })
    mockScreenshot.mockResolvedValue(Buffer.from('png-screenshot'))
  })

  it('navigates directly for URL input', async () => {
    const result = await renderWebPage({ url: 'https://example.com' })

    expect(mockGoto).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ waitUntil: 'networkidle' }),
    )
    expect(result.text).toBe('Rendered body text')
    expect(result.screenshotBuffer).toBeInstanceOf(Buffer)
    expect(result.language).toBe('en')
    expect(result.browser).toBe(mockBrowser)
  })

  it('starts local server for HTML input', async () => {
    const result = await renderWebPage({ html: '<html><body>Hello</body></html>' })

    // Should navigate to localhost URL
    expect(mockGoto).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\//),
      expect.anything(),
    )
    expect(result.text).toBe('Rendered body text')
  })

  it('returns correct dimensions with scale', async () => {
    const result = await renderWebPage({ url: 'https://example.com', scale: 3 })

    // 1280 * 3 = 3840, 960 * 3 = 2880
    expect(result.width).toBe(1280 * 3)
    expect(result.height).toBe(960 * 3)
  })

  it('clips height to maxHeight', async () => {
    mockEvaluate
      .mockReset()
      .mockResolvedValueOnce('en')
      .mockResolvedValueOnce({ width: 1280, height: 20000 })

    const result = await renderWebPage({
      url: 'https://example.com',
      maxHeight: 5000,
      scale: 1,
    })

    expect(result.height).toBe(5000)
    expect(mockScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({
        clip: expect.objectContaining({ height: 5000 }),
      }),
    )
  })

  it('respects custom viewport', async () => {
    await renderWebPage({
      url: 'https://example.com',
      viewportWidth: 800,
      viewportHeight: 600,
    })

    expect(mockNewContext).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: { width: 800, height: 600 },
      }),
    )
  })

  it('passes timeout to navigation', async () => {
    await renderWebPage({ url: 'https://example.com', timeout: 5000 })

    expect(mockGoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeout: 5000 }),
    )
  })

  it('throws when neither url nor html provided', async () => {
    await expect(renderWebPage({})).rejects.toThrow('requires either url or html')
  })

  it('closes browser on navigation error', async () => {
    mockGoto.mockRejectedValueOnce(new Error('Navigation failed'))

    await expect(renderWebPage({ url: 'https://example.com' })).rejects.toThrow('Navigation failed')
    expect(mockClose).toHaveBeenCalled()
  })
})

describe('startServer / stopServer', () => {
  it('starts and stops a local server', async () => {
    const { server, port } = await startServer('<html>test</html>')

    expect(port).toBeGreaterThan(0)
    expect(server).toBeDefined()

    await stopServer(server)
  })

  it('serves HTML content', async () => {
    const html = '<html><body>Hello</body></html>'
    const { server, port } = await startServer(html)

    try {
      const response = await fetch(`http://localhost:${port}/`)
      const body = await response.text()
      expect(body).toBe(html)
      expect(response.headers.get('content-type')).toContain('text/html')
    } finally {
      await stopServer(server)
    }
  })
})

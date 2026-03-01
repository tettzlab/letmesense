import { webPlugin } from './plugin.js'
import type { WebLoadedDocument, WebUnit } from './types.js'

// Inline HTML test data
const SIMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Test Page</title></head>
<body>
<h1>Hello World</h1>
<p>This is a <strong>test</strong> paragraph with a <a href="https://example.com">link</a>.</p>
<p>Second paragraph with an <img src="photo.jpg" alt="photo">.</p>
</body>
</html>`

const ARTICLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Article Title</title></head>
<body>
<nav>Navigation menu</nav>
<article>
<h1>Article Title</h1>
<p>By John Doe</p>
<p>This is the main article content. It has multiple paragraphs to ensure
Readability can extract it properly. The content needs to be long enough
for Readability to consider it as the main content of the page.</p>
<p>Here is another paragraph with more content. Readability uses heuristics
to determine what the main content is, so we need enough text here to
trigger proper extraction.</p>
<p>A third paragraph helps establish this as a real article with substantial
content that should be extracted by the readability algorithm.</p>
<ul>
<li>Item one</li>
<li>Item two</li>
<li>Item three</li>
</ul>
<table>
<tr><th>Name</th><th>Value</th></tr>
<tr><td>Foo</td><td>42</td></tr>
</table>
</article>
<footer>Footer content</footer>
</body>
</html>`

const EMPTY_HTML = `<!DOCTYPE html>
<html><head><title></title></head><body></body></html>`

const MINIMAL_HTML = `<html><body><p>Just text</p></body></html>`

const TABLE_ONLY_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Data Table</title></head>
<body>
<table>
<tr><th>Name</th><th>Value</th></tr>
<tr><td>Alpha</td><td>1</td></tr>
<tr><td>Beta</td><td>2</td></tr>
</table>
</body>
</html>`

const IMAGES_ONLY_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Gallery</title></head>
<body>
<img src="a.jpg" alt="a"><img src="b.jpg" alt="b">
</body>
</html>`

const MIXED_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Mixed</title></head>
<body>
<p>Some text content here.</p>
<img src="photo.jpg" alt="photo">
</body>
</html>`

describe('webPlugin', () => {
  describe('identity', () => {
    it('has correct id', () => {
      expect(webPlugin.id).toBe('html')
    })

    it('has correct extensions', () => {
      expect(webPlugin.extensions).toContain('.html')
      expect(webPlugin.extensions).toContain('.HTML')
      expect(webPlugin.extensions).toContain('.htm')
      expect(webPlugin.extensions).toContain('.HTM')
      expect(webPlugin.extensions).toContain('.xhtml')
      expect(webPlugin.extensions).toContain('.XHTML')
    })

    it('has correct mime types', () => {
      expect(webPlugin.mimeTypes).toContain('text/html')
      expect(webPlugin.mimeTypes).toContain('application/xhtml+xml')
    })

    it('has correct capabilities', () => {
      expect(webPlugin.capabilities.ocr).toBe(false)
      expect(webPlugin.capabilities.vision).toBe(false)
      expect(webPlugin.capabilities.streaming).toBe(false)
      expect(webPlugin.capabilities.parallel).toBe(false)
      expect(webPlugin.capabilities.supportsRuns).toBe(false)
      expect(webPlugin.capabilities.multiUnit).toBe(false)
    })
  })

  describe('load', () => {
    it('loads from Uint8Array', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)

      expect(doc.format).toBe('html')
      expect(doc.bytes).toBeInstanceOf(Uint8Array)
      expect(doc.bytes.length).toBeGreaterThan(0)
      expect((doc as WebLoadedDocument).html).toBe(SIMPLE_HTML)
      expect((doc as WebLoadedDocument).source).toBe('buffer')
    })

    it('loads from Buffer', async () => {
      const buf = Buffer.from(SIMPLE_HTML, 'utf-8')
      const doc = await webPlugin.load(buf)

      expect(doc.format).toBe('html')
      expect((doc as WebLoadedDocument).html).toBe(SIMPLE_HTML)
    })

    it('preserves sourceUrl when provided via options', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes, { sourceUrl: 'https://example.com/page.html' })
      const loaded = doc as WebLoadedDocument

      expect(loaded.source).toBe('https://example.com/page.html')
    })

    it('uses buffer as source when no sourceUrl provided', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      const loaded = doc as WebLoadedDocument

      expect(loaded.source).toBe('buffer')
    })
  })

  describe('parse', () => {
    it('creates single unit with metadata', async () => {
      const bytes = new TextEncoder().encode(ARTICLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)

      expect(parsed.units).toHaveLength(1)
      const unit = parsed.units[0] as WebUnit
      expect(unit.index).toBe(0)
      expect(unit.title).toBe('Article Title')
      expect(unit.htmlByteSize).toBeGreaterThan(0)
      expect(parsed.metadata?.title).toBe('Article Title')
    })

    it('uses doc.bytes.length for htmlByteSize', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const unit = parsed.units[0] as WebUnit

      expect(unit.htmlByteSize).toBe(bytes.length)
    })

    it('extracts title from <title> tag', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)

      expect(parsed.units).toHaveLength(1)
      expect((parsed.units[0] as WebUnit).title).toBe('Test Page')
    })

    it('handles empty HTML', async () => {
      const bytes = new TextEncoder().encode(EMPTY_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)

      expect(parsed.units).toHaveLength(1)
    })

    it('caches DOM results for reuse', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      await webPlugin.parse(doc)
      const loaded = doc as WebLoadedDocument

      expect(loaded.cached).toBeDefined()
      expect(loaded.cached?.textContent).toBeTruthy()
      expect(loaded.cached?.langAttr).toBe('en')
    })

    it('preserves URL in unit when source is http', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes, { sourceUrl: 'https://example.com/page' })
      const parsed = await webPlugin.parse(doc)
      const unit = parsed.units[0] as WebUnit

      expect(unit.url).toBe('https://example.com/page')
    })
  })

  describe('analyzeUnit', () => {
    it('detects language from html lang attribute', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const analyzed = await webPlugin.analyzeUnit(parsed.units[0], doc)

      expect(analyzed.language).toBe('en')
      expect(analyzed.charCount).toBeGreaterThan(0)
      expect(analyzed.textSample.length).toBeGreaterThan(0)
    })

    it('defaults to und when no lang attribute', async () => {
      const bytes = new TextEncoder().encode(MINIMAL_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const analyzed = await webPlugin.analyzeUnit(parsed.units[0], doc)

      expect(analyzed.language).toBe('und')
    })

    it('reuses cached DOM results from parse', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const loaded = doc as WebLoadedDocument

      // Verify cache is populated
      expect(loaded.cached).toBeDefined()

      const analyzed = await webPlugin.analyzeUnit(parsed.units[0], doc)
      expect(analyzed.charCount).toBeGreaterThan(0)
      expect(analyzed.language).toBe('en')
    })
  })

  describe('classifyUnit', () => {
    it('classifies text-only content', async () => {
      const bytes = new TextEncoder().encode(MINIMAL_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const kind = webPlugin.classifyUnit(parsed.units[0])

      expect(kind).toBe('text-only')
    })

    it('classifies empty content', async () => {
      const bytes = new TextEncoder().encode(EMPTY_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const kind = webPlugin.classifyUnit(parsed.units[0])

      expect(kind).toBe('empty')
    })

    it('classifies tabular content', async () => {
      const bytes = new TextEncoder().encode(TABLE_ONLY_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const kind = webPlugin.classifyUnit(parsed.units[0])

      expect(kind).toBe('tabular')
    })

    it('classifies mixed content (text + images)', async () => {
      const bytes = new TextEncoder().encode(MIXED_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const kind = webPlugin.classifyUnit(parsed.units[0])

      expect(kind).toBe('mixed')
    })

    it('classifies image-only content', async () => {
      const bytes = new TextEncoder().encode(IMAGES_ONLY_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const kind = webPlugin.classifyUnit(parsed.units[0])

      expect(kind).toBe('image-only')
    })
  })

  describe('extractUnit', () => {
    it('produces markdown output', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const result = await webPlugin.extractUnit(parsed.units[0], doc)

      expect(result.text).toContain('# Test Page')
      expect(result.text).toContain('Hello World')
      expect(result.text).toContain('**test**')
      expect(result.charCount).toBeGreaterThan(0)
      expect(result.extraction.method).toBe('digital')
      expect(result.extraction.reliability).toBe('high')
    })

    it('includes links by default', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const result = await webPlugin.extractUnit(parsed.units[0], doc)

      expect(result.text).toMatch(/\[link\]\(https:\/\/example\.com\/?/)
    })

    it('strips links when includeLinks=false', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const result = await webPlugin.extractUnit(parsed.units[0], doc, {
        includeLinks: false,
      })

      expect(result.text).not.toContain('[link](')
      expect(result.text).toContain('link')
    })

    it('strips images when includeImages=false', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const result = await webPlugin.extractUnit(parsed.units[0], doc, {
        includeImages: false,
      })

      expect(result.text).not.toContain('![')
      expect(result.text).not.toContain('photo.jpg')
    })

    it('includes images by default', async () => {
      const bytes = new TextEncoder().encode(SIMPLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const result = await webPlugin.extractUnit(parsed.units[0], doc)

      expect(result.text).toContain('photo')
    })

    it('handles empty HTML', async () => {
      const bytes = new TextEncoder().encode(EMPTY_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const result = await webPlugin.extractUnit(parsed.units[0], doc)

      expect(result.extraction.method).toBe('digital')
    })

    it('reuses cached Readability content', async () => {
      const bytes = new TextEncoder().encode(ARTICLE_HTML)
      const doc = await webPlugin.load(bytes)
      const parsed = await webPlugin.parse(doc)
      const loaded = doc as WebLoadedDocument

      // Verify cache has article content
      expect(loaded.cached?.article?.content).toBeTruthy()

      const result = await webPlugin.extractUnit(parsed.units[0], doc)
      expect(result.text).toContain('Article Title')
      expect(result.charCount).toBeGreaterThan(0)
    })
  })

  describe('getCliOptions', () => {
    it('returns --no-links and --no-images options', () => {
      const options = webPlugin.getCliOptions?.()
      expect(options).toBeDefined()
      const flags = options?.map((o) => o.flags)
      expect(flags).toContain('--no-links')
      expect(flags).toContain('--no-images')
    })

    it('does not set defaultValue for --no- options', () => {
      const options = webPlugin.getCliOptions?.()
      for (const opt of options ?? []) {
        expect(opt.defaultValue).toBeUndefined()
      }
    })
  })
})

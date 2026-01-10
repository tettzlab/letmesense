#!/usr/bin/env npx tsx

/**
 * Generate test fixture files for CLI tests.
 * Run with: npx tsx cli/fixtures/generate-fixtures.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import PDFDocument from 'pdfkit'
import * as XLSX from 'xlsx'

const FIXTURES_DIR = path.dirname(new URL(import.meta.url).pathname)

console.log('Generating test fixtures in:', FIXTURES_DIR)

// ============================================================================
// PDF - Born Digital
// ============================================================================
function generatePdf(): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument()
    const stream = fs.createWriteStream(path.join(FIXTURES_DIR, 'sample.pdf'))

    stream.on('finish', resolve)
    stream.on('error', reject)

    doc.pipe(stream)

    // Page 1
    doc.fontSize(24).text('Test PDF Document', { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text('This is a born-digital PDF for testing purposes.')
    doc.moveDown()
    doc.text('Features tested:')
    doc.list(['Text extraction', 'Multi-page support', 'Unicode: こんにちは 你好 🎉'])

    // Page 2
    doc.addPage()
    doc.fontSize(18).text('Page 2: Tables and Data')
    doc.moveDown()
    doc.fontSize(12).text('Name: John Doe')
    doc.text('Email: john@example.com')
    doc.text('Date: 2024-01-15')

    // Page 3
    doc.addPage()
    doc.fontSize(18).text('Page 3: Final Page')
    doc.moveDown()
    doc.text('This is the last page of the test document.')
    doc.text('End of document marker: [EOF]')

    doc.end()
  })
}

// ============================================================================
// XLSX - Spreadsheet with multiple sheets
// ============================================================================
function generateXlsx(): void {
  const workbook = XLSX.utils.book_new()

  // Sheet 1: Simple data with headers
  const sheet1Data = [
    ['Name', 'Age', 'City', 'Score'],
    ['Alice', 28, 'New York', 95.5],
    ['Bob', 34, 'Los Angeles', 87.2],
    ['Charlie', 22, 'Chicago', 91.8],
    ['Diana', 45, 'Houston', 78.3],
  ]
  const sheet1 = XLSX.utils.aoa_to_sheet(sheet1Data)
  XLSX.utils.book_append_sheet(workbook, sheet1, 'Users')

  // Sheet 2: Financial data
  const sheet2Data = [
    ['Quarter', 'Revenue', 'Expenses', 'Profit'],
    ['Q1 2024', 150000, 120000, 30000],
    ['Q2 2024', 175000, 130000, 45000],
    ['Q3 2024', 200000, 145000, 55000],
    ['Q4 2024', 225000, 160000, 65000],
  ]
  const sheet2 = XLSX.utils.aoa_to_sheet(sheet2Data)
  XLSX.utils.book_append_sheet(workbook, sheet2, 'Financials')

  // Sheet 3: Mixed content
  const sheet3Data = [
    ['Description', 'Value', 'Notes'],
    ['Unicode Test', 'こんにちは', 'Japanese greeting'],
    ['Special Chars', '<>&"\'', 'XML entities'],
    ['Numbers', 12345.67, 'Decimal value'],
    ['Empty Cell', null, 'Has null'],
  ]
  const sheet3 = XLSX.utils.aoa_to_sheet(sheet3Data)
  XLSX.utils.book_append_sheet(workbook, sheet3, 'MixedContent')

  XLSX.writeFile(workbook, path.join(FIXTURES_DIR, 'sample.xlsx'))
}

// ============================================================================
// DOCX - Word Document (minimal valid structure)
// ============================================================================
function generateDocx(): void {
  const zip = new AdmZip()

  // [Content_Types].xml
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
  )

  // _rels/.rels
  zip.addFile(
    '_rels/.rels',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
  )

  // word/document.xml
  zip.addFile(
    'word/document.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Test DOCX Document</w:t></w:r></w:p>
    <w:p><w:r><w:t>This is a test Word document for CLI testing.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Paragraph 1: Lorem ipsum dolor sit amet, consectetur adipiscing elit.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Paragraph 2: Testing special characters: &lt;&gt;&amp;"'</w:t></w:r></w:p>
    <w:p><w:r><w:t>Paragraph 3: Unicode support: こんにちは 你好 مرحبا</w:t></w:r></w:p>
    <w:p><w:r><w:t>End of document marker: [EOF]</w:t></w:r></w:p>
  </w:body>
</w:document>`),
  )

  zip.writeZip(path.join(FIXTURES_DIR, 'sample.docx'))
}

// ============================================================================
// PPTX - PowerPoint (minimal valid structure)
// ============================================================================
function generatePptx(): void {
  const zip = new AdmZip()

  // [Content_Types].xml
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`),
  )

  // _rels/.rels
  zip.addFile(
    '_rels/.rels',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`),
  )

  // ppt/presentation.xml
  zip.addFile(
    'ppt/presentation.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
  </p:sldIdLst>
</p:presentation>`),
  )

  // ppt/_rels/presentation.xml.rels
  zip.addFile(
    'ppt/_rels/presentation.xml.rels',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`),
  )

  // ppt/slides/slide1.xml
  zip.addFile(
    'ppt/slides/slide1.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:t>Slide 1: Test Presentation</a:t></a:r></a:p>
          <a:p><a:r><a:t>This is the first slide content.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`),
  )

  // ppt/slides/slide2.xml
  zip.addFile(
    'ppt/slides/slide2.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:t>Slide 2: More Content</a:t></a:r></a:p>
          <a:p><a:r><a:t>Unicode: こんにちは 你好</a:t></a:r></a:p>
          <a:p><a:r><a:t>End marker: [EOF]</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`),
  )

  zip.writeZip(path.join(FIXTURES_DIR, 'sample.pptx'))
}

/**
 * Set mimetype entry to STORED (uncompressed) - required for valid OpenDocument files.
 */
function setMimetypeUncompressed(zip: AdmZip): void {
  const mimetypeEntry = zip.getEntries().find((e) => e.entryName === 'mimetype')
  if (mimetypeEntry) {
    mimetypeEntry.header.method = 0 // STORED (no compression)
  }
}

// ============================================================================
// ODT - OpenDocument Text (with full required structure)
// ============================================================================
function generateOdt(): void {
  const zip = new AdmZip()

  // mimetype must be first and uncompressed
  zip.addFile('mimetype', Buffer.from('application/vnd.oasis.opendocument.text'))

  zip.addFile(
    'META-INF/manifest.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`),
  )

  zip.addFile(
    'meta.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2">
  <office:meta>
    <dc:title>Test ODT Document</dc:title>
  </office:meta>
</office:document-meta>`),
  )

  zip.addFile(
    'styles.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2">
</office:document-styles>`),
  )

  zip.addFile(
    'content.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body>
    <office:text>
      <text:p>Test ODT Document</text:p>
      <text:p>This is a test OpenDocument Text file for CLI testing.</text:p>
      <text:p>Paragraph with special chars: &lt;&gt;&amp;</text:p>
      <text:p>Unicode: こんにちは 你好 مرحبا</text:p>
      <text:p>End marker: [EOF]</text:p>
    </office:text>
  </office:body>
</office:document-content>`),
  )

  setMimetypeUncompressed(zip)
  zip.writeZip(path.join(FIXTURES_DIR, 'sample.odt'))
}

// ============================================================================
// ODP - OpenDocument Presentation (with full required structure)
// ============================================================================
function generateOdp(): void {
  const zip = new AdmZip()

  zip.addFile('mimetype', Buffer.from('application/vnd.oasis.opendocument.presentation'))

  zip.addFile(
    'META-INF/manifest.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.presentation"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`),
  )

  zip.addFile(
    'meta.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2">
  <office:meta>
    <dc:title>Test ODP Presentation</dc:title>
  </office:meta>
</office:document-meta>`),
  )

  zip.addFile(
    'styles.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2">
</office:document-styles>`),
  )

  zip.addFile(
    'content.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" office:version="1.2">
  <office:body>
    <office:presentation>
      <draw:page draw:name="Slide1">
        <draw:frame><draw:text-box><text:p>Slide 1: Test ODP Presentation</text:p></draw:text-box></draw:frame>
        <draw:frame><draw:text-box><text:p>First slide content here.</text:p></draw:text-box></draw:frame>
      </draw:page>
      <draw:page draw:name="Slide2">
        <draw:frame><draw:text-box><text:p>Slide 2: More Content</text:p></draw:text-box></draw:frame>
        <draw:frame><draw:text-box><text:p>Unicode: こんにちは 你好</text:p></draw:text-box></draw:frame>
        <draw:frame><draw:text-box><text:p>End marker: [EOF]</text:p></draw:text-box></draw:frame>
      </draw:page>
    </office:presentation>
  </office:body>
</office:document-content>`),
  )

  setMimetypeUncompressed(zip)
  zip.writeZip(path.join(FIXTURES_DIR, 'sample.odp'))
}

// ============================================================================
// ODS - OpenDocument Spreadsheet (with full required structure)
// ============================================================================
function generateOds(): void {
  const zip = new AdmZip()

  zip.addFile('mimetype', Buffer.from('application/vnd.oasis.opendocument.spreadsheet'))

  zip.addFile(
    'META-INF/manifest.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`),
  )

  zip.addFile(
    'meta.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2">
  <office:meta>
    <dc:title>Test ODS Spreadsheet</dc:title>
  </office:meta>
</office:document-meta>`),
  )

  zip.addFile(
    'styles.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2">
</office:document-styles>`),
  )

  zip.addFile(
    'content.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body>
    <office:spreadsheet>
      <table:table table:name="Sheet1">
        <table:table-row>
          <table:table-cell><text:p>Name</text:p></table:table-cell>
          <table:table-cell><text:p>Value</text:p></table:table-cell>
          <table:table-cell><text:p>Notes</text:p></table:table-cell>
        </table:table-row>
        <table:table-row>
          <table:table-cell><text:p>Alpha</text:p></table:table-cell>
          <table:table-cell><text:p>100</text:p></table:table-cell>
          <table:table-cell><text:p>First row</text:p></table:table-cell>
        </table:table-row>
        <table:table-row>
          <table:table-cell><text:p>Beta</text:p></table:table-cell>
          <table:table-cell><text:p>200</text:p></table:table-cell>
          <table:table-cell><text:p>Second row</text:p></table:table-cell>
        </table:table-row>
        <table:table-row>
          <table:table-cell><text:p>Unicode</text:p></table:table-cell>
          <table:table-cell><text:p>こんにちは</text:p></table:table-cell>
          <table:table-cell><text:p>Japanese</text:p></table:table-cell>
        </table:table-row>
      </table:table>
      <table:table table:name="Sheet2">
        <table:table-row>
          <table:table-cell><text:p>Data</text:p></table:table-cell>
          <table:table-cell><text:p>in</text:p></table:table-cell>
          <table:table-cell><text:p>Sheet2</text:p></table:table-cell>
        </table:table-row>
      </table:table>
    </office:spreadsheet>
  </office:body>
</office:document-content>`),
  )

  setMimetypeUncompressed(zip)
  zip.writeZip(path.join(FIXTURES_DIR, 'sample.ods'))
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  // Create fixtures directory if needed
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true })
  }

  console.log('Generating PDF...')
  await generatePdf()
  console.log('  ✓ sample.pdf')

  console.log('Generating XLSX...')
  generateXlsx()
  console.log('  ✓ sample.xlsx')

  console.log('Generating DOCX...')
  generateDocx()
  console.log('  ✓ sample.docx')

  console.log('Generating PPTX...')
  generatePptx()
  console.log('  ✓ sample.pptx')

  console.log('Generating ODT...')
  generateOdt()
  console.log('  ✓ sample.odt')

  console.log('Generating ODP...')
  generateOdp()
  console.log('  ✓ sample.odp')

  console.log('Generating ODS...')
  generateOds()
  console.log('  ✓ sample.ods')

  console.log('\nAll fixtures generated successfully!')
}

main().catch(console.error)

#!/usr/bin/env npx tsx

/**
 * Generate test fixture files for CLI tests.
 * Run with: npx tsx lib/office/fixtures/generate-fixtures.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'

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
async function generateXlsx(): Promise<void> {
  const workbook = new ExcelJS.Workbook()

  // Sheet 1: Simple data with headers
  const sheet1 = workbook.addWorksheet('Users')
  sheet1.addRows([
    ['Name', 'Age', 'City', 'Score'],
    ['Alice', 28, 'New York', 95.5],
    ['Bob', 34, 'Los Angeles', 87.2],
    ['Charlie', 22, 'Chicago', 91.8],
    ['Diana', 45, 'Houston', 78.3],
  ])

  // Sheet 2: Financial data
  const sheet2 = workbook.addWorksheet('Financials')
  sheet2.addRows([
    ['Quarter', 'Revenue', 'Expenses', 'Profit'],
    ['Q1 2024', 150000, 120000, 30000],
    ['Q2 2024', 175000, 130000, 45000],
    ['Q3 2024', 200000, 145000, 55000],
    ['Q4 2024', 225000, 160000, 65000],
  ])

  // Sheet 3: Mixed content
  const sheet3 = workbook.addWorksheet('MixedContent')
  sheet3.addRows([
    ['Description', 'Value', 'Notes'],
    ['Unicode Test', 'こんにちは', 'Japanese greeting'],
    ['Special Chars', '<>&"\'', 'XML entities'],
    ['Numbers', 12345.67, 'Decimal value'],
    ['Empty Cell', null, 'Has null'],
  ])

  await workbook.xlsx.writeFile(path.join(FIXTURES_DIR, 'sample.xlsx'))
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

  const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const NS_OREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

  // [Content_Types].xml
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`),
  )

  // _rels/.rels
  zip.addFile(
    '_rels/.rels',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_REL}">
  <Relationship Id="rId1" Type="${NS_OREL}/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`),
  )

  // ppt/presentation.xml — references slides, master, and presProps
  zip.addFile(
    'ppt/presentation.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`),
  )

  // ppt/_rels/presentation.xml.rels
  zip.addFile(
    'ppt/_rels/presentation.xml.rels',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_REL}">
  <Relationship Id="rId1" Type="${NS_OREL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="${NS_OREL}/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="${NS_OREL}/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId4" Type="${NS_OREL}/presProps" Target="presProps.xml"/>
  <Relationship Id="rId5" Type="${NS_OREL}/theme" Target="theme/theme1.xml"/>
</Relationships>`),
  )

  // ppt/presProps.xml — presentation properties
  zip.addFile(
    'ppt/presProps.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`),
  )

  // ppt/theme/theme1.xml — minimal theme
  zip.addFile(
    'ppt/theme/theme1.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test">
  <a:themeElements>
    <a:clrScheme name="Test">
      <a:dk1><a:srgbClr val="000000"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Test">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Test">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`),
  )

  // ppt/slideMasters/slideMaster1.xml — slide master referencing theme and layout
  zip.addFile(
    'ppt/slideMasters/slideMaster1.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"
            accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"
            hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>`),
  )

  // ppt/slideMasters/_rels/slideMaster1.xml.rels
  zip.addFile(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_REL}">
  <Relationship Id="rId1" Type="${NS_OREL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="${NS_OREL}/theme" Target="../theme/theme1.xml"/>
</Relationships>`),
  )

  // ppt/slideLayouts/slideLayout1.xml — blank layout
  zip.addFile(
    'ppt/slideLayouts/slideLayout1.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`),
  )

  // ppt/slideLayouts/_rels/slideLayout1.xml.rels
  zip.addFile(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_REL}">
  <Relationship Id="rId1" Type="${NS_OREL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`),
  )

  // ppt/slides/slide1.xml — now references slideLayout
  zip.addFile(
    'ppt/slides/slide1.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
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

  // ppt/slides/_rels/slide1.xml.rels
  zip.addFile(
    'ppt/slides/_rels/slide1.xml.rels',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_REL}">
  <Relationship Id="rId1" Type="${NS_OREL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`),
  )

  // ppt/slides/slide2.xml
  zip.addFile(
    'ppt/slides/slide2.xml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
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

  // ppt/slides/_rels/slide2.xml.rels
  zip.addFile(
    'ppt/slides/_rels/slide2.xml.rels',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_REL}">
  <Relationship Id="rId1" Type="${NS_OREL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`),
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
  await generateXlsx()
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

export { main as generate }

// Self-execute when run directly
const scriptArg = process.argv[1]
if (scriptArg && import.meta.url === `file://${path.resolve(scriptArg)}`) {
  main().catch(console.error)
}

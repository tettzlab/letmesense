import {
  type ContentNode,
  countCharsInNodes,
  countImagesInNodes,
  extractTextFromNodes,
  findNodesByType,
  getTableData,
  walkContentNodes,
} from './parser.js'

describe('walkContentNodes', () => {
  it('yields all nodes including children', () => {
    const nodes: ContentNode[] = [
      {
        type: 'paragraph',
        text: 'Parent',
        children: [
          { type: 'text', text: 'Child 1' },
          { type: 'text', text: 'Child 2' },
        ],
      },
    ]

    const result = [...walkContentNodes(nodes)]
    expect(result).toHaveLength(3)
    expect(result[0].text).toBe('Parent')
    expect(result[1].text).toBe('Child 1')
    expect(result[2].text).toBe('Child 2')
  })

  it('handles deeply nested nodes', () => {
    const nodes: ContentNode[] = [
      {
        type: 'section',
        text: 'Level 1',
        children: [
          {
            type: 'paragraph',
            text: 'Level 2',
            children: [{ type: 'text', text: 'Level 3' }],
          },
        ],
      },
    ]

    const result = [...walkContentNodes(nodes)]
    expect(result).toHaveLength(3)
    expect(result.map((n) => n.text)).toEqual(['Level 1', 'Level 2', 'Level 3'])
  })

  it('handles empty children array', () => {
    const nodes: ContentNode[] = [{ type: 'paragraph', text: 'Leaf', children: [] }]

    const result = [...walkContentNodes(nodes)]
    expect(result).toHaveLength(1)
  })
})

describe('extractTextFromNodes', () => {
  it('extracts text from simple nodes', () => {
    const nodes: ContentNode[] = [
      { type: 'paragraph', text: 'Hello' },
      { type: 'paragraph', text: 'World' },
    ]

    expect(extractTextFromNodes(nodes)).toBe('Hello\nWorld')
  })

  it('skips leaf text nodes to avoid duplication', () => {
    // This is the key test for the bug fix
    // Parent nodes have combined text, children have individual fragments
    const nodes: ContentNode[] = [
      {
        type: 'heading',
        text: 'AWS re:Invent 2021',
        children: [
          { type: 'text', text: 'AWS ' },
          { type: 'text', text: 're:Invent' },
          { type: 'text', text: ' 2021' },
        ],
      },
    ]

    const result = extractTextFromNodes(nodes)
    // Should only include the parent text, not child fragments
    expect(result).toBe('AWS re:Invent 2021')
    // Should NOT contain duplicated text
    expect(result.match(/AWS/g)).toHaveLength(1)
  })

  it('extracts text from multiple paragraphs with children', () => {
    const nodes: ContentNode[] = [
      {
        type: 'paragraph',
        text: 'First paragraph',
        children: [{ type: 'text', text: 'First paragraph' }],
      },
      {
        type: 'paragraph',
        text: 'Second paragraph',
        children: [{ type: 'text', text: 'Second paragraph' }],
      },
    ]

    const result = extractTextFromNodes(nodes)
    expect(result).toBe('First paragraph\nSecond paragraph')
    // Each paragraph text appears exactly once
    expect(result.match(/First paragraph/g)).toHaveLength(1)
    expect(result.match(/Second paragraph/g)).toHaveLength(1)
  })

  it('handles list items correctly', () => {
    const nodes: ContentNode[] = [
      {
        type: 'list',
        text: 'Item 1',
        children: [{ type: 'text', text: 'Item 1' }],
      },
      {
        type: 'list',
        text: 'Item 2',
        children: [{ type: 'text', text: 'Item 2' }],
      },
    ]

    const result = extractTextFromNodes(nodes)
    expect(result).toBe('Item 1\nItem 2')
  })

  it('uses custom delimiter', () => {
    const nodes: ContentNode[] = [
      { type: 'paragraph', text: 'Line 1' },
      { type: 'paragraph', text: 'Line 2' },
    ]

    expect(extractTextFromNodes(nodes, ' | ')).toBe('Line 1 | Line 2')
  })

  it('skips nodes without text', () => {
    const nodes: ContentNode[] = [
      { type: 'paragraph', text: 'Has text' },
      { type: 'image', text: '' },
      { type: 'paragraph', text: 'Also has text' },
    ]

    expect(extractTextFromNodes(nodes)).toBe('Has text\nAlso has text')
  })

  it('trims whitespace from text', () => {
    const nodes: ContentNode[] = [
      { type: 'paragraph', text: '  Padded  ' },
      { type: 'paragraph', text: '\n\nNewlines\n\n' },
    ]

    expect(extractTextFromNodes(nodes)).toBe('Padded\nNewlines')
  })

  it('skips whitespace-only text', () => {
    const nodes: ContentNode[] = [
      { type: 'paragraph', text: 'Content' },
      { type: 'paragraph', text: '   ' },
      { type: 'paragraph', text: 'More content' },
    ]

    expect(extractTextFromNodes(nodes)).toBe('Content\nMore content')
  })

  it('handles slides with multiple content types', () => {
    // Simulates real PPTX structure
    const nodes: ContentNode[] = [
      {
        type: 'slide',
        text: '',
        children: [
          {
            type: 'heading',
            text: 'Slide Title',
            children: [{ type: 'text', text: 'Slide Title' }],
          },
          {
            type: 'paragraph',
            text: 'Bullet point 1',
            children: [{ type: 'text', text: 'Bullet point 1' }],
          },
          {
            type: 'paragraph',
            text: 'Bullet point 2',
            children: [{ type: 'text', text: 'Bullet point 2' }],
          },
        ],
      },
    ]

    const result = extractTextFromNodes(nodes)
    expect(result).toBe('Slide Title\nBullet point 1\nBullet point 2')
    // No duplication
    expect(result.match(/Slide Title/g)).toHaveLength(1)
  })
})

describe('findNodesByType', () => {
  it('finds nodes of specified type', () => {
    const nodes: ContentNode[] = [
      { type: 'paragraph', text: 'Para 1' },
      { type: 'heading', text: 'Heading' },
      { type: 'paragraph', text: 'Para 2' },
    ]

    const paragraphs = findNodesByType(nodes, 'paragraph')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs.map((n) => n.text)).toEqual(['Para 1', 'Para 2'])
  })

  it('finds nested nodes', () => {
    const nodes: ContentNode[] = [
      {
        type: 'section',
        text: '',
        children: [{ type: 'image', text: 'Image 1' }],
      },
      { type: 'image', text: 'Image 2' },
    ]

    const images = findNodesByType(nodes, 'image')
    expect(images).toHaveLength(2)
  })

  it('returns empty array when no matches', () => {
    const nodes: ContentNode[] = [{ type: 'paragraph', text: 'Text' }]

    expect(findNodesByType(nodes, 'table')).toHaveLength(0)
  })
})

describe('countCharsInNodes', () => {
  it('counts characters excluding whitespace', () => {
    const nodes: ContentNode[] = [{ type: 'paragraph', text: 'Hello World' }]

    // 'Hello World' without spaces = 'HelloWorld' = 10 chars
    expect(countCharsInNodes(nodes)).toBe(10)
  })

  it('counts chars in nested nodes', () => {
    const nodes: ContentNode[] = [
      {
        type: 'paragraph',
        text: 'AB',
        children: [{ type: 'text', text: 'CD' }],
      },
    ]

    // Leaf text nodes are skipped to avoid double-counting; only parent paragraph text counted
    expect(countCharsInNodes(nodes)).toBe(2)
  })

  it('returns 0 for empty nodes', () => {
    const nodes: ContentNode[] = []
    expect(countCharsInNodes(nodes)).toBe(0)
  })
})

describe('countImagesInNodes', () => {
  it('counts image nodes', () => {
    const nodes: ContentNode[] = [
      { type: 'image', text: 'img1' },
      { type: 'paragraph', text: 'text' },
      { type: 'image', text: 'img2' },
    ]

    expect(countImagesInNodes(nodes)).toBe(2)
  })

  it('counts nested images', () => {
    const nodes: ContentNode[] = [
      {
        type: 'paragraph',
        text: '',
        children: [{ type: 'image', text: 'nested' }],
      },
    ]

    expect(countImagesInNodes(nodes)).toBe(1)
  })

  it('returns 0 when no images', () => {
    const nodes: ContentNode[] = [{ type: 'paragraph', text: 'text' }]

    expect(countImagesInNodes(nodes)).toBe(0)
  })
})

describe('getTableData', () => {
  it('extracts table data as 2D array', () => {
    const table: ContentNode = {
      type: 'table',
      text: '',
      children: [
        {
          type: 'row',
          text: '',
          children: [
            { type: 'cell', text: 'A1' },
            { type: 'cell', text: 'B1' },
          ],
        },
        {
          type: 'row',
          text: '',
          children: [
            { type: 'cell', text: 'A2' },
            { type: 'cell', text: 'B2' },
          ],
        },
      ],
    }

    const data = getTableData(table)
    expect(data).toEqual([
      ['A1', 'B1'],
      ['A2', 'B2'],
    ])
  })

  it('parses numeric values', () => {
    const table: ContentNode = {
      type: 'table',
      text: '',
      children: [
        {
          type: 'row',
          text: '',
          children: [
            { type: 'cell', text: '42' },
            { type: 'cell', text: '3.14' },
          ],
        },
      ],
    }

    const data = getTableData(table)
    expect(data).toEqual([[42, 3.14]])
  })

  it('parses boolean values', () => {
    const table: ContentNode = {
      type: 'table',
      text: '',
      children: [
        {
          type: 'row',
          text: '',
          children: [
            { type: 'cell', text: 'true' },
            { type: 'cell', text: 'FALSE' },
          ],
        },
      ],
    }

    const data = getTableData(table)
    expect(data).toEqual([[true, false]])
  })

  it('returns null for empty cells', () => {
    const table: ContentNode = {
      type: 'table',
      text: '',
      children: [
        {
          type: 'row',
          text: '',
          children: [
            { type: 'cell', text: '' },
            { type: 'cell', text: 'value' },
          ],
        },
      ],
    }

    const data = getTableData(table)
    expect(data).toEqual([[null, 'value']])
  })

  it('returns empty array for table without rows', () => {
    const table: ContentNode = { type: 'table', text: '' }

    expect(getTableData(table)).toEqual([])
  })
})

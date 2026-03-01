import { textItemsToString } from './text.js'

describe('textItemsToString', () => {
  it('extracts str properties from items', () => {
    const items = [{ str: 'Hello' }, { str: 'World' }]
    expect(textItemsToString(items)).toBe('Hello World')
  })

  it('handles empty array', () => {
    expect(textItemsToString([])).toBe('')
  })

  it('handles items without str property', () => {
    const items = [{ other: 'value' }, { foo: 'bar' }]
    expect(textItemsToString(items)).toBe('')
  })

  it('handles null and undefined items', () => {
    const items = [null, undefined, { str: 'test' }]
    expect(textItemsToString(items as unknown[])).toBe('test')
  })

  it('handles items with non-string str property', () => {
    const items = [{ str: 123 }, { str: null }, { str: 'valid' }]
    expect(textItemsToString(items as unknown[])).toBe('valid')
  })

  it('normalizes whitespace', () => {
    const items = [{ str: 'Hello  ' }, { str: '  World' }, { str: '  test  ' }]
    expect(textItemsToString(items)).toBe('Hello World test')
  })

  it('trims leading and trailing whitespace', () => {
    const items = [{ str: '  ' }, { str: 'Hello' }, { str: '  ' }]
    expect(textItemsToString(items)).toBe('Hello')
  })

  it('handles mixed valid and invalid items', () => {
    const items = [
      { str: 'First' },
      null,
      { str: 'Second' },
      { notStr: 'ignored' },
      { str: 123 },
      { str: 'Third' },
    ]
    expect(textItemsToString(items as unknown[])).toBe('First Second Third')
  })

  it('handles items with empty strings', () => {
    const items = [{ str: '' }, { str: 'Hello' }, { str: '' }]
    expect(textItemsToString(items)).toBe('Hello')
  })

  it('handles newlines and tabs as whitespace', () => {
    const items = [{ str: 'Hello\n' }, { str: '\tWorld' }]
    expect(textItemsToString(items)).toBe('Hello World')
  })
})

import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPathResolver } from './path.js'

describe('path utilities', () => {
  const isWindows = os.platform() === 'win32'

  describe('createPathResolver', () => {
    it('resolves relative paths within root', () => {
      const rootDir = '/workspace'
      const resolve = createPathResolver(rootDir)

      expect(resolve('file.txt')).toBe(path.join(rootDir, 'file.txt'))
      expect(resolve('./file.txt')).toBe(path.join(rootDir, 'file.txt'))
      expect(resolve('foo/bar/baz.txt')).toBe(path.join(rootDir, 'foo/bar/baz.txt'))
    })

    it('allows accessing the root directory itself', () => {
      const rootDir = '/workspace'
      const resolve = createPathResolver(rootDir)

      expect(resolve('.')).toBe(rootDir)
      expect(resolve('')).toBe(rootDir)
    })

    it('resolves nested paths correctly', () => {
      const rootDir = '/workspace'
      const resolve = createPathResolver(rootDir)

      expect(resolve('./foo/bar/../baz.txt')).toBe(path.join(rootDir, 'foo/baz.txt'))
    })

    describe('security - directory traversal protection', () => {
      it.each([
        { desc: 'simple parent traversal', input: '../etc/passwd' },
        { desc: 'multiple parent traversal', input: '../../../etc/passwd' },
        { desc: 'parent from subdirectory', input: 'foo/../../etc/passwd' },
        { desc: 'absolute path', input: '/etc/passwd' },
      ])('throws error for $desc', ({ input }) => {
        const rootDir = '/workspace'
        const resolve = createPathResolver(rootDir)

        expect(() => resolve(input)).toThrow('Path escapes rootDir')
      })
    })

    describe('edge cases', () => {
      it('handles single dot correctly', () => {
        const rootDir = '/workspace'
        const resolve = createPathResolver(rootDir)

        expect(resolve('.')).toBe(rootDir)
      })

      it('handles double dot at root', () => {
        const rootDir = '/workspace'
        const resolve = createPathResolver(rootDir)

        expect(() => resolve('..')).toThrow('Path escapes rootDir')
      })

      it('handles paths with spaces', () => {
        const rootDir = '/workspace'
        const resolve = createPathResolver(rootDir)

        expect(resolve('my folder/my file.txt')).toBe(path.join(rootDir, 'my folder/my file.txt'))
      })

      it('handles paths with special characters', () => {
        const rootDir = '/workspace'
        const resolve = createPathResolver(rootDir)

        expect(resolve('foo@bar#baz$.txt')).toBe(path.join(rootDir, 'foo@bar#baz$.txt'))
      })
    })

    if (!isWindows) {
      describe('Unix-specific paths', () => {
        it('resolves forward slash paths', () => {
          const rootDir = '/workspace'
          const resolve = createPathResolver(rootDir)

          expect(resolve('foo/bar/baz.txt')).toBe('/workspace/foo/bar/baz.txt')
        })

        it('rejects absolute paths starting with /', () => {
          const rootDir = '/workspace'
          const resolve = createPathResolver(rootDir)

          expect(() => resolve('/etc/passwd')).toThrow('Path escapes rootDir')
        })
      })
    }
  })
})

/**
 * Path resolution and validation utilities.
 *
 * Provides safe path resolution that prevents directory traversal attacks
 * by ensuring all resolved paths stay within a designated root directory.
 */

import path from 'node:path'

/**
 * Create a path resolver bound to a root directory.
 * All resolved paths are guaranteed to be within the root.
 *
 * @param rootDir - The root directory to constrain paths within
 * @returns A function that resolves relative paths safely
 * @throws Error if the resolved path would escape the root directory
 */
export function createPathResolver(rootDir: string) {
  const resolvedRoot = path.resolve(rootDir)

  return function resolveInRoot(p: string): string {
    const abs = path.resolve(resolvedRoot, p)
    // Prevent escaping the workspace root via .. traversal (does not resolve symlinks)
    if (!abs.startsWith(resolvedRoot + path.sep) && abs !== resolvedRoot) {
      throw new Error(`Path escapes rootDir: ${p} (resolved: ${abs}, root: ${resolvedRoot})`)
    }
    return abs
  }
}

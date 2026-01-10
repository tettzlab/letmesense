import { defineConfig } from 'vitest/config'
import { baseTestConfig, coverageConfig, defaultExclude, plugins } from './vitest.shared'

/**
 * Default vitest configuration - fast tests for regular development.
 * Excludes CLI tests (spawn subprocesses) and vision tests (require LibreOffice + API keys).
 *
 * Usage:
 *   pnpm test          → fast lib tests
 *   pnpm test:cov      → fast lib tests with coverage
 *   pnpm test:full     → all tests (vitest.full.config.ts)
 *   pnpm test:full:cov → all tests with coverage
 */
export default defineConfig({
  plugins,
  test: {
    ...baseTestConfig,
    include: ['lib/**/*.test.ts'],
    exclude: [...defaultExclude, 'lib/office/vision/**/*.test.ts'],
    testTimeout: 10000,
    coverage: coverageConfig,
  },
})

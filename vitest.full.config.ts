import { defineConfig } from 'vitest/config'
import { baseTestConfig, coverageConfig, defaultExclude, plugins } from './vitest.shared'

/**
 * Full vitest configuration - comprehensive tests for CI/validation.
 * Includes all tests: CLI, lib, and vision tests.
 *
 * Usage:
 *   pnpm test:full     → all tests
 *   pnpm test:full:cov → all tests with coverage
 */
export default defineConfig({
  plugins,
  test: {
    ...baseTestConfig,
    include: ['cli/**/*.test.ts', 'lib/**/*.test.ts'],
    exclude: defaultExclude,
    coverage: coverageConfig,
  },
})

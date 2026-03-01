/**
 * Shared vitest settings used across all test configurations.
 * Centralizes common options to avoid duplication.
 */

export const baseTestConfig = {
  globals: true,
  pool: 'threads' as const,
  clearMocks: true,
  restoreMocks: true,
  maxThreads: 4,
  minThreads: 1,
  env: {
    LOG_LEVEL: 'silent',
    MODELS_FILE: './models.json',
  },
}

export const defaultExclude = ['**/node_modules/**', '**/.git/**']

export const coverageConfig = {
  enabled: false,
  provider: 'v8' as const,
  reporter: ['text', 'html', 'lcov'],
  reportsDirectory: './coverage',
  include: ['cli/**/*.ts', 'lib/**/*.ts'],
  exclude: ['**/*.test.ts', '**/*.d.ts'],
  thresholds: {
    lines: 60,
    functions: 60,
    branches: 50,
    statements: 60,
  },
}

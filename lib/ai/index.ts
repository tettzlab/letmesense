/**
 * AI Module - Client-safe exports
 *
 * This file contains client-safe exports (types, constants, utilities).
 * For server-only exports (registry, stream wrappers), use `index.server.ts`.
 */

// Config exports (types and getter functions)
// Resolve utilities
export {
  _resetRegistryCache,
  buildProviderOptions,
  type FlatModel,
  getDefaultProvider,
  getFlatModels,
  getFreeTierModels,
  getFreeTierModelsByProvider,
  getModelAliases,
  getModelRegistry,
  getModelSpecExamples,
  getModels,
  getProviderChoices,
  getProviderRegistry,
  getProviders,
  initModelRegistry,
  isFreeTierModel,
  type JsonValue,
  type ModelRegistryInit,
  modelSupportsPdf,
  modelSupportsVision,
  type ParsedModelSpec,
  ParseModelSpecError,
  type ProviderId,
  type ProviderOptions,
  parseModelSpec,
  type ResolvedModel,
  ResolveModelError,
  type ResolveModelErrorCode,
  resolveModelSpec,
  TOKEN_LIMITS,
} from './config.js'
// Cost utilities
export { formatCostWarning } from './cost.js'
// Model registry types
export type { ModelCapabilities, ReasoningConfig, TemperatureConfig } from './models.js'

// Provider utilities
export {
  buildConfig,
  detectProvider,
  getAllProviders,
  getProvider,
  registerProvider,
  resolveModelId,
  resolveProvider,
} from './provider.js'
// Retry utilities (pure JS, no server dependencies)
export {
  calculateDelay,
  classifyError,
  DEFAULT_RETRY_CONFIG,
  type ErrorCategory,
  extractRetryAfter,
  type RetryConfig,
  type RetryResult,
  sleep,
  withRetry,
  withTimeout,
} from './retry.js'

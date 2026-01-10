/**
 * LLM-specific error types with helpful messages
 */

/** Base error for LLM operations */
export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider?: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

/** Error when API key is missing or invalid */
export class ApiKeyError extends LlmError {
  constructor(provider: string, cause?: Error) {
    const envVar = getEnvVarName(provider)
    super(
      `${provider} API key not found or invalid.\n\n` +
        `To fix this:\n` +
        `  1. Set the ${envVar} environment variable:\n` +
        `     export ${envVar}=your-api-key\n\n` +
        `  2. Or pass the key directly in config:\n` +
        `     { llm: { apiKey: 'your-api-key' } }\n\n` +
        `Get your API key at: ${getApiKeyUrl(provider)}`,
      'API_KEY_MISSING',
      provider,
      cause,
    )
    this.name = 'ApiKeyError'
  }
}

/** Error when rate limited by the API */
export class RateLimitError extends LlmError {
  constructor(
    provider: string,
    public readonly retryAfter?: number,
    cause?: Error,
  ) {
    const retryMessage = retryAfter ? ` Retry after ${retryAfter} seconds.` : ''
    super(
      `${provider} rate limit exceeded.${retryMessage}\n\n` +
        `This error is automatically retried with exponential backoff.\n` +
        `If it persists, consider:\n` +
        `  - Reducing request frequency\n` +
        `  - Upgrading your API tier\n` +
        `  - Using a different model`,
      'RATE_LIMITED',
      provider,
      cause,
    )
    this.name = 'RateLimitError'
  }
}

/** Error when model is not found or unavailable */
export class ModelNotFoundError extends LlmError {
  constructor(provider: string, model: string, availableModels?: string[], cause?: Error) {
    const availableMsg = availableModels?.length
      ? `\n\nAvailable models: ${availableModels.join(', ')}`
      : ''
    super(
      `Model '${model}' not found for ${provider}.${availableMsg}\n\n` +
        `Check that:\n` +
        `  - The model name is spelled correctly\n` +
        `  - Your API key has access to this model\n` +
        `  - The model is available in your region`,
      'MODEL_NOT_FOUND',
      provider,
      cause,
    )
    this.name = 'ModelNotFoundError'
  }
}

/** Error when context length is exceeded */
export class ContextLengthError extends LlmError {
  constructor(provider: string, tokenCount: number, maxTokens: number, cause?: Error) {
    super(
      `Content too long for ${provider} model (${tokenCount} tokens, max ${maxTokens}).\n\n` +
        `To fix this:\n` +
        `  - Use a model with larger context (e.g., gpt-5.2, claude-sonnet-4)\n` +
        `  - Process fewer pages at once\n` +
        `  - Reduce the text content being formatted`,
      'CONTEXT_LENGTH_EXCEEDED',
      provider,
      cause,
    )
    this.name = 'ContextLengthError'
  }
}

/** Error when provider is not available */
export class ProviderUnavailableError extends LlmError {
  constructor(provider: string, reason?: string, cause?: Error) {
    super(
      `${provider} provider is not available${reason ? `: ${reason}` : ''}.\n\n` +
        `To fix this:\n` +
        getProviderSetupInstructions(provider),
      'PROVIDER_UNAVAILABLE',
      provider,
      cause,
    )
    this.name = 'ProviderUnavailableError'
  }
}

/** Error when network request fails */
export class NetworkError extends LlmError {
  constructor(provider: string, cause?: Error) {
    super(
      `Failed to connect to ${provider} API.\n\n` +
        `Check your network connection and try again.\n` +
        `If the issue persists, the API may be experiencing issues.`,
      'NETWORK_ERROR',
      provider,
      cause,
    )
    this.name = 'NetworkError'
  }
}

/** Error when request times out */
export class TimeoutError extends LlmError {
  constructor(provider: string, timeoutMs: number, cause?: Error) {
    super(
      `${provider} request timed out after ${Math.round(timeoutMs / 1000)} seconds.\n\n` +
        `To fix this:\n` +
        `  - Increase timeout with { llm: { timeout: 120000 } }\n` +
        `  - Process fewer pages at once\n` +
        `  - Use a faster model (e.g., gpt-5-nano)`,
      'TIMEOUT',
      provider,
      cause,
    )
    this.name = 'TimeoutError'
  }
}

/** Get environment variable name for a provider */
function getEnvVarName(provider: string): string {
  switch (provider.toLowerCase()) {
    case 'openai':
      return 'OPENAI_API_KEY'
    case 'anthropic':
      return 'ANTHROPIC_API_KEY'
    case 'google':
      return 'GOOGLE_GENERATIVE_AI_API_KEY'
    case 'ollama':
      return 'OLLAMA_HOST'
    default:
      return `${provider.toUpperCase()}_API_KEY`
  }
}

/** Get API key signup URL for a provider */
function getApiKeyUrl(provider: string): string {
  switch (provider.toLowerCase()) {
    case 'openai':
      return 'https://platform.openai.com/api-keys'
    case 'anthropic':
      return 'https://console.anthropic.com/settings/keys'
    case 'google':
      return 'https://aistudio.google.com/apikey'
    case 'ollama':
      return 'https://ollama.ai (local installation)'
    default:
      return 'provider documentation'
  }
}

/** Get setup instructions for a provider */
function getProviderSetupInstructions(provider: string): string {
  switch (provider.toLowerCase()) {
    case 'openai':
      return (
        `  1. Get an API key at https://platform.openai.com/api-keys\n` +
        `  2. Set OPENAI_API_KEY environment variable`
      )
    case 'anthropic':
      return (
        `  1. Get an API key at https://console.anthropic.com/settings/keys\n` +
        `  2. Set ANTHROPIC_API_KEY environment variable`
      )
    case 'google':
      return (
        `  1. Get an API key at https://aistudio.google.com/apikey\n` +
        `  2. Set GOOGLE_GENERATIVE_AI_API_KEY environment variable`
      )
    case 'ollama':
      return (
        `  1. Install Ollama: https://ollama.ai\n` +
        `  2. Start Ollama: ollama serve\n` +
        `  3. Pull a model: ollama pull llama3.2\n` +
        `  4. (Optional) Set OLLAMA_HOST if not using localhost:11434`
      )
    default:
      return `  See provider documentation for setup instructions`
  }
}

/**
 * Parse an API error and return a more helpful error type
 */
export function parseApiError(error: unknown, provider: string): LlmError {
  if (error instanceof LlmError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  const cause = error instanceof Error ? error : undefined

  // Check for specific error patterns
  if (/api.?key|unauthorized|401|authentication/i.test(message)) {
    return new ApiKeyError(provider, cause)
  }

  if (/rate.?limit|too.?many.?requests|429/i.test(message)) {
    const retryMatch = message.match(/retry.?after[:\s]+(\d+)/i)
    const retryAfter = retryMatch ? parseInt(retryMatch[1], 10) : undefined
    return new RateLimitError(provider, retryAfter, cause)
  }

  if (/model.*not.?found|model.*does.?not.?exist|404/i.test(message)) {
    const modelMatch = message.match(/model[:\s]+['"]?([^\s'"]+)/i)
    const model = modelMatch ? modelMatch[1] : 'unknown'
    return new ModelNotFoundError(provider, model, undefined, cause)
  }

  if (/context.?length|token.?limit|too.?long/i.test(message)) {
    const tokenMatch = message.match(/(\d+)\s*tokens/i)
    const maxMatch = message.match(/max(?:imum)?[:\s]+(\d+)/i)
    const tokens = tokenMatch ? parseInt(tokenMatch[1], 10) : 0
    const maxTokens = maxMatch ? parseInt(maxMatch[1], 10) : 0
    return new ContextLengthError(provider, tokens, maxTokens, cause)
  }

  if (/timeout|ETIMEDOUT/i.test(message)) {
    // Try to extract timeout duration from message, default to 60s
    const timeoutMatch = message.match(/(\d+)\s*(?:ms|milliseconds?)/i)
    const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) : 60000
    return new TimeoutError(provider, timeoutMs, cause)
  }

  if (/network|ECONNREFUSED|ECONNRESET|ENOTFOUND/i.test(message)) {
    return new NetworkError(provider, cause)
  }

  // Generic error with original message
  return new LlmError(`${provider} API error: ${message}`, 'API_ERROR', provider, cause)
}

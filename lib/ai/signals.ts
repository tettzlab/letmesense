/** AI/LLM span and metric names. */

export const Spans = {
  FORMAT: 'ai.format',
  FORMAT_PAGE: 'ai.format.page',
  RETRY: 'ai.retry',
} as const

export const Metrics = {
  REQUEST_COUNT: 'ai.request.count',
  REQUEST_DURATION_MS: 'ai.request.duration_ms',
  TOKEN_INPUT_COUNT: 'ai.token.input.count',
  TOKEN_OUTPUT_COUNT: 'ai.token.output.count',
  COST_USD: 'ai.cost.usd',
  COST_TOTAL_USD: 'ai.cost.total.usd',

  // Retry
  RETRY_ATTEMPT_COUNT: 'ai.retry.attempt.count',
  RETRY_SUCCESS_COUNT: 'ai.retry.success.count',
  RETRY_FAILURE_COUNT: 'ai.retry.failure.count',
  RETRY_EXHAUSTED_COUNT: 'ai.retry.exhausted.count',
  RETRY_TOTAL_DELAY_MS: 'ai.retry.total_delay_ms',

  ERROR_COUNT: 'ai.error.count',
} as const

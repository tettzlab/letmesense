/** Condense (map-reduce) span and metric names. */

export const Spans = {
  RUN: 'condense.run',
  MAP: 'condense.map',
  REDUCE: 'condense.reduce',
  LLM: 'condense.llm',
} as const

export const Metrics = {
  RUN_COUNT: 'condense.run.count',
  RUN_DURATION_MS: 'condense.run.duration_ms',
  MAP_CHUNK_COUNT: 'condense.map.chunk.count',
  REDUCE_DEPTH: 'condense.reduce.depth',
  TOKEN_INPUT_COUNT: 'condense.token.input.count',
  TOKEN_OUTPUT_COUNT: 'condense.token.output.count',
  COST_USD: 'condense.cost.usd',
  ERROR_COUNT: 'condense.error.count',
} as const

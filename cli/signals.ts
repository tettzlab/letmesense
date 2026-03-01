/** CLI span and metric names. */

export const Spans = {
  COMMAND: 'cli.command',
  CONDENSE: 'cli.condense',
} as const

export const Metrics = {
  COMMAND_COUNT: 'cli.command.count',
  DURATION_MS: 'cli.duration_ms',
} as const

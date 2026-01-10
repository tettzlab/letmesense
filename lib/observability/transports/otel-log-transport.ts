/**
 * Pino transport that bridges logs to OpenTelemetry Logs API.
 *
 * Receives Pino log records via stream and forwards them to
 * the global LoggerProvider for OTLP export.
 */
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import build from 'pino-abstract-transport'

/**
 * Map Pino log levels to OTEL severity numbers.
 */
const PINO_TO_OTEL_SEVERITY: Record<number, SeverityNumber> = {
  10: SeverityNumber.TRACE, // pino: trace
  20: SeverityNumber.DEBUG, // pino: debug
  30: SeverityNumber.INFO, // pino: info
  40: SeverityNumber.WARN, // pino: warn
  50: SeverityNumber.ERROR, // pino: error
  60: SeverityNumber.FATAL, // pino: fatal
}

/**
 * Map Pino level numbers to text.
 */
const PINO_LEVEL_TEXT: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

/**
 * Sanitize attributes for OTEL (remove undefined, convert types).
 */
function sanitizeAttributes(
  attrs: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    } else {
      // Stringify complex objects
      result[key] = JSON.stringify(value)
    }
  }

  return result
}

/**
 * Pino transport that forwards logs to OpenTelemetry.
 *
 * Usage in Pino config:
 * ```typescript
 * transport: {
 *   targets: [{
 *     target: './transports/otel-log-transport.js',
 *     level: 'info',
 *   }]
 * }
 * ```
 */
export default async function otelLogTransport() {
  return build(async (source) => {
    const logger = logs.getLogger('pino-otel-bridge')

    for await (const obj of source) {
      const { level, time, msg, ...attributes } = obj as {
        level: number
        time: number
        msg: string
        [key: string]: unknown
      }

      logger.emit({
        severityNumber: PINO_TO_OTEL_SEVERITY[level] ?? SeverityNumber.INFO,
        severityText: PINO_LEVEL_TEXT[level] ?? 'INFO',
        body: msg,
        timestamp: time * 1_000_000, // Pino uses ms, OTEL expects nanoseconds
        attributes: sanitizeAttributes(attributes),
      })
    }
  })
}

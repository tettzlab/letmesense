import pino from 'pino'
import type { ObservabilityFactory, Span } from '../lib/observability/index.js'

/**
 * Minimal observability factory for CLI use: logs to stderr only, no-op spans/metrics.
 * Used when OTEL_EXPORTER_OTLP_ENDPOINT is not configured.
 */
export function createNoopObservabilityFactory(service: string): ObservabilityFactory {
  const stderrLogger = pino(
    {
      level: process.env.LOG_LEVEL ?? 'warn',
      base: { service },
    },
    pino.destination({ dest: 2, sync: true }), // fd 2 = stderr
  )

  return {
    async init() {},
    async shutdown() {},
    create(domain: string) {
      return {
        logger: stderrLogger.child({ domain }),
        tracer: {
          async startSpan<T>(_name: string, fn: (span: Span) => Promise<T>): Promise<T> {
            const span: Span = {
              setAttribute() {},
              setAttributes() {},
              recordException() {},
              setError() {},
              addEvent() {},
              end() {},
            }
            return fn(span)
          },
        },
        metrics: {
          counter() {
            return { add() {} }
          },
          histogram() {
            return { record() {} }
          },
          gauge() {
            return {
              set() {},
              get() {
                return 0
              },
            }
          },
        },
      }
    },
  }
}

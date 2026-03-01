/**
 * Tests for observability module.
 *
 * Tests the unified observability interface (logger, tracer, metrics)
 * and factory pattern for creating observability contexts.
 */

// Reset module state between tests
let obsModule: typeof import('./index.js')

describe('observability module', () => {
  beforeEach(async () => {
    // Reset modules to get fresh singleton state
    vi.resetModules()
    obsModule = await import('./index.js')
  })

  afterEach(async () => {
    // Clean up any initialized factory
    await obsModule.shutdownObservability()
  })

  describe('createObservability', () => {
    it('creates PinoOtelObservabilityFactory when telemetry enabled', () => {
      const factory = obsModule.createObservability({
        service: 'test-service',
        environment: 'test',
        telemetryEnabled: true,
      })

      expect(factory).toBeInstanceOf(obsModule.PinoOtelObservabilityFactory)
    })

    it('creates ConsoleObservabilityFactory when telemetry disabled', () => {
      const factory = obsModule.createObservability({
        service: 'test-service',
        environment: 'test',
        telemetryEnabled: false,
      })

      expect(factory).toBeInstanceOf(obsModule.ConsoleObservabilityFactory)
    })
  })

  describe('obs() function', () => {
    it('returns observability context with logger, tracer, and metrics', () => {
      const context = obsModule.obs('test-domain')

      expect(context).toHaveProperty('logger')
      expect(context).toHaveProperty('tracer')
      expect(context).toHaveProperty('metrics')
    })

    it('creates child logger with domain', () => {
      const context = obsModule.obs('my-domain')

      // Logger should be a Pino logger with domain binding
      expect(typeof context.logger.info).toBe('function')
      expect(typeof context.logger.error).toBe('function')
      expect(typeof context.logger.child).toBe('function')
    })

    it('returns same tracer and metrics for different domains', () => {
      const context1 = obsModule.obs('domain1')
      const context2 = obsModule.obs('domain2')

      // Tracer and metrics are shared (singleton factory)
      expect(context1.tracer).toBe(context2.tracer)
      expect(context1.metrics).toBe(context2.metrics)
    })
  })

  describe('tracer', () => {
    it('startSpan executes callback and returns result', async () => {
      const { tracer } = obsModule.obs('test')

      const result = await tracer.startSpan('test.operation', async (span) => {
        span.setAttribute('key', 'value')
        return 'completed'
      })

      expect(result).toBe('completed')
    })

    it('startSpan works with sync callbacks', async () => {
      const { tracer } = obsModule.obs('test')

      const result = await tracer.startSpan('test.sync', (span) => {
        span.setAttribute('sync', true)
        return 42
      })

      expect(result).toBe(42)
    })

    it('span supports all interface methods', async () => {
      const { tracer } = obsModule.obs('test')

      await tracer.startSpan('test.methods', (span) => {
        // All these should not throw
        span.setAttribute('string', 'value')
        span.setAttribute('number', 123)
        span.setAttribute('boolean', true)
        span.setAttributes({ a: 'A', b: 2 })
        span.addEvent('event.name', { detail: 'info' })
        span.setError('error message')
        span.recordException(new Error('test error'))
        // end() is called automatically
      })
    })
  })

  describe('metrics (noop - default factory)', () => {
    // Default factory from env is ConsoleObservabilityFactory which uses NoopMetrics
    // NoopMetrics doesn't store values - these tests verify the API works without throwing

    it('counter add does not throw', () => {
      const { metrics } = obsModule.obs('test')

      const counter = metrics.counter('test.counter')
      // Should not throw
      counter.add(1)
      counter.add(5)
      counter.add(1, { label: 'value' })
    })

    it('histogram record does not throw', () => {
      const { metrics } = obsModule.obs('test')

      const histogram = metrics.histogram('test.histogram')
      // Should not throw
      histogram.record(100)
      histogram.record(250, { operation: 'read' })
    })

    it('gauge set/get works (returns 0 for noop)', () => {
      const { metrics } = obsModule.obs('test')

      const gauge = metrics.gauge('test.gauge')

      gauge.set(42)
      // NoopMetrics.gauge().get() always returns 0
      expect(gauge.get()).toBe(0)
    })
  })

  describe('SemanticAttributes', () => {
    it('exports SemanticAttributes constants', () => {
      expect(obsModule.SemanticAttributes.MODEL).toBe('model')
      expect(obsModule.SemanticAttributes.INPUT_TOKENS).toBe('input.tokens')
      expect(obsModule.SemanticAttributes.DURATION_MS).toBe('duration_ms')
    })
  })

  describe('factory lifecycle', () => {
    it('initObservability is idempotent', async () => {
      await obsModule.initObservability()
      await obsModule.initObservability() // Second call should be no-op
      // Should not throw
    })

    it('shutdownObservability cleans up', async () => {
      await obsModule.initObservability()
      await obsModule.shutdownObservability()
      // Can re-initialize after shutdown
      await obsModule.initObservability()
    })
  })
})

describe('ConsoleObservabilityFactory', () => {
  it('creates observability with noop tracer and metrics', () => {
    const factory = new obsModule.ConsoleObservabilityFactory({
      service: 'test',
      logLevel: 'info',
    })

    const context = factory.create('domain')

    expect(context.logger).toBeDefined()
    expect(context.tracer).toBeDefined()
    expect(context.metrics).toBeDefined()
  })

  it('init and shutdown are no-ops', async () => {
    const factory = new obsModule.ConsoleObservabilityFactory({
      service: 'test',
    })

    // Should not throw
    await factory.init()
    await factory.shutdown()
  })
})

describe('PinoOtelObservabilityFactory', () => {
  let factory: InstanceType<typeof obsModule.PinoOtelObservabilityFactory>

  beforeEach(async () => {
    factory = new obsModule.PinoOtelObservabilityFactory({
      service: 'test-otel',
      environment: 'test',
      telemetryEnabled: true,
    })
    await factory.init()
  })

  afterEach(async () => {
    await factory.shutdown()
  })

  it('creates observability context with real implementations', () => {
    const context = factory.create('domain')

    expect(context.logger).toBeDefined()
    expect(context.tracer).toBeDefined()
    expect(context.metrics).toBeDefined()
  })

  describe('metrics with real adapter', () => {
    it('gauge stores and retrieves values', () => {
      const { metrics } = factory.create('test')

      const gauge = metrics.gauge('real.gauge')
      gauge.set(42)
      expect(gauge.get()).toBe(42)

      gauge.set(100)
      expect(gauge.get()).toBe(100)
    })

    it('gauge supports labels', () => {
      const { metrics } = factory.create('test')

      const gauge = metrics.gauge('real.labeled.gauge')

      // Set values with different labels
      gauge.set(10, { region: 'us' })
      gauge.set(20, { region: 'eu' })
      gauge.set(5) // unlabeled

      // get() returns unlabeled value
      expect(gauge.get()).toBe(5)
    })

    it('returns same counter/histogram/gauge instance for same name', () => {
      const { metrics } = factory.create('test')

      const counter1 = metrics.counter('same.counter')
      const counter2 = metrics.counter('same.counter')
      expect(counter1).toBe(counter2)

      const hist1 = metrics.histogram('same.histogram')
      const hist2 = metrics.histogram('same.histogram')
      expect(hist1).toBe(hist2)

      const gauge1 = metrics.gauge('same.gauge')
      const gauge2 = metrics.gauge('same.gauge')
      expect(gauge1).toBe(gauge2)
    })

    it('counter and histogram accept labels', () => {
      const { metrics } = factory.create('test')

      // Should not throw
      metrics.counter('test.counter').add(1, { region: 'us' })
      metrics.histogram('test.histogram').record(100, { operation: 'read' })
    })
  })

  describe('tracer with real adapter', () => {
    it('startSpan executes callback and returns result', async () => {
      const { tracer } = factory.create('test')

      const result = await tracer.startSpan('test.operation', async (span) => {
        span.setAttribute('key', 'value')
        return 'completed'
      })

      expect(result).toBe('completed')
    })

    it('startSpan propagates errors', async () => {
      const { tracer } = factory.create('test')

      await expect(
        tracer.startSpan('test.error', async () => {
          throw new Error('test error')
        }),
      ).rejects.toThrow('test error')
    })
  })
})

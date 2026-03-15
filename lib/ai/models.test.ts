import {
  getDefaultEncoding,
  getModel,
  getModelOrThrow,
  getModelPricing,
  getModelRegistry,
  getModelsByProvider,
  getProviderConfig,
  getProviderRegistry,
  resolveModelAlias,
} from './models.js'

describe('models.json loading', () => {
  it('loads providers and models from JSON', () => {
    expect(getProviderRegistry().length).toBeGreaterThan(0)
    expect(getModelRegistry().length).toBeGreaterThan(0)
  })
})

describe('getProviderConfig', () => {
  it('returns config for known provider', () => {
    const cfg = getProviderConfig('openai')
    expect(cfg.id).toBe('openai')
    expect(cfg.name).toBe('OpenAI')
    expect(cfg.defaultModel).toBeTruthy()
  })

  it('throws for unknown provider', () => {
    expect(() => getProviderConfig('fakeprovider' as 'openai')).toThrow('Unknown provider')
  })
})

describe('getModel', () => {
  it('returns model for known ID', () => {
    const model = getModel('gpt-5-mini')
    expect(model).toBeDefined()
    expect(model?.provider).toBe('openai')
  })

  it('returns undefined for unknown ID', () => {
    expect(getModel('nonexistent')).toBeUndefined()
  })
})

describe('getModelOrThrow', () => {
  it('throws for unknown model', () => {
    expect(() => getModelOrThrow('nonexistent')).toThrow('Unknown model')
  })
})

describe('getModelsByProvider', () => {
  it('returns all models for a provider', () => {
    const models = getModelsByProvider('openai')
    expect(models.length).toBeGreaterThan(0)
    for (const m of models) {
      expect(m.provider).toBe('openai')
    }
  })
})

describe('resolveModelAlias', () => {
  it('resolves known alias', () => {
    expect(resolveModelAlias('openai', 'mini')).toBe('gpt-5-mini')
  })

  it('returns input for unknown alias', () => {
    expect(resolveModelAlias('openai', 'unknown-model')).toBe('unknown-model')
  })
})

describe('getModelPricing', () => {
  it('returns model pricing for known model', () => {
    const pricing = getModelPricing('gpt-5-mini')
    expect(pricing.input).toBe(0.25)
    expect(pricing.output).toBe(2.0)
  })

  it('returns conservative default pricing for unknown model', () => {
    const pricing = getModelPricing('unknown-model')
    expect(pricing.input).toBe(1.0)
    expect(pricing.output).toBe(4.0)
    expect(pricing.image).toBe(0.5)
  })
})

describe('getDefaultEncoding', () => {
  it('derives encoding from provider default model', () => {
    expect(getDefaultEncoding('openai')).toBe('o200k_base')
    expect(getDefaultEncoding('anthropic')).toBe('claude')
    expect(getDefaultEncoding('google')).toBe('gemini')
    expect(getDefaultEncoding('ollama')).toBe('llama3')
    expect(getDefaultEncoding('azure')).toBe('o200k_base')
  })
})

describe('azure provider', () => {
  it('returns provider config', () => {
    const cfg = getProviderConfig('azure')
    expect(cfg.id).toBe('azure')
    expect(cfg.name).toBe('Azure OpenAI')
    expect(cfg.defaultModel).toBe('gpt-5-mini')
  })

  it('returns azure model list', () => {
    expect(getModelsByProvider('azure')).toHaveLength(4)
  })

  it('passes through unknown alias as-is', () => {
    expect(resolveModelAlias('azure', 'my-deployment')).toBe('my-deployment')
  })
})

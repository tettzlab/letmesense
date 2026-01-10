import { describe, expect, it } from 'vitest'
import {
  getDefaultEncoding,
  getModel,
  getModelOrThrow,
  getModelPricing,
  getModelsByProvider,
  getProviderConfig,
  MODEL_REGISTRY,
  PROVIDER_REGISTRY,
  resolveModelAlias,
} from './models.js'

describe('models.json loading', () => {
  it('loads providers from JSON', () => {
    expect(PROVIDER_REGISTRY.length).toBeGreaterThan(0)
    const ids = PROVIDER_REGISTRY.map((p) => p.id)
    expect(ids).toContain('openai')
    expect(ids).toContain('anthropic')
    expect(ids).toContain('google')
    expect(ids).toContain('ollama')
  })

  it('loads models from JSON', () => {
    expect(MODEL_REGISTRY.length).toBeGreaterThan(0)
    const ids = MODEL_REGISTRY.map((m) => m.id)
    expect(ids).toContain('gpt-5-mini')
    expect(ids).toContain('claude-opus-4-5')
    expect(ids).toContain('gemini-3-flash-preview')
  })

  it('models have temperature config under capabilities', () => {
    const model = getModel('claude-sonnet-4-5')
    expect(model?.capabilities?.temperature).toBeDefined()
    expect(model?.capabilities?.temperature?.min).toBe(0)
  })

  it('OpenAI GPT-5 models have no temperature config', () => {
    expect(getModel('gpt-5.2')?.capabilities?.temperature).toBeUndefined()
    expect(getModel('gpt-5-mini')?.capabilities?.temperature).toBeUndefined()
    expect(getModel('gpt-5-nano')?.capabilities?.temperature).toBeUndefined()
  })

  it('models have reasoning config or absent under capabilities', () => {
    const mini = getModel('gpt-5-mini')
    expect(mini?.capabilities?.reasoning).toBeDefined()
    expect(mini?.capabilities?.reasoning?.levels).toContain('medium')

    const gpt = getModel('gpt-5.2')
    expect(gpt?.capabilities?.reasoning).toBeDefined()
    expect(gpt?.capabilities?.reasoning?.default).toBe('none')
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
    expect(() => getProviderConfig('azure' as 'openai')).toThrow('Unknown provider')
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

  it('returns zero pricing for unknown model', () => {
    const pricing = getModelPricing('unknown-model')
    expect(pricing.input).toBe(0)
    expect(pricing.output).toBe(0)
  })
})

describe('getDefaultEncoding', () => {
  it('derives encoding from provider default model', () => {
    expect(getDefaultEncoding('openai')).toBe('o200k_base')
    expect(getDefaultEncoding('anthropic')).toBe('claude')
    expect(getDefaultEncoding('google')).toBe('gemini')
    expect(getDefaultEncoding('ollama')).toBe('llama3')
  })
})

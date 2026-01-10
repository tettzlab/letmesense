import { describe, expect, it } from 'vitest'
import { buildProviderOptions } from './providerOptions.js'
import { resolveModel } from './resolve.js'

describe('buildProviderOptions', () => {
  it('returns undefined when no effort', () => {
    const resolved = resolveModel('ollama:llama3.3')
    expect(buildProviderOptions(resolved)).toBeUndefined()
  })

  it('returns undefined when effort is "none"', () => {
    const resolved = resolveModel('openai:gpt-5.2')
    expect(resolved.effort).toBe('none')
    expect(buildProviderOptions(resolved)).toBeUndefined()
  })

  it('returns undefined for ollama (no reasoning mapping)', () => {
    const resolved = resolveModel('ollama:llama3.3')
    expect(buildProviderOptions(resolved)).toBeUndefined()
  })

  describe('OpenAI', () => {
    it('maps effort to reasoningEffort', () => {
      const resolved = resolveModel('openai:mini:medium')
      const opts = buildProviderOptions(resolved)
      expect(opts).toEqual({ openai: { reasoningEffort: 'medium' } })
    })

    it('maps low effort', () => {
      const resolved = resolveModel('openai:mini:low')
      const opts = buildProviderOptions(resolved)
      expect(opts).toEqual({ openai: { reasoningEffort: 'low' } })
    })

    it('maps high effort', () => {
      const resolved = resolveModel('openai:mini:high')
      const opts = buildProviderOptions(resolved)
      expect(opts).toEqual({ openai: { reasoningEffort: 'high' } })
    })
  })

  describe('Anthropic', () => {
    it('maps effort to thinking budget', () => {
      const resolved = resolveModel('anthropic:opus:medium')
      const opts = buildProviderOptions(resolved)
      expect(opts).toBeDefined()
      expect(opts?.anthropic?.thinking).toBeDefined()
      const thinking = opts?.anthropic?.thinking as { type: string; budgetTokens: number }
      expect(thinking.type).toBe('enabled')
      expect(thinking.budgetTokens).toBeGreaterThan(0)
    })

    it('scales budget with effort level', () => {
      const low = resolveModel('anthropic:opus:low')
      const high = resolveModel('anthropic:opus:high')
      const lowOpts = buildProviderOptions(low)
      const highOpts = buildProviderOptions(high)
      const lowBudget = (lowOpts?.anthropic?.thinking as { budgetTokens: number }).budgetTokens
      const highBudget = (highOpts?.anthropic?.thinking as { budgetTokens: number }).budgetTokens
      expect(highBudget).toBeGreaterThan(lowBudget)
    })
  })

  describe('Google', () => {
    it('maps effort to thinkingConfig', () => {
      const resolved = resolveModel('google:flash:medium')
      const opts = buildProviderOptions(resolved)
      expect(opts).toBeDefined()
      expect(opts?.google?.thinkingConfig).toBeDefined()
      const config = opts?.google?.thinkingConfig as { thinkingLevel: string }
      expect(config.thinkingLevel).toBe('MEDIUM')
    })

    it('maps minimal effort', () => {
      const resolved = resolveModel('google:flash:minimal')
      const opts = buildProviderOptions(resolved)
      const config = opts?.google?.thinkingConfig as { thinkingLevel: string }
      expect(config.thinkingLevel).toBe('MINIMAL')
    })

    it('maps high effort', () => {
      const resolved = resolveModel('google:flash:high')
      const opts = buildProviderOptions(resolved)
      const config = opts?.google?.thinkingConfig as { thinkingLevel: string }
      expect(config.thinkingLevel).toBe('HIGH')
    })
  })
})

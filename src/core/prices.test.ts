import { describe, expect, it } from 'bun:test'
import { priceOf } from './prices'

describe('priceOf', () => {
  it('gives each model’s US dollars per million bytes of text', () => {
    const now = new Date('2026-10-24T12:00:00Z')
    expect(priceOf('s2.1-pro-free', now)).toBe(0)
    expect(priceOf('s2.1-pro', now)).toBe(15)
    expect(priceOf('s2-pro', now)).toBe(15)
  })

  it('keeps a promotion until the moment it ends', () => {
    expect(priceOf('drama-3', new Date('2026-11-12T16:59:59Z'))).toBe(10)
    expect(priceOf('drama-3', new Date('2026-11-12T17:00:00Z'))).toBe(50)
  })

  it('knows no price for a model it does not list', () => {
    expect(priceOf('brand-new', new Date())).toBeUndefined()
  })
})

import { describe, expect, it } from 'bun:test'
import { agreedBody, agreedOf, credits, elevenPlanFacts, payWords, planPayWords } from './agreed'

describe('agreedOf', () => {
  it('asks for dollars rounded up to the cent, or credits rounded up to the whole', () => {
    expect(agreedOf({ reason: 'confirm', ceiling: 0.0151 })).toEqual({ unit: 'usd', amount: 0.02 })
    expect(agreedOf({ reason: 'confirm-credits', ceiling: 14.5 })).toEqual({
      unit: 'credits',
      amount: 15,
    })
  })

  it('asks nothing for any other answer', () => {
    expect(agreedOf({ reason: 'credits' })).toBeNull()
    expect(agreedOf({ reason: 'fish' })).toBeNull()
  })
})

describe('the words and body of an agreed amount', () => {
  it('pays dollars and uses credits, and sends each as its own field', () => {
    expect(payWords({ unit: 'usd', amount: 0.02 })).toBe('Pay up to $0.02')
    expect(payWords({ unit: 'credits', amount: 1200 })).toBe('Use up to 1,200 credits')
    expect(agreedBody({ unit: 'usd', amount: 0.02 })).toEqual({ confirmedCost: 0.02 })
    expect(agreedBody({ unit: 'credits', amount: 15 })).toEqual({ confirmedCredits: 15 })
  })

  it('says credits as a person would', () => {
    expect(credits(1)).toBe('1 credit')
    expect(credits(27450)).toBe('27,450 credits')
    expect(credits(Infinity)).toBe('credits without limit')
  })
})

describe('planPayWords', () => {
  it('names what a plan pays in each unit it pays in', () => {
    expect(planPayWords(0.42, 0)).toBe('Pay up to $0.42')
    expect(planPayWords(0, 1200)).toBe('Use up to 1,200 credits')
    expect(planPayWords(0.42, 1200)).toBe('Pay up to $0.42 and 1,200 credits')
  })
})

describe('elevenPlanFacts', () => {
  const eleven = { keys: ['a'], model: 'eleven_v3', characters: 1234, credits: 1234, ceiling: 3702 }
  const account = {
    tier: 'starter',
    charactersUsed: 2550,
    characterLimit: 30000,
    renewsAt: null,
    overage: 0,
    voiceSlots: { used: 0, limit: 10 },
  }
  it('says what the ElevenLabs lines take and what the plan has left', () => {
    expect(elevenPlanFacts(eleven, { ok: true, account })).toBe(
      'ElevenLabs · eleven_v3 · 1,234 characters of text · about 1,234 credits, at most 3,702 credits · 27,450 credits left on your plan',
    )
  })

  it('leaves out what running recordings hold', () => {
    expect(elevenPlanFacts(eleven, { ok: true, account }, 25000)).toBe(
      'ElevenLabs · eleven_v3 · 1,234 characters of text · about 1,234 credits, at most 3,702 credits · only 2,450 credits left on your plan, besides what recordings and auditions running now hold',
    )
  })

  it('says when the plan has not enough left, or what is left is unknown', () => {
    expect(
      elevenPlanFacts(eleven, { ok: true, account: { ...account, charactersUsed: 28000 } }),
    ).toBe(
      'ElevenLabs · eleven_v3 · 1,234 characters of text · about 1,234 credits, at most 3,702 credits · only 2,000 credits left on your plan',
    )
    expect(elevenPlanFacts(eleven, { ok: false, reason: 'no-key', message: 'Set the key.' })).toBe(
      'ElevenLabs · eleven_v3 · 1,234 characters of text · about 1,234 credits, at most 3,702 credits · what is left on your plan is unknown: Set the key.',
    )
  })
})

import { describe, expect, it } from 'bun:test'
import { createBudget, spendProblem } from './spend'

describe('spendProblem', () => {
  it('lets a free job go without anything confirmed', () => {
    expect(spendProblem({ ceiling: 0 })).toBeNull()
  })

  it('asks to confirm a paid job, and lets it go once its ceiling is confirmed and covered', () => {
    expect(spendProblem({ ceiling: 0.42, credit: 10 })).toMatchObject({
      reason: 'confirm',
      ceiling: 0.42,
    })
    expect(spendProblem({ ceiling: 0.42, confirmed: 0.41, credit: 10 })).toMatchObject({
      reason: 'confirm',
    })
    expect(spendProblem({ ceiling: 0.42, confirmed: 0.42, credit: 10 })).toBeNull()
  })

  it('takes a confirmation a rounding hair below the ceiling, as cents round it', () => {
    const ceiling = (3500 / 1e6) * 50 * 2
    expect(spendProblem({ ceiling, confirmed: 0.35, credit: 10 })).toBeNull()
    expect(spendProblem({ ceiling, confirmed: 0.34, credit: 10 })).toMatchObject({
      reason: 'confirm',
    })
  })

  it('refuses a paid job the credit does not cover, or when the credit is unknown', () => {
    expect(spendProblem({ ceiling: 0.42, confirmed: 0.42, credit: 0.4 })).toMatchObject({
      reason: 'credit',
      message: expect.stringContaining('$0.40'),
    })
    expect(spendProblem({ ceiling: 0.42, confirmed: 0.42, credit: null })).toMatchObject({
      reason: 'credit',
    })
  })

  it('refuses a model whose price is unknown', () => {
    expect(spendProblem({ ceiling: null, confirmed: 5, credit: 10 })).toMatchObject({
      reason: 'price',
    })
  })
})

describe('createBudget', () => {
  const at = new Date('2026-10-24T12:00:00Z')

  it('lets the confirmed model spend until the confirmed dollars run out, priced each time', () => {
    const budget = createBudget({ model: 's2-pro', dollars: 0.0003 })
    expect(budget.spend('s2-pro', 'x'.repeat(10), at)).toBeNull() // 10 bytes at $15/M = $0.00015
    expect(budget.left).toBeCloseTo(0.00015, 12)
    expect(budget.spend('s2-pro', 'x'.repeat(10), at)).toBeNull()
    expect(budget.spend('s2-pro', 'x'.repeat(1), at)).toMatch(/budget/)
  })

  it('refuses another model than the one confirmed', () => {
    const budget = createBudget({ model: 's2-pro', dollars: 5 })
    expect(budget.spend('drama-3', 'x'.repeat(10), at)).toMatch(/s2-pro/)
  })

  it('lets the free model through without dollars, and nothing paid', () => {
    const free = createBudget({ model: 's2.1-pro-free', dollars: 0 })
    expect(free.spend('s2.1-pro-free', 'x'.repeat(1_000_000), at)).toBeNull()
    expect(free.spend('s2-pro', 'x'.repeat(1), at)).not.toBeNull()
  })

  it('charges what a request costs when it is sent, a promotion ended included', () => {
    const budget = createBudget({ model: 'drama-3', dollars: 0.00002 })
    expect(budget.spend('drama-3', 'x'.repeat(1), new Date('2026-11-12T16:59:00Z'))).toBeNull() // $0.00001
    expect(budget.spend('drama-3', 'x'.repeat(1), new Date('2026-11-12T17:01:00Z'))).toMatch(
      /budget/,
    ) // $0.00005
  })

  it('refuses a model without a known price', () => {
    expect(
      createBudget({ model: 'brand-new', dollars: 5 }).spend('brand-new', 'x'.repeat(1), at),
    ).not.toBeNull()
  })
})

describe('createBudget, its dollars', () => {
  it('keeps the dollars it was given, whatever is left', () => {
    const budget = createBudget({ model: 's2-pro', dollars: 1 })
    budget.spend('s2-pro', 'x'.repeat(1000), new Date('2026-10-24T12:00:00Z'))
    expect(budget.dollars).toBe(1)
    expect(budget.left).toBeLessThan(1)
  })
})

describe('createBudget, topped up and refunded', () => {
  const at = new Date('2026-10-24T12:00:00Z')

  it('add raises both what it was given and what is left', () => {
    const budget = createBudget({ model: 's2-pro', dollars: 0.001 })
    budget.spend('s2-pro', 'x'.repeat(50), at) // $0.00075
    budget.add(0.01)
    expect(budget.dollars).toBeCloseTo(0.011, 12)
    expect(budget.left).toBeCloseTo(0.01025, 12)
  })

  it('refund gives back what a take cost without changing what it was given', () => {
    const budget = createBudget({ model: 's2-pro', dollars: 0.001 })
    budget.spend('s2-pro', 'x'.repeat(50), at)
    budget.refund(0.00075)
    expect(budget.left).toBeCloseTo(0.001, 12)
    expect(budget.dollars).toBe(0.001)
  })
})

describe('Budget.spent', () => {
  it('is what was charged, less refunds, and keeps counting after a top-up', () => {
    const budget = createBudget({ model: 's2.1-pro', dollars: 1 })
    expect(budget.spent).toBe(0)
    expect(budget.spend('s2.1-pro', 'x'.repeat(10_000), new Date())).toBeNull()
    expect(budget.spent).toBeCloseTo(0.15, 9)
    budget.refund(0.05)
    expect(budget.spent).toBeCloseTo(0.1, 9)
    budget.add(2)
    expect(budget.spent).toBeCloseTo(0.1, 9)
  })
})

describe('Budget.spent, after a refund', () => {
  it('is exactly nothing when everything charged was given back', () => {
    for (let cents = 1; cents <= 400; cents++) {
      const budget = createBudget({ model: 's2.1-pro', dollars: cents / 100 })
      const cost = (cents * 7) / 10_000
      const text = 'x'.repeat(Math.round((cost / 15) * 1_000_000))
      expect(budget.spend('s2.1-pro', text, new Date())).toBeNull()
      budget.refund(budget.spent)
      expect(budget.spent).toBe(0)
      budget.refund(0.1 + 0.2 - 0.3)
      expect(budget.spent).toBe(0)
    }
  })
})

describe('a budget for an ElevenLabs model', () => {
  const at = new Date('2026-10-27T12:00:00Z')
  it('is in credits: a character of text a credit on v3, half on Flash', () => {
    const v3 = createBudget({ model: 'eleven_v3', dollars: 10 })
    expect(v3.spend('eleven_v3', 'Får jag?', at)).toBeNull()
    expect(v3.left).toBe(2)
    expect(v3.spend('eleven_v3', 'abc', at)).toBe(
      'this would go past the confirmed budget (2 credits left); plan again',
    )
    const flash = createBudget({ model: 'eleven_flash_v2_5', dollars: 3 })
    expect(flash.spend('eleven_flash_v2_5', 'abcdef', at)).toBeNull()
    expect(flash.left).toBe(0)
  })
})

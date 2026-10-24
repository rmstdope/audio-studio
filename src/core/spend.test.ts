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
    expect(budget.spend('s2-pro', 10, at)).toBeNull() // 10 bytes at $15/M = $0.00015
    expect(budget.left).toBeCloseTo(0.00015, 12)
    expect(budget.spend('s2-pro', 10, at)).toBeNull()
    expect(budget.spend('s2-pro', 1, at)).toMatch(/budget/)
  })

  it('refuses another model than the one confirmed', () => {
    const budget = createBudget({ model: 's2-pro', dollars: 5 })
    expect(budget.spend('drama-3', 10, at)).toMatch(/s2-pro/)
  })

  it('lets the free model through without dollars, and nothing paid', () => {
    const free = createBudget({ model: 's2.1-pro-free', dollars: 0 })
    expect(free.spend('s2.1-pro-free', 1_000_000, at)).toBeNull()
    expect(free.spend('s2-pro', 1, at)).not.toBeNull()
  })

  it('charges what a request costs when it is sent, a promotion ended included', () => {
    const budget = createBudget({ model: 'drama-3', dollars: 0.00002 })
    expect(budget.spend('drama-3', 1, new Date('2026-11-12T16:59:00Z'))).toBeNull() // $0.00001
    expect(budget.spend('drama-3', 1, new Date('2026-11-12T17:01:00Z'))).toMatch(/budget/) // $0.00005
  })

  it('refuses a model without a known price', () => {
    expect(
      createBudget({ model: 'brand-new', dollars: 5 }).spend('brand-new', 1, at),
    ).not.toBeNull()
  })
})

describe('createBudget, its dollars', () => {
  it('keeps the dollars it was given, whatever is left', () => {
    const budget = createBudget({ model: 's2-pro', dollars: 1 })
    budget.spend('s2-pro', 1000, new Date('2026-10-24T12:00:00Z'))
    expect(budget.dollars).toBe(1)
    expect(budget.left).toBeLessThan(1)
  })
})

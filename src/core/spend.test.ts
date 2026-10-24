import { describe, expect, it } from 'bun:test'
import { spendProblem } from './spend'

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

import { describe, expect, it } from 'bun:test'
import {
  amountProblem,
  cantStart,
  parseAmount,
  perTakeCost,
  suggestedAmount,
  sittingMoney,
  takesLeft,
} from './sitting'

const at = new Date('2026-10-25T12:00:00Z')

describe('perTakeCost', () => {
  it('prices the bytes of the phrase at the model’s price', () => {
    expect(perTakeCost('s2.1-pro', 100, at)).toBeCloseTo(0.0015, 10)
  })
  it('is free on the free model and unknown for an unpriced one', () => {
    expect(perTakeCost('s2.1-pro-free', 100, at)).toBe(0)
    expect(perTakeCost('mystery', 100, at)).toBeNull()
  })
})

describe('suggestedAmount', () => {
  it('is about 50 takes, rounded up to the next five cents', () => {
    expect(suggestedAmount(0.0015)).toBe(0.1) // 0.075 -> 0.10
    expect(suggestedAmount(0.002)).toBe(0.1) // 0.10 exactly
    expect(suggestedAmount(0.0005)).toBe(0.05) // 0.025 -> at least 0.05
    expect(suggestedAmount(0.01)).toBe(0.5)
  })
})

describe('takesLeft and takesFor', () => {
  it('count whole takes, ignoring a rounding hair', () => {
    expect(takesLeft(0.07, 0.002)).toBe(35)
    expect(takesLeft(0.06 - 1e-12, 0.002)).toBe(30)
    expect(takesLeft(0.001, 0.002)).toBe(0)
    expect(takesLeft(0.1, 0.002)).toBe(50)
  })
})

describe('parseAmount', () => {
  it('reads dollars in whole cents, with or without a dollar sign', () => {
    expect(parseAmount('0.10')).toBe(0.1)
    expect(parseAmount(' $2 ')).toBe(2)
    expect(parseAmount('.5')).toBe(0.5)
  })
  it('refuses anything else: empty, text, zero, negative, fractions of a cent', () => {
    for (const text of ['', 'abc', '0', '-1', '0.105', '1e2', '1,5']) {
      expect(parseAmount(text)).toBeNull()
    }
  })
})

describe('amountProblem', () => {
  it('names the two ways an amount fails the box', () => {
    expect(amountProblem('x', 4.82)).toBe('Enter an amount in dollars, like 0.10.')
    expect(amountProblem('', 4.82)).toBe('Enter an amount in dollars, like 0.10.')
    expect(amountProblem('5', 4.82)).toBe('That is more than your credit of $4.82.')
    expect(amountProblem('4.82', 4.82)).toBeNull()
  })
})

describe('cantStart', () => {
  it('says why the credit cannot be read, or is not enough for one take', () => {
    expect(cantStart(null, 0.002, 's2.1-pro')).toMatch(/couldn’t read your Fish credit/)
    expect(cantStart(0, 0.002, 's2.1-pro')).toBe(
      'Your Fish credit is $0.00, not enough for a take with s2.1-pro. Add credit on Fish, or set the audition model to the free one.',
    )
    expect(cantStart(0.002, 0.002, 's2.1-pro')).toBeNull()
  })
})

describe('sittingMoney', () => {
  it('says what is spent, what is left, and when it is used up', () => {
    expect(sittingMoney(0.1, 0.07, 0.002)).toEqual({
      dollars: 0.1,
      spent: 0.1 - 0.07,
      left: 0.07,
      takesLeft: 35,
      usedUp: false,
    })
    expect(sittingMoney(0.1, 0.001, 0.002)).toMatchObject({ takesLeft: 0, usedUp: true })
  })
})

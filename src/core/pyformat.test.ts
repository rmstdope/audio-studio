import { describe, expect, it } from 'bun:test'
import { pyFixed } from './pyformat'

describe('pyFixed (Python’s f"{x:.Nf}")', () => {
  it('rounds the exact value, exact ties to even, as Python formats', () => {
    expect([0.125, 0.375, 2.675, 7.449999999, -3.125, 1e-9].map((x) => pyFixed(x, 2))).toEqual([
      '0.12',
      '0.38',
      '2.67',
      '7.45',
      '-3.12',
      '0.00',
    ])
    expect(pyFixed(10 ** (-1.5 / 20), 4)).toBe('0.8414')
    expect(pyFixed(-0, 2)).toBe('-0.00')
  })
})

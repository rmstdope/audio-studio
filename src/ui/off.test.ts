import { describe, expect, test } from 'bun:test'
import { off, tipOnly, tipPlace } from './off'

describe('off', () => {
  test('a control with no reason against it gets nothing added', () => {
    expect(off()).toEqual({})
    expect(off(false, null, undefined, '')).toEqual({})
  })

  test('the first reason wins, so they are written in the order to deal with them', () => {
    const props = off(false, 'Setup first.', 'Wait for the takes.')
    expect(props['data-why']).toBe('Setup first.')
    expect(props['aria-description']).toBe('Setup first.')
    expect(props['aria-disabled']).toBe(true)
  })

  test('when the first clears, the next one shows', () => {
    expect(off(false, 'Wait for the takes.')['data-why']).toBe('Wait for the takes.')
  })
})

describe('tipOnly', () => {
  test('carries the reason for the tip but leaves the control on', () => {
    const props = tipOnly(false, 'No dialog yet', 'later')
    expect(props['data-why']).toBe('No dialog yet')
    expect(props['aria-description']).toBe('No dialog yet')
    expect('aria-disabled' in props).toBe(false)
  })

  test('with no reason it adds nothing', () => {
    expect(tipOnly(false, '')).toEqual({})
  })
})

describe('tipPlace', () => {
  const win = { width: 800, height: 600 }
  const tip = { width: 200, height: 40 }
  const target = (left: number, top: number) => ({ left, top, width: 80, height: 30 })

  test('opens above the control, centred on it', () => {
    expect(tipPlace(target(300, 300), tip, win, 6)).toEqual({ left: 240, top: 254, side: 'above' })
  })

  test('opens below when there is no room above', () => {
    expect(tipPlace(target(300, 20), tip, win, 6)).toEqual({ left: 240, top: 56, side: 'below' })
  })

  test('moves inward near a window edge', () => {
    expect(tipPlace(target(4, 300), tip, win, 6).left).toBe(8)
    expect(tipPlace(target(740, 300), tip, win, 6).left).toBe(592)
  })

  test('stays inside a window narrower than the tip', () => {
    expect(tipPlace(target(10, 300), tip, { width: 150, height: 600 }, 6).left).toBe(8)
  })
})

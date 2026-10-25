import { describe, expect, it } from 'bun:test'
import { LINE_KEYS, isTyping, lineKeyAction } from './lineKeys'

describe('lineKeyAction', () => {
  it('moves with j, k and the arrows, plays with space and Enter', () => {
    expect(lineKeyAction('j', false)).toBe('next')
    expect(lineKeyAction('ArrowDown', false)).toBe('next')
    expect(lineKeyAction('k', false)).toBe('previous')
    expect(lineKeyAction('ArrowUp', false)).toBe('previous')
    expect(lineKeyAction(' ', false)).toBe('play')
    expect(lineKeyAction('Enter', false)).toBe('play')
  })

  it('has a key for each row action, and none for other keys or while typing', () => {
    expect(lineKeyAction('r', false)).toBe('record')
    expect(lineKeyAction('a', false)).toBe('accept')
    expect(lineKeyAction('c', false)).toBe('cue')
    expect(lineKeyAction('n', false)).toBe('note')
    expect(lineKeyAction('f', false)).toBe('fromHere')
    expect(lineKeyAction('h', false)).toBe('heard')
    expect(lineKeyAction('x', false)).toBeNull()
    expect(lineKeyAction('j', true)).toBeNull()
  })

  it('lists every action in the hint', () => {
    expect(LINE_KEYS.map((k) => k.does)).toContain('record or retake')
    expect(LINE_KEYS).toHaveLength(8)
  })
})

describe('isTyping', () => {
  it('is typing in a field, not on a row or button', () => {
    expect(isTyping('input')).toBe(true)
    expect(isTyping('TEXTAREA')).toBe(true)
    expect(isTyping('TR')).toBe(false)
    expect(isTyping('BUTTON')).toBe(false)
  })
})

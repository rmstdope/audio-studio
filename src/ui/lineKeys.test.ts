import { describe, expect, it } from 'bun:test'
import { LINE_KEYS, isTyping, lineKeyAction, type LineKeyAction } from './lineKeys'

const press = (key: string, more: Partial<Parameters<typeof lineKeyAction>[0]> = {}) =>
  lineKeyAction({ key, modifier: false, typing: false, onButton: false, ...more })

describe('lineKeyAction', () => {
  it('moves with j, k and the arrows, plays with space and Enter', () => {
    expect(press('j')).toBe('next')
    expect(press('ArrowDown')).toBe('next')
    expect(press('k')).toBe('previous')
    expect(press('ArrowUp')).toBe('previous')
    expect(press(' ')).toBe('play')
    expect(press('Enter')).toBe('play')
  })

  it('has a key for each row action, and none for other keys', () => {
    expect(press('r')).toBe('record')
    expect(press('a')).toBe('accept')
    expect(press('c')).toBe('cue')
    expect(press('p')).toBe('place')
    expect(press('n')).toBe('note')
    expect(press('f')).toBe('fromHere')
    expect(press('h')).toBe('heard')
    expect(press('t')).toBe('takes')
    expect(press('x')).toBeNull()
    expect(press('Tab')).toBeNull()
  })

  it('leaves the browser’s shortcuts and a field’s typing alone', () => {
    expect(press('r', { modifier: true })).toBeNull()
    expect(press('a', { modifier: true })).toBeNull()
    expect(press('j', { typing: true })).toBeNull()
    expect(press(' ', { typing: true })).toBeNull()
  })

  it('leaves space and Enter to a button in the row, but takes the letters', () => {
    expect(press('Enter', { onButton: true })).toBeNull()
    expect(press(' ', { onButton: true })).toBeNull()
    expect(press('r', { onButton: true })).toBe('record')
    expect(press('j', { onButton: true })).toBe('next')
  })

  it('lists every action once in the hint, the cue inside after the cue', () => {
    const actions: LineKeyAction[] = [
      'next',
      'previous',
      'play',
      'fromHere',
      'record',
      'accept',
      'heard',
      'cue',
      'place',
      'note',
      'takes',
    ]
    expect(LINE_KEYS.map((k) => k.action).sort()).toEqual([...actions].sort())
    const hint = LINE_KEYS.map((k) => `${k.shown} ${k.does}`)
    expect(hint.indexOf('p place a cue inside')).toBe(hint.indexOf('c cue') + 1)
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

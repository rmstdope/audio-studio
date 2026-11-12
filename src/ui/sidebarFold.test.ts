import { describe, expect, it } from 'bun:test'
import {
  actPillLabel,
  isTypingTarget,
  railDot,
  readFolded,
  writeFolded,
  FOLDED_KEY,
} from './sidebarFold'

const store = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  }
}
const broken = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('the remembered fold', () => {
  it('opens unfolded when nothing is kept or the browser keeps nothing', () => {
    expect(readFolded(store())).toBe(false)
    expect(readFolded(broken)).toBe(false)
    expect(readFolded(undefined)).toBe(false)
  })

  it('round-trips the choice', () => {
    const s = store()
    writeFolded(true, s)
    expect(s.data[FOLDED_KEY]).toBe('1')
    expect(readFolded(s)).toBe(true)
    writeFolded(false, s)
    expect(readFolded(s)).toBe(false)
  })

  it('does not throw when the browser refuses the write', () => {
    expect(() => writeFolded(true, broken)).not.toThrow()
  })
})

describe('the rail dot', () => {
  it('is green for all, amber for some and grey for none', () => {
    expect(railDot(3, 3)).toBe('all')
    expect(railDot(1, 3)).toBe('some')
    expect(railDot(0, 3)).toBe('none')
    expect(railDot(0, 0)).toBe('none')
  })
})

describe('the act pill label', () => {
  it('numbers acts from one', () => {
    expect(actPillLabel(0)).toBe('Act 1')
    expect(actPillLabel(4)).toBe('Act 5')
  })
})

describe('typing targets', () => {
  const el = (tagName: string, editable = false) => ({ tagName, isContentEditable: editable })
  it('is true for fields and editable elements only', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true)
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true)
    expect(isTypingTarget(el('SELECT'))).toBe(true)
    expect(isTypingTarget(el('DIV', true))).toBe(true)
    expect(isTypingTarget(el('BUTTON'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

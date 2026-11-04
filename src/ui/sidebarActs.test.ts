import { describe, expect, it } from 'bun:test'
import { actCount, doneCount, doneTone, openWorkspace } from './sidebarActs'

describe('the workspace open in the sidebar', () => {
  it('is Narration on an act or its lines', () => {
    expect(openWorkspace({ view: 'part', part: 'act1' })).toBe('narration')
    expect(openWorkspace({ view: 'lines', part: 'act1' })).toBe('narration')
  })
  it('is Music on any Music page', () => {
    expect(openWorkspace({ view: 'music', page: null })).toBe('music')
    expect(openWorkspace({ view: 'music', page: 'stingers' })).toBe('music')
  })
  it('is Images on any Images page and Scenes on any Scenes page', () => {
    expect(openWorkspace({ view: 'images', page: null })).toBe('images')
    expect(openWorkspace({ view: 'scenes', page: null })).toBe('scenes')
    expect(openWorkspace({ view: 'scenes', page: 'act', part: 'act1' })).toBe('scenes')
  })
  it('is none on the project pages and the characters', () => {
    for (const route of [
      { view: 'setup' },
      { view: 'changes' },
      { view: 'spending' },
      { view: 'characters' },
      { view: 'character', character: 'mira' },
      { view: 'audition', character: 'mira' },
    ] as const) {
      expect(openWorkspace(route)).toBeNull()
    }
  })
})

describe('what an act shows at the right of its sidebar entry', () => {
  it('is the bare number of lines until it is known how many are ok', () => {
    expect(actCount({ dialog: 'ok', lineCount: 12 })).toEqual({
      text: '12',
      warn: false,
      tone: null,
    })
  })
  it('is the lines that are ok out of all of them', () => {
    expect(actCount({ dialog: 'ok', lineCount: 624 }, { ok: 620, lines: 624 })).toEqual({
      text: '620/624',
      warn: false,
      tone: 'most',
    })
  })
  it('says the problem in words, amber for a dialog gone', () => {
    expect(actCount({ dialog: 'missing', lineCount: 0 })).toEqual({
      text: 'no script',
      warn: false,
      tone: null,
    })
    expect(actCount({ dialog: 'gone', lineCount: 0 })).toEqual({
      text: 'dialog gone',
      warn: true,
      tone: null,
    })
    expect(actCount({ dialog: 'invalid', lineCount: 0 })).toEqual({
      text: 'invalid',
      warn: false,
      tone: null,
    })
  })
})

describe('what is done of a list', () => {
  it('is how many are done out of all, with its colour', () => {
    expect(doneCount({ done: 2, total: 3 })).toEqual({ text: '2/3', tone: 'few' })
    expect(doneCount({ done: 0, total: 0 })).toEqual({ text: '0/0', tone: null })
  })
})

describe('the colour of a done count', () => {
  it('is green when all are done, red under three quarters, yellow between, none for an empty list', () => {
    expect(doneTone(624, 624)).toBe('all')
    expect(doneTone(620, 624)).toBe('most')
    expect(doneTone(3, 4)).toBe('most')
    expect(doneTone(2, 4)).toBe('few')
    expect(doneTone(0, 5)).toBe('few')
    expect(doneTone(0, 0)).toBeNull()
  })
})

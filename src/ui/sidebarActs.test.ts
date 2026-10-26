import { describe, expect, it } from 'bun:test'
import { actCount, openWorkspace } from './sidebarActs'

describe('the workspace open in the sidebar', () => {
  it('is Narration on an act or its lines', () => {
    expect(openWorkspace({ view: 'part', part: 'act1' })).toBe('narration')
    expect(openWorkspace({ view: 'lines', part: 'act1' })).toBe('narration')
  })
  it('is Music on any Music page', () => {
    expect(openWorkspace({ view: 'music', page: null })).toBe('music')
    expect(openWorkspace({ view: 'music', page: 'stingers' })).toBe('music')
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
  it('is the bare number of lines', () => {
    expect(actCount({ dialog: 'ok', lineCount: 12 })).toEqual({ text: '12', warn: false })
  })
  it('says the problem in words, amber for a dialog gone', () => {
    expect(actCount({ dialog: 'missing', lineCount: 0 })).toEqual({
      text: 'no script',
      warn: false,
    })
    expect(actCount({ dialog: 'gone', lineCount: 0 })).toEqual({ text: 'dialog gone', warn: true })
    expect(actCount({ dialog: 'invalid', lineCount: 0 })).toEqual({ text: 'invalid', warn: false })
  })
})

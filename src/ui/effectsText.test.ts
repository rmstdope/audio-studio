import { describe, expect, it } from 'bun:test'
import type { EffectsSummary } from '../core/effects'
import {
  EFFECTS_PENDING,
  effectLengthLine,
  effectsMakeWhy,
  effectsNotice,
  effectsRefreshSummary,
  effectsSubtitle,
} from './effectsText'

const summary = (extra: Partial<EffectsSummary> = {}): EffectsSummary => ({
  status: 'ok',
  canRefresh: true,
  rows: Array.from({ length: 8 }, (_, i) => ({
    id: `e${i}`,
    name: `E${i}`,
    description: 'd',
    gameDescription: 'd',
    seconds: 1,
    loops: false,
    changedHere: false,
    gameChanged: false,
    status: 'none-yet' as const,
    current: { kind: 'nothing' as const },
    changed: [],
    chosen: false,
  })),
  dropped: [],
  unreadable: 0,
  problems: [],
  done: { done: 0, total: 8, needs: [] },
  ...extra,
})

describe('effectsSubtitle', () => {
  it('counts the chosen out of all', () => {
    expect(effectsSubtitle(summary())).toBe('The sound effects the game asks for. 0 of 8 chosen.')
  })

  it('counts an out-of-date effect as chosen, and names missing clips', () => {
    const rows = summary().rows.map((row, i) => ({
      ...row,
      chosen: i < 4,
      status: i === 0 ? ('missing' as const) : i === 1 ? ('changed' as const) : row.status,
    }))
    expect(effectsSubtitle(summary({ rows }))).toBe(
      'The sound effects the game asks for. 4 of 8 chosen; 1 clip is missing.',
    )
    const two = rows.map((row, i) => (i === 1 ? { ...row, status: 'missing' as const } : row))
    expect(effectsSubtitle(summary({ rows: two }))).toBe(
      'The sound effects the game asks for. 4 of 8 chosen; 2 clips are missing.',
    )
  })

  it('gives no count while the lock cannot be read', () => {
    const rows = summary().rows.map((row) => ({ ...row, status: 'unknown' as const }))
    expect(effectsSubtitle(summary({ rows }))).toBe('The sound effects the game asks for.')
  })

  it('says how many could not be read', () => {
    const s = summary({ rows: summary().rows.slice(0, 5), unreadable: 3 })
    expect(effectsSubtitle(s)).toBe(
      'The sound effects the game asks for. 0 of 5 chosen; 3 could not be read.',
    )
  })

  it('has no count when there is no table', () => {
    for (const s of [
      summary({ status: 'missing', rows: [] }),
      summary({ status: 'invalid', rows: [] }),
      summary({ rows: [] }),
    ]) {
      expect(effectsSubtitle(s)).toBe('The sound effects the game asks for.')
    }
  })
})

describe('effectsNotice', () => {
  it('has none when there is a table', () => {
    expect(effectsNotice(summary())).toBeNull()
  })

  it('names the Refresh only when the button is there', () => {
    const missing = summary({ status: 'missing', rows: [] })
    expect(effectsNotice(missing)).toBe(
      'The game has not listed its sound effects yet. Refresh from the game.',
    )
    expect(effectsNotice({ ...missing, canRefresh: false })).toBe(
      'The game has not listed its sound effects yet.',
    )
  })

  it('says the whole list cannot be read, or that it is empty', () => {
    expect(effectsNotice(summary({ status: 'invalid', rows: [] }))).toBe(
      'The list of sound effects could not be read; the problems above say why.',
    )
    expect(effectsNotice(summary({ rows: [] }))).toBe('The game asks for no sound effects.')
  })

  it('shows no line over a list whose entries are all unreadable beyond the problems', () => {
    expect(effectsNotice(summary({ rows: [], unreadable: 2 }))).toBeNull()
  })
})

describe('effectsRefreshSummary', () => {
  it('names the count, what was added and what was removed', () => {
    expect(effectsRefreshSummary(8, { added: ['coins'], removed: ['lantern-hum'] })).toEqual({
      headline: '8 sound effects · 1 added · 1 removed',
      added: ['coins'],
      removed: ['lantern-hum'],
    })
  })

  it('says no changes, a single effect, and when what changed is not known', () => {
    expect(effectsRefreshSummary(8, { added: [], removed: [] }).headline).toBe(
      '8 sound effects · no changes',
    )
    expect(effectsRefreshSummary(1, { added: ['a'], removed: [] }).headline).toBe(
      '1 sound effect · 1 added',
    )
    expect(effectsRefreshSummary(3, null).headline).toBe(
      '3 sound effects · what changed is not known',
    )
  })
})

describe('effectLengthLine', () => {
  it('says a loop loops, and a one-shot nothing more than the game sets it', () => {
    expect(effectLengthLine(10, true)).toBe('10 s · loops · set by the game')
    expect(effectLengthLine(3, false)).toBe('3 s · set by the game')
  })
})

describe('effectsMakeWhy', () => {
  const free = { canMake: true, busy: false, waitingForWords: false, pending: false }

  it('is nothing when new takes can be made', () => {
    expect(effectsMakeWhy(free)).toBeNull()
  })

  it('names what only Setup can fix before anything else', () => {
    expect(effectsMakeWhy({ ...free, canMake: false, busy: true, waitingForWords: true })).toBe(
      'Neither sound-effects model can run on this computer. Setup says what is missing.',
    )
  })

  it('then the words being saved, then takes being made, then a change under way', () => {
    expect(effectsMakeWhy({ ...free, waitingForWords: true, busy: true, pending: true })).toBe(
      'The effect’s words are being saved. This turns on when they are.',
    )
    expect(effectsMakeWhy({ ...free, busy: true, pending: true })).toBe(
      'Takes are being made for this effect. Make more when they are done, or Stop.',
    )
    expect(effectsMakeWhy({ ...free, pending: true })).toBe(EFFECTS_PENDING)
  })
})

import { describe, expect, it } from 'bun:test'
import { castEffects, droppedRuledOut, stopEffects, takesToRecord, undoFor } from './board'

describe('takesToRecord', () => {
  it('records the voices shown without a take, once, and not again after it failed', () => {
    expect(
      takesToRecord(['a', 'b', 'c', 'd'], { a: 'k1' }, new Set(['b']), { c: 'Fish is busy' }),
    ).toEqual(['d'])
  })
})

const titles = new Map([
  ['act1', 'Act I'],
  ['act3', 'Act III'],
])

describe('castEffects', () => {
  it('says which recorded lines go stale, that the old voice is not ruled out, and how the audition ends', () => {
    expect(
      castEffects({
        name: 'Grandmother',
        current: 'Gentle Granny',
        replacing: true,
        recorded: [
          { part: 'act1', lines: 26 },
          { part: 'act3', lines: 9 },
        ],
        titles,
        dropped: 3,
        unheard: 6,
      }),
    ).toEqual([
      '35 recorded lines go stale (Act I: 26, Act III: 9). They record again the next time you generate.',
      'Gentle Granny is no longer Grandmother’s voice. It is not ruled out: it can come back in a later audition.',
      'The audition ends. The 3 voices you dropped stay ruled out; the 6 you did not hear are not.',
    ])
  })

  it('leaves out what does not apply to a character without a voice or lines', () => {
    expect(
      castEffects({
        name: 'Mira',
        current: null,
        replacing: false,
        recorded: [],
        titles,
        dropped: 0,
        unheard: 4,
      }),
    ).toEqual(['The audition ends.'])
  })
})

describe('stopEffects', () => {
  it('says the cast stays, what stays ruled out, and what is let go', () => {
    expect(
      stopEffects({
        name: 'Grandmother',
        current: 'Gentle Granny',
        lines: 35,
        dropped: 3,
        shortlisted: 1,
      }),
    ).toEqual([
      'Nothing changes in the cast: Grandmother keeps Gentle Granny.',
      'The 3 voices you dropped stay ruled out. You can allow them again from the list of ruled-out voices.',
      'The shortlist (1 voice) is let go: shortlisted and unheard voices can turn up again next time.',
    ])
  })

  it('says a character without a voice stays uncast', () => {
    expect(
      stopEffects({ name: 'The Miller', current: null, lines: 14, dropped: 1, shortlisted: 0 }),
    ).toEqual([
      'The Miller stays uncast: 14 lines cannot be recorded until it has a voice.',
      'The voice you dropped stays ruled out. You can allow it again from the list of ruled-out voices.',
    ])
  })
})

describe('castEffects, keeping the voice', () => {
  it('says the old voice goes by whether it is replaced, not by its title', () => {
    const effects = (replacing: boolean) =>
      castEffects({
        name: 'Mira',
        current: 'Narrator',
        replacing,
        recorded: [],
        titles,
        dropped: 1,
        unheard: 0,
      })
    expect(effects(true)[0]).toBe(
      'Narrator is no longer Mira’s voice. It is not ruled out: it can come back in a later audition.',
    )
    expect(effects(false)).toEqual(['The audition ends. The voice you dropped stays ruled out.'])
  })
})

describe('stopEffects, without lines', () => {
  it('says only that a character with no voice stays uncast', () => {
    expect(
      stopEffects({ name: 'Mira', current: null, lines: 0, dropped: 0, shortlisted: 0 }),
    ).toEqual(['Mira stays uncast.'])
  })
})

describe('droppedRuledOut', () => {
  it('gives the voices dropped in the audition that are still ruled out, never the cast one', () => {
    const dropped = [
      { id: 'a', from: 'toHear' as const },
      { id: 'b', from: 'toHear' as const },
      { id: 'cur', from: 'shortlist' as const },
    ]
    expect(droppedRuledOut(dropped, ['b', 'z'], 'cur')).toEqual(['b'])
    expect(droppedRuledOut(dropped, null, 'cur')).toEqual(['a', 'b'])
  })
})

describe('undoFor', () => {
  it('offers to undo the drop this page made, while it is the last one', () => {
    const dropped = [
      { id: 'a', from: 'toHear' as const },
      { id: 'b', from: 'shortlist' as const },
    ]
    expect(undoFor('b', dropped)).toBe('b')
    expect(undoFor('a', dropped)).toBeNull()
    expect(undoFor(null, dropped)).toBeNull()
    expect(undoFor('b', [])).toBeNull()
  })
})

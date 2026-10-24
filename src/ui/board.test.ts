import { describe, expect, it } from 'bun:test'
import { castEffects, stopEffects, takesToRecord } from './board'

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
        voice: 'Velvet Nana',
        current: 'Gentle Granny',
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
        voice: 'Warm',
        current: null,
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

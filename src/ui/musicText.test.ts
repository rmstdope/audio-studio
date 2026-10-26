import { describe, expect, it } from 'bun:test'
import {
  changeSummary,
  fieldTag,
  fieldText,
  listFor,
  listLine,
  listNotice,
  parseField,
} from './musicText'

const list = (over = {}) => ({
  id: 'act2',
  kind: 'act' as const,
  title: 'Act II: The Road',
  state: 'ok' as const,
  tracks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
  canRefresh: true,
  dropped: 0,
  ...over,
})

describe('listLine', () => {
  it('counts the tracks chosen, none until choosing exists', () => {
    expect(listLine(list(), 'Act II')).toBe('The loops the game asks for in Act II. 0 of 4 chosen.')
    expect(listLine(list({ kind: 'stingers', tracks: [{ id: 'v' }] }), 'Stingers')).toBe(
      'Played once, for a moment, anywhere in the game. 0 of 1 chosen.',
    )
  })

  it('leaves the count out when there is nothing to count', () => {
    expect(listLine(list({ tracks: [] }), 'Act IV')).toBe('The loops the game asks for in Act IV.')
    expect(listLine(list({ state: 'missing', tracks: [] }), 'Act IV')).toBe(
      'The loops the game asks for in Act IV.',
    )
  })
})

describe('listNotice', () => {
  it('says the game asks for none when the list is there and empty', () => {
    expect(listNotice(list({ tracks: [] }), 'Act IV')).toBe('The game asks for no loops in Act IV.')
    expect(listNotice(list({ kind: 'stingers', tracks: [] }), 'Stingers')).toBe(
      'The game asks for no stingers.',
    )
  })

  it('says the game has not listed them when there is no list yet', () => {
    expect(listNotice(list({ state: 'missing', tracks: [] }), 'Act IV')).toBe(
      'The game has not listed the loops for Act IV yet. Refresh from the game.',
    )
    expect(listNotice(list({ kind: 'stingers', state: 'missing', tracks: [] }), 'Stingers')).toBe(
      'The game has not listed the stingers yet. Refresh from the game.',
    )
  })

  it('drops the invitation to refresh when the page has no such button', () => {
    expect(listNotice(list({ state: 'missing', tracks: [], canRefresh: false }), 'Act IV')).toBe(
      'The game has not listed the loops for Act IV yet.',
    )
  })

  it('says a list that could not be read is not shown', () => {
    expect(listNotice(list({ state: 'invalid', tracks: [] }), 'Act IV')).toBe(
      'The list of loops for Act IV could not be read; the problems above say why.',
    )
  })

  it('has nothing to say while there are tracks', () => {
    expect(listNotice(list(), 'Act II')).toBeNull()
  })
})

describe('changeSummary', () => {
  it('counts and names the tracks added and removed', () => {
    expect(
      changeSummary({
        total: 3,
        noun: 'loop',
        change: { added: [{ id: 'c', title: 'Sea' }], removed: [{ id: 'a', title: 'Hill' }] },
      }),
    ).toEqual({ headline: '3 loops · 1 added · 1 removed', added: ['Sea'], removed: ['Hill'] })
  })

  it('says no changes, and that it is not known when it is not', () => {
    expect(
      changeSummary({ total: 1, noun: 'stinger', change: { added: [], removed: [] } }).headline,
    ).toBe('1 stinger · no changes')
    expect(changeSummary({ total: 2, noun: 'stinger', change: null }).headline).toBe(
      '2 stingers · what changed is not known',
    )
  })
})

describe('listNotice with tracks left out', () => {
  it('does not say the game asks for none when every track repeats an id', () => {
    expect(listNotice(list({ tracks: [], dropped: 2 }), 'Act I')).toBe(
      'The game lists 2 tracks for Act I, but their ids are used more than once; the problems above say why.',
    )
    expect(listNotice(list({ kind: 'stingers', tracks: [], dropped: 1 }), 'Stingers')).toBe(
      'The game lists 1 track for the stingers, but their ids are used more than once; the problems above say why.',
    )
  })
})

describe('listFor', () => {
  const lists: { id: string; kind: 'act' | 'stingers'; tracks: { id: string }[] }[] = [
    { id: 'act1', kind: 'act', tracks: [{ id: 'a' }] },
    { id: 'stingers', kind: 'stingers', tracks: [{ id: 'victory' }] },
    { id: 'act2', kind: 'act', tracks: [{ id: 'b' }] },
  ]
  it('finds the act or the stingers the route names', () => {
    expect(listFor(lists, { view: 'music', page: 'act', part: 'act2' })?.id).toBe('act2')
    expect(listFor(lists, { view: 'music', page: 'stingers' })?.kind).toBe('stingers')
  })
  it('finds the list a track is in', () => {
    expect(listFor(lists, { view: 'music', page: 'track', track: 'b' })?.id).toBe('act2')
    expect(listFor(lists, { view: 'music', page: 'track', track: 'victory' })?.kind).toBe(
      'stingers',
    )
  })
  it('shows the first list for a track that is not there', () => {
    expect(listFor(lists, { view: 'music', page: 'track', track: 'gone' })?.id).toBe('act1')
  })
  it('shows the first list for a bare route or one that names nothing', () => {
    expect(listFor(lists, { view: 'music', page: null })?.id).toBe('act1')
    expect(listFor(lists, { view: 'music', page: 'act', part: 'nosuch' })?.id).toBe('act1')
    expect(listFor([], { view: 'music', page: null })).toBeUndefined()
  })
})

describe('fieldTag', () => {
  it('words the tag of a value that is not changed', () => {
    expect(fieldTag('game')).toBe('from the game')
    expect(fieldTag('unset')).toBe('not set')
  })
})

describe('fieldText', () => {
  const row = { brief: 'b', seconds: 80, bpm: 84, key: null }
  it('shows each value as it is typed', () => {
    expect(fieldText(row, 'brief')).toBe('b')
    expect(fieldText(row, 'seconds')).toBe('1:20')
    expect(fieldText(row, 'bpm')).toBe('84')
    expect(fieldText(row, 'key')).toBe('')
  })
})

describe('parseField', () => {
  it('reads what was typed into a change to save', () => {
    expect(parseField('brief', ' warm ', 'act')).toEqual({ ok: true, change: { brief: 'warm' } })
    expect(parseField('seconds', '1:20', 'act')).toEqual({ ok: true, change: { seconds: 80 } })
    expect(parseField('bpm', '90', 'act')).toEqual({ ok: true, change: { bpm: 90 } })
    expect(parseField('bpm', ' ', 'act')).toEqual({ ok: true, change: { bpm: null } })
    expect(parseField('key', 'D minor', 'act')).toEqual({ ok: true, change: { key: 'D minor' } })
    expect(parseField('key', '', 'act')).toEqual({ ok: true, change: { key: null } })
  })

  it('says what is wrong with a value instead of saving it', () => {
    expect(parseField('brief', '  ', 'act')).toEqual({
      ok: false,
      message: 'A brief cannot be empty.',
    })
    expect(parseField('seconds', '90', 'act')).toEqual({
      ok: false,
      message: 'Use minutes and seconds, like 1:20.',
    })
    expect(parseField('bpm', '20', 'act')).toEqual({
      ok: false,
      message: 'Use a whole number from 30 to 300.',
    })
    expect(parseField('bpm', '84.5', 'act').ok).toBe(false)
  })

  it('keeps a stinger to ten seconds', () => {
    expect(parseField('seconds', '0:10', 'stingers').ok).toBe(true)
    expect(parseField('seconds', '0:11', 'stingers')).toEqual({
      ok: false,
      message: 'A stinger is at most 0:10.',
    })
  })
})

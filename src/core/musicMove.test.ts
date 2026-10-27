import { describe, expect, it } from 'bun:test'
import type { MusicListSummary, TrackRow } from './music'
import {
  NO_MATCH,
  filterTargets,
  hasNowhere,
  moveFailure,
  moveLine,
  moveTitle,
  movedBoardTake,
  movedFromLine,
  movedLine,
  moveTargets,
  nowhereLine,
} from './musicMove'
import type { BoardTake } from './musicTake'

const row = (id: string, title: string, over: Partial<TrackRow> = {}): TrackRow => ({
  id,
  title,
  plays: null,
  brief: 'b',
  seconds: 60,
  bpm: null,
  key: null,
  game: { brief: 'b', seconds: 60, bpm: null, key: null },
  status: 'not-chosen',
  changed: [],
  chosenAt: null,
  current: { kind: 'none' },
  gameFile: null,
  ...over,
})

const list = (
  id: string,
  kind: 'act' | 'stingers',
  title: string,
  tracks: TrackRow[],
  state: MusicListSummary['state'] = 'ok',
): MusicListSummary => ({ id, kind, title, state, tracks, orphans: [], dropped: 0, canRefresh: false })

const lists = [
  list('act1', 'act', 'Act 1: The Call', [
    row('village', 'Willowbrook village'),
    row('inn', 'The inn', { status: 'chosen', seconds: 90 }),
  ]),
  list('act2', 'act', 'Act 2: The Wood', [
    row('hut', "Witch's hut", { status: 'changed', seconds: 120 }),
  ]),
  list('act3', 'act', 'Act 3: The End', [], 'missing'),
  list('stingers', 'stingers', 'Stingers', [row('win', 'Victory'), row('lose', 'Game over')]),
]

describe('moveTargets', () => {
  it('groups loops by act in game order and marks the track the take is on', () => {
    const { groups } = moveTargets(lists, { id: 'village', kind: 'loop' })
    expect(groups.map((g) => g.heading)).toEqual(['Act 1', 'Act 2', 'Act 3'])
    expect(groups[0]!.tracks).toEqual([
      { id: 'village', title: 'Willowbrook village', here: true, line: 'not chosen · 1:00' },
      { id: 'inn', title: 'The inn', here: false, line: 'chosen · 1:30' },
    ])
    expect(groups[1]!.tracks[0]!.line).toBe('changed since chosen · 2:00')
  })

  it('says an act the game has not listed yet', () => {
    const { groups } = moveTargets(lists, { id: 'village', kind: 'loop' })
    expect(groups[2]!.notListed).toBe('The game has not listed the loops for Act 3 yet.')
    expect(groups[2]!.tracks).toEqual([])
  })

  it('lists the stingers as one group with no heading', () => {
    const { groups } = moveTargets(lists, { id: 'win', kind: 'stinger' })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.heading).toBeNull()
    expect(groups[0]!.tracks.map((t) => [t.id, t.here])).toEqual([
      ['win', true],
      ['lose', false],
    ])
  })

  it('says how many takes a track is making', () => {
    const { groups } = moveTargets(lists, { id: 'village', kind: 'loop' }, { inn: { takes: 2, left: 5 } })
    expect(groups[0]!.tracks[1]!.line).toBe('making 2 takes · 1:30')
  })

  it('knows when there is nowhere to move it', () => {
    expect(hasNowhere(moveTargets(lists, { id: 'village', kind: 'loop' }).groups)).toBe(false)
    const alone = [list('s', 'stingers', 'Stingers', [row('win', 'Victory')])]
    expect(hasNowhere(moveTargets(alone, { id: 'win', kind: 'stinger' }).groups)).toBe(true)
  })
})

describe('filterTargets', () => {
  const { groups } = moveTargets(lists, { id: 'village', kind: 'loop' })
  it('keeps the titles that contain the text, any case, and drops empty acts', () => {
    const found = filterTargets(groups, ' WITCH')
    expect(found.map((g) => g.heading)).toEqual(['Act 2'])
    expect(found[0]!.tracks.map((t) => t.id)).toEqual(['hut'])
  })
  it('keeps everything for an empty search', () => {
    expect(filterTargets(groups, '  ')).toEqual(groups)
  })
  it('finds nothing for a name no loop has', () => {
    expect(filterTargets(groups, 'zzz')).toEqual([])
    expect(NO_MATCH).toBe('No loop is called that.')
  })
})

describe('the words', () => {
  it('words the dialog', () => {
    expect(moveTitle(3, 'loop')).toBe('Move take 3 to another loop')
    expect(moveTitle(2, 'stinger')).toBe('Move take 2 to another stinger')
    expect(moveLine('Willowbrook village', 'loop')).toBe(
      'It leaves Willowbrook village and joins the takes of the loop you pick.',
    )
    expect(moveLine('Victory', 'stinger')).toBe(
      'It leaves Victory and joins the takes of the stinger you pick.',
    )
    expect(moveFailure(3, "Witch's hut is being refreshed from the game")).toBe(
      "Take 3 could not be moved: Witch's hut is being refreshed from the game. Nothing was changed.",
    )
    expect(nowhereLine('stinger')).toBe('There is no other stinger to move it to.')
    expect(nowhereLine('loop')).toBe('There is no other loop to move it to.')
  })
  it('words the line afterwards, with the act for loops only', () => {
    expect(movedLine(3, "Witch's hut", 'Act 2', 5)).toBe(
      "Take 3 moved to Witch's hut (Act 2), where it is take 5.",
    )
    expect(movedLine(1, 'Victory', null, 2)).toBe('Take 1 moved to Victory, where it is take 2.')
    expect(movedFromLine({ title: 'Willowbrook village', n: 3 })).toBe(
      'moved from Willowbrook village, where it was take 3',
    )
  })
})

describe('movedBoardTake', () => {
  const take: BoardTake = {
    n: 3,
    hash: 'aaaaaaaaaaaaaaaa',
    seed: 7,
    model: 'm',
    seconds: 42,
    peaks: [0.5],
    inputs: { brief: 'old', kind: 'loop', seconds: 40, bpm: null, key: null },
  }
  it('is the take made for the destination: its numbers and inputs, its own sound', () => {
    const inputs = { brief: 'new', kind: 'loop' as const, seconds: 60, bpm: 90, key: 'C' }
    expect(
      movedBoardTake(take, { n: 5, hash: 'bbbbbbbbbbbbbbbb', inputs, from: 'Willowbrook village' }),
    ).toEqual({
      n: 5,
      hash: 'bbbbbbbbbbbbbbbb',
      seed: 7,
      model: 'm',
      seconds: 42,
      peaks: [0.5],
      inputs,
      movedFrom: { title: 'Willowbrook village', n: 3 },
    })
  })
})

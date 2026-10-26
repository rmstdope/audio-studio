import { describe, expect, it } from 'bun:test'
import {
  BriefChangeBody,
  BriefsSchema,
  LoopListSchema,
  applyBriefChange,
  fieldSource,
  parseClock,
  StingerListSchema,
  loopsDiff,
  summarizeMusic,
  type MusicListInput,
  type Track,
} from './music'
import { MUSIC_MODEL } from './musicTake'
import type { LockEntry } from './musicChoose'
import { problemsFrom } from './project'

const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id,
  title: id.toUpperCase(),
  brief: `${id} brief`,
  seconds: 80,
  ...extra,
})

const list = (id: string, tracks: Track[], over: Partial<MusicListInput> = {}): MusicListInput => ({
  id,
  kind: id === 'stingers' ? 'stingers' : 'act',
  title: id,
  file: `tts/${id}/music.json`,
  state: { status: 'ok', tracks },
  canRefresh: true,
  ...over,
})

describe('the track schemas', () => {
  it('reads a loop with only what the game must give', () => {
    const parsed = LoopListSchema.safeParse([{ id: 'a-b', title: 'A', brief: 'x', seconds: 90 }])
    expect(parsed.success).toBe(true)
  })

  it('keeps plays, bpm and key', () => {
    const parsed = LoopListSchema.parse([
      { id: 'a', title: 'A', brief: 'x', seconds: 90, plays: 'Here', bpm: 84, key: 'D major' },
    ])
    expect(parsed[0]).toMatchObject({ plays: 'Here', bpm: 84, key: 'D major' })
  })

  it('refuses an id that is not a slug, with its JSON path', () => {
    const parsed = LoopListSchema.safeParse([
      { id: 'ok', title: 'A', brief: 'x', seconds: 9 },
      { id: 'Not A Slug', title: 'A', brief: 'x', seconds: 9 },
    ])
    if (parsed.success) throw new Error('expected a problem')
    expect(problemsFrom('f.json', parsed.error).map((p) => p.path)).toEqual(['[1].id'])
  })

  it('refuses a list that is not an array, a missing brief and a bad length or tempo', () => {
    expect(LoopListSchema.safeParse({}).success).toBe(false)
    expect(LoopListSchema.safeParse([{ id: 'a', title: 'A', seconds: 9 }]).success).toBe(false)
    expect(
      LoopListSchema.safeParse([{ id: 'a', title: 'A', brief: 'x', seconds: 0 }]).success,
    ).toBe(false)
    expect(
      LoopListSchema.safeParse([{ id: 'a', title: 'A', brief: 'x', seconds: 9, bpm: 5 }]).success,
    ).toBe(false)
  })

  it('allows a stinger of at most ten seconds', () => {
    const stinger = (seconds: number) => [{ id: 'v', title: 'V', brief: 'x', seconds }]
    expect(StingerListSchema.safeParse(stinger(10)).success).toBe(true)
    const long = StingerListSchema.safeParse(stinger(11))
    if (long.success) throw new Error('expected a problem')
    expect(problemsFrom('f.json', long.error).map((p) => p.path)).toEqual(['[0].seconds'])
  })

  it('reads briefs, null meaning none of tempo or key', () => {
    const briefs = BriefsSchema.parse({ a: { brief: 'new', bpm: null, key: null }, b: {} })
    expect(briefs.a).toEqual({ brief: 'new', bpm: null, key: null })
  })
})

describe('summarizeMusic', () => {
  it('lists the tracks of each list in the game’s order, none of them chosen', () => {
    const { music, problems } = summarizeMusic(
      [list('act1', [track('b'), track('a')]), list('stingers', [track('v', { seconds: 5 })])],
      {},
    )
    expect(problems).toEqual([])
    expect(music.lists.map((l) => [l.id, l.kind, l.tracks.map((t) => t.id)])).toEqual([
      ['act1', 'act', ['b', 'a']],
      ['stingers', 'stingers', ['v']],
    ])
    expect(music.lists[0]!.tracks[0]).toMatchObject({
      title: 'B',
      brief: 'b brief',
      seconds: 80,
      status: 'not-chosen',
    })
    expect(music.lists[0]!.state).toBe('ok')
  })

  it('tells a list that is empty from one that is not there, and one that is broken', () => {
    const { music } = summarizeMusic(
      [
        list('act1', []),
        list('act2', [], { state: { status: 'missing' } }),
        list('act3', [], { state: { status: 'invalid' } }),
      ],
      {},
    )
    expect(music.lists.map((l) => [l.state, l.tracks.length])).toEqual([
      ['ok', 0],
      ['missing', 0],
      ['invalid', 0],
    ])
  })

  it('puts the studio’s changes over the game’s brief and length', () => {
    const { music } = summarizeMusic([list('act1', [track('a')])], {
      a: { brief: 'ours', seconds: 60 },
    })
    expect(music.lists[0]!.tracks[0]).toMatchObject({ brief: 'ours', seconds: 60 })
  })

  it('carries tempo and key, and the game’s own values beside the studio’s', () => {
    const { music } = summarizeMusic(
      [list('act1', [track('a', { bpm: 84, key: 'D major' }), track('b')])],
      { a: { bpm: 100, key: null, brief: 'ours' } },
    )
    const [a, b] = music.lists[0]!.tracks
    expect(a).toMatchObject({ brief: 'ours', bpm: 100, key: null })
    expect(a!.game).toEqual({ brief: 'a brief', seconds: 80, bpm: 84, key: 'D major' })
    expect(b).toMatchObject({ bpm: null, key: null })
    expect(b!.game).toEqual({ brief: 'b brief', seconds: 80, bpm: null, key: null })
  })

  it('reports an id used twice at both places and shows neither track', () => {
    const { music, problems } = summarizeMusic(
      [list('act1', [track('x'), track('a')]), list('act2', [track('b'), track('x')])],
      {},
    )
    expect(music.lists.map((l) => l.tracks.map((t) => t.id))).toEqual([['a'], ['b']])
    expect(problems.map((p) => [p.file, p.path])).toEqual([
      ['tts/act1/music.json', '[0].id'],
      ['tts/act2/music.json', '[1].id'],
    ])
    expect(problems[0]!.message).toContain('tts/act2/music.json[1].id')
    expect(problems[1]!.message).toContain('tts/act1/music.json[0].id')
  })

  it('counts the tracks left out for a repeated id', () => {
    const { music } = summarizeMusic(
      [list('act1', [track('x'), track('a')]), list('act2', [track('x')])],
      {},
    )
    expect(music.lists.map((l) => l.dropped)).toEqual([1, 1])
  })

  it('catches an id used twice in one list', () => {
    const { music, problems } = summarizeMusic([list('act1', [track('x'), track('x')])], {})
    expect(music.lists[0]!.tracks).toEqual([])
    expect(problems.map((p) => p.path)).toEqual(['[0].id', '[1].id'])
  })

  it('says whether the list can be refreshed', () => {
    const { music } = summarizeMusic([list('act1', [], { canRefresh: false })], {})
    expect(music.lists[0]!.canRefresh).toBe(false)
  })
})

describe('loopsDiff', () => {
  it('lists the tracks added and removed, by id, with their titles', () => {
    expect(loopsDiff([track('a'), track('b')], [track('b'), track('c', { title: 'Sea' })])).toEqual(
      { added: [{ id: 'c', title: 'Sea' }], removed: [{ id: 'a', title: 'A' }] },
    )
  })
})

describe('summarizeMusic with chosen takes', () => {
  const lock = (inputs: LockEntry['inputs']): LockEntry => ({
    fp: '0123456789abcdef',
    model: MUSIC_MODEL,
    seed: 1,
    list: 'act1',
    take: 1,
    inputs,
    at: '2026-11-02T10:00:00.000Z',
  })
  const made = { brief: 'a brief', kind: 'loop' as const, seconds: 80, bpm: null, key: null }
  const rowsOf = (chosen: Parameters<typeof summarizeMusic>[2], briefs = {}) =>
    summarizeMusic([list('act1', [track('a'), track('b'), track('c'), track('d')])], briefs, chosen)
      .music.lists[0]!.tracks

  it('gives each track its status, and what changed for a changed one', () => {
    const rows = rowsOf(
      {
        a: { lock: lock(made), fileExists: true },
        b: { lock: lock({ ...made, seconds: 60 }), fileExists: true },
        c: { lock: lock({ ...made, brief: 'c brief' }), fileExists: false },
      },
      { b: { bpm: 90 } },
    )
    expect(rows.map((r) => r.status)).toEqual(['chosen', 'changed', 'missing', 'not-chosen'])
    expect(rows[1]!.changed).toEqual(['brief', 'length', 'tempo'])
    expect(rows[2]!.changed).toEqual([])
    expect(rows[3]!.chosenAt).toBeNull()
  })

  it('says a track is chosen when its brief is what the take was made from', () => {
    const rows = rowsOf({ a: { lock: lock({ ...made, brief: 'a brief' }), fileExists: true } })
    expect(rows[0]!).toMatchObject({
      status: 'chosen',
      changed: [],
      chosenAt: '2026-11-02T10:00:00.000Z',
    })
  })

  it('takes a stinger’s kind from its list', () => {
    const { music } = summarizeMusic(
      [list('stingers', [track('v', { seconds: 5 })])],
      {},
      {
        v: {
          lock: lock({ ...made, kind: 'stinger', seconds: 5, brief: 'v brief' }),
          fileExists: true,
        },
      },
    )
    expect(music.lists[0]!.tracks[0]!.status).toBe('chosen')
  })
})

describe('fieldSource', () => {
  const rows = (change: Parameters<typeof summarizeMusic>[1], extra: Partial<Track> = {}) =>
    summarizeMusic([list('act1', [track('a', extra)])], change).music.lists[0]!.tracks[0]!

  it('says from the game, changed here, or not set', () => {
    const row = rows({ a: { seconds: 60, key: null } }, { key: 'D major', bpm: 84 })
    expect(fieldSource(row, 'brief')).toBe('game')
    expect(fieldSource(row, 'seconds')).toBe('changed')
    expect(fieldSource(row, 'bpm')).toBe('game')
    expect(fieldSource(row, 'key')).toBe('changed')
  })

  it('calls a tempo the game did not give not set, and a tempo added here changed', () => {
    expect(fieldSource(rows({}), 'bpm')).toBe('unset')
    expect(fieldSource(rows({ a: { bpm: 90 } }), 'bpm')).toBe('changed')
  })
})

describe('applyBriefChange', () => {
  const game = { brief: 'g', seconds: 80, bpm: 84, key: 'D major' }

  it('records a change, in id order', () => {
    const next = applyBriefChange({ z: { seconds: 5 } }, 'a', 'brief', 'ours', game)
    expect(Object.keys(next)).toEqual(['a', 'z'])
    expect(next.a).toEqual({ brief: 'ours' })
  })

  it('drops a field typed back to the game’s, and the entry once empty', () => {
    const next = applyBriefChange(
      { a: { brief: 'ours' }, b: { seconds: 5 } },
      'a',
      'brief',
      'g',
      game,
    )
    expect(next).toEqual({ b: { seconds: 5 } })
    const kept = applyBriefChange({ a: { brief: 'ours', seconds: 5 } }, 'a', 'brief', 'g', game)
    expect(kept).toEqual({ a: { seconds: 5 } })
  })

  it('stores null for no tempo over the game’s, and nothing when the game has none', () => {
    expect(applyBriefChange({}, 'a', 'bpm', null, game)).toEqual({ a: { bpm: null } })
    const none = { ...game, bpm: null, key: null }
    expect(applyBriefChange({ a: { bpm: 90 } }, 'a', 'bpm', null, none)).toEqual({})
    expect(applyBriefChange({}, 'a', 'key', null, none)).toEqual({})
  })

  it('keeps the fields of an entry in one order, whichever was set first', () => {
    const a = applyBriefChange({ a: { seconds: 60 } }, 'a', 'brief', 'x', game)
    const b = applyBriefChange({ a: { brief: 'x' } }, 'a', 'seconds', 60, game)
    expect(JSON.stringify(a)).toBe('{"a":{"brief":"x","seconds":60}}')
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
    const c = applyBriefChange({ a: { key: 'C', bpm: 90 } }, 'a', 'brief', 'x', game)
    expect(Object.keys(c.a!)).toEqual(['brief', 'bpm', 'key'])
  })

  it('does not change the briefs it was given', () => {
    const before = { a: { brief: 'ours' } }
    applyBriefChange(before, 'a', 'brief', 'g', game)
    expect(before).toEqual({ a: { brief: 'ours' } })
  })
})

describe('BriefChangeBody', () => {
  it('takes any length and brief the game’s own list could hold', () => {
    expect(BriefChangeBody.safeParse({ seconds: 4000 }).success).toBe(true)
    expect(BriefChangeBody.safeParse({ brief: 'x'.repeat(6000) }).success).toBe(true)
  })
})

describe('parseClock', () => {
  it('reads minutes and seconds', () => {
    expect(parseClock('1:20')).toBe(80)
    expect(parseClock(' 0:05 ')).toBe(5)
    expect(parseClock('12:00')).toBe(720)
  })

  it('refuses anything else', () => {
    for (const bad of ['90', '1:75', '0:00', '', 'a:bc', '1:2', '-1:20', '1:20:00']) {
      expect(parseClock(bad)).toBeNull()
    }
  })
})

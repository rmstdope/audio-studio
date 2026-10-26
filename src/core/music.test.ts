import { describe, expect, it } from 'bun:test'
import {
  BriefsSchema,
  LoopListSchema,
  StingerListSchema,
  loopsDiff,
  summarizeMusic,
  type MusicListInput,
  type Track,
} from './music'
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

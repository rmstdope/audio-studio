import { describe, expect, test } from 'bun:test'
import { planMakeAll, TAKES_EACH, type MakeAllTrack } from './musicMakeAll'
import { MAX_STINGER_SECONDS } from './music'
import { MUSIC_MODEL_IDS, takesButton } from './musicModels'

const track = (id: string, over: Partial<MakeAllTrack> = {}): MakeAllTrack => ({
  id,
  title: id,
  seconds: 30,
  status: 'not-chosen',
  ...over,
})

const plan = (
  tracks: MakeAllTrack[],
  over: Partial<Parameters<typeof planMakeAll>[0]> = {},
): ReturnType<typeof planMakeAll> =>
  planMakeAll({ kind: 'loop', tracks, making: {}, model: 'balanced', ready: true, ...over })

describe('planMakeAll', () => {
  test('lists every track with no chosen take, four takes each', () => {
    const result = plan([track('a'), track('b'), track('c', { status: 'chosen' })])
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.tracks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(result.takes).toBe(2 * TAKES_EACH)
    expect(result.chosen.map((t) => t.id)).toEqual(['c'])
    expect(result.price).toBeNull()
    // Balanced takes about 3 minutes a take, one after another.
    expect(result.seconds).toBe(8 * 180)
  })

  test('a track whose brief changed, or whose file is gone, has a chosen take and gets none', () => {
    const result = plan([
      track('a'),
      track('b', { status: 'changed' }),
      track('c', { status: 'missing' }),
    ])
    if (result.kind !== 'ready') throw new Error(result.kind)
    expect(result.tracks.map((t) => t.id)).toEqual(['a'])
    expect(result.chosen.map((t) => t.id)).toEqual(['b', 'c'])
  })

  test('a track already making takes is left out, even with no chosen take', () => {
    const result = plan([track('a'), track('b')], {
      making: { b: { takes: 2, left: 5, failed: 0 } },
    })
    if (result.kind !== 'ready') throw new Error(result.kind)
    expect(result.tracks.map((t) => t.id)).toEqual(['a'])
    expect(result.busy.map((t) => t.id)).toEqual(['b'])
  })

  test('a track with only failed takes is not busy', () => {
    const result = plan([track('a')], { making: { a: { takes: 0, left: 0, failed: 1 } } })
    if (result.kind !== 'ready') throw new Error(result.kind)
    expect(result.tracks.map((t) => t.id)).toEqual(['a'])
  })

  test('a track longer than the model can make is left out and named', () => {
    const result = plan([track('a', { seconds: 20 }), track('b', { seconds: 90 })], {
      model: 'short',
    })
    if (result.kind !== 'ready') throw new Error(result.kind)
    expect(result.tracks.map((t) => t.id)).toEqual(['a'])
    expect(result.tooLong.map((t) => t.id)).toEqual(['b'])
  })

  test('the model can make none of them', () => {
    const result = plan([track('a', { seconds: 90 }), track('b', { seconds: 100 })], {
      model: 'short',
    })
    expect(result).toEqual({ kind: 'none-possible', model: 'short', count: 2 })
  })

  test('every track having a chosen take', () => {
    expect(plan([track('a', { status: 'chosen' })])).toEqual({ kind: 'all-chosen' })
  })

  test('music that cannot be made yet says so before anything else', () => {
    expect(plan([track('a')], { ready: false })).toEqual({ kind: 'not-ready' })
  })

  test('a paid model adds the price of each take as the track buttons say it', () => {
    const result = plan([track('a', { seconds: 40 }), track('b', { seconds: 100 })], {
      model: 'eleven',
    })
    if (result.kind !== 'ready') throw new Error(result.kind)
    // $0.15 a minute: (40+20)s = $0.15, (100+20)s = $0.30, four takes each.
    expect(result.price).toBeCloseTo(1.8, 5)
    expect(result.seconds).toBe(8 * 60)
  })

  test('the total agrees with the take buttons on each track', () => {
    const tracks = [track('a', { seconds: 40 }), track('b', { seconds: 100 })]
    const result = plan(tracks, { model: 'eleven' })
    if (result.kind !== 'ready') throw new Error(result.kind)
    const buttons = tracks.map((t) =>
      takesButton('Make', 'eleven', { kind: 'loop', seconds: t.seconds }, TAKES_EACH),
    )
    const sum = buttons.reduce((total, label) => total + Number(label.split('$')[1]), 0)
    expect(result.price!.toFixed(2)).toBe(sum.toFixed(2))
  })

  test('stingers are generated at their own length', () => {
    const result = plan([track('a', { seconds: 5 })], { kind: 'stinger', model: 'eleven' })
    if (result.kind !== 'ready') throw new Error(result.kind)
    // 10 s at $0.15 a minute is 2.5 cents, shown as 3 cents a take, four takes each.
    expect(result.price).toBeCloseTo(0.12, 5)
  })

  test('tracks whose chosen state is not known are neither counted nor named', () => {
    const result = plan([track('a'), track('b', { status: 'unknown' })])
    if (result.kind !== 'ready') throw new Error(result.kind)
    expect(result.tracks.map((t) => t.id)).toEqual(['a'])
    expect(result.chosen).toEqual([])
  })
})

describe('planMakeAll for stingers', () => {
  test('never leaves a longest stinger out for its length, on any model', () => {
    for (const model of MUSIC_MODEL_IDS) {
      const result = plan([track('a', { seconds: MAX_STINGER_SECONDS })], {
        kind: 'stinger',
        model,
      })
      expect(result.kind).toBe('ready')
      if (result.kind === 'ready') expect(result.tooLong).toEqual([])
    }
  })
})

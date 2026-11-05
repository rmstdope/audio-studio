import { describe, expect, it } from 'bun:test'
import {
  chipFor,
  expectedFigures,
  scaleMix,
  shiftStates,
  suggestChange,
  formatLufs,
  measureChanged,
  planStateMix,
  sceneStateNames,
  sceneVerdict,
  statesPlaying,
  withoutName,
  targetLine,
  WINDOW_SECONDS,
  type PlanEffect,
  type SceneMeasure,
} from './sceneLoudness'
import type { SceneMix } from './scenes'

const effect = (over: Partial<PlanEffect>): PlanEffect => ({
  id: 'bell',
  play: { mode: 'loop' },
  state: null,
  level: 1,
  seconds: 2,
  ...over,
})

const plan = (effects: PlanEffect[], state: string | null = null) =>
  planStateMix({ music: null, effects, state })

describe('planStateMix', () => {
  it('plays the music as a loop at its level', () => {
    const parts = planStateMix({ music: { track: 'theme', level: 0.5 }, effects: [], state: null })
    expect(parts).toEqual([
      { source: { kind: 'music', id: 'theme' }, level: 0.5, loop: true, starts: [0] },
    ])
  })

  it('plays a loop effect the whole window', () => {
    expect(plan([effect({ level: 2 })])).toEqual([
      { source: { kind: 'effect', id: 'bell' }, level: 2, loop: true, starts: [0] },
    ])
  })

  it('starts a random effect in the middle of its range, then after each clip and the middle wait', () => {
    const [part] = plan([effect({ play: { mode: 'random', everySeconds: [10, 20] }, seconds: 5 })])
    expect(part!.loop).toBe(false)
    expect(part!.starts).toEqual([15, 35, 55])
  })

  it('starts a once effect at its delay if that is inside the window', () => {
    expect(plan([effect({ play: { mode: 'once', afterSeconds: 4 } })])[0]!.starts).toEqual([4])
    expect(plan([effect({ play: { mode: 'once', afterSeconds: WINDOW_SECONDS } })])).toEqual([])
  })

  it('leaves out a trigger effect, which the player fires', () => {
    expect(plan([effect({ play: { mode: 'trigger', trigger: 'door' } })])).toEqual([])
  })

  it('plays only the effects of the state, and those with no state', () => {
    const rows = [
      effect({ id: 'a', state: 'dim' }),
      effect({ id: 'b', state: 'lit' }),
      effect({ id: 'c', state: null }),
    ]
    expect(plan(rows, 'dim').map((p) => p.source.id)).toEqual(['a', 'c'])
    expect(plan(rows, null).map((p) => p.source.id)).toEqual(['c'])
  })

  it('leaves out what has no clip, music included', () => {
    expect(plan([effect({ seconds: null })])).toEqual([])
    expect(
      planStateMix({
        music: { track: 'theme', level: 1, missing: true },
        effects: [],
        state: null,
      }),
    ).toEqual([])
  })

  it('never spins on a random effect with no wait and no length', () => {
    const [part] = plan([effect({ play: { mode: 'random', everySeconds: [0, 0] }, seconds: 0 })])
    expect(part!.starts.length).toBeLessThanOrEqual(WINDOW_SECONDS * 2)
  })
})

describe('sceneStateNames', () => {
  it('is the states in order, or the scene itself', () => {
    expect(sceneStateNames({ states: ['plain', 'lit'] })).toEqual(['plain', 'lit'])
    expect(sceneStateNames({ states: [] })).toEqual([null])
  })
})

describe('words', () => {
  it('writes a figure with a true minus and one decimal', () => {
    expect(formatLufs(-19.44)).toBe('−19.4 LUFS')
    expect(formatLufs(-20)).toBe('−20.0 LUFS')
  })

  it('words the target', () => {
    expect(targetLine({ target: -20, tolerance: 2 })).toBe('target −20 LUFS ± 2 dB')
    expect(targetLine({ target: -18.5, tolerance: 1.5 })).toBe('target −18.5 LUFS ± 1.5 dB')
    expect(targetLine(null)).toBe('no target set')
  })

  it('judges a figure against the target and tolerance', () => {
    const t = { target: -20, tolerance: 2 }
    expect(chipFor(-19.4, t)).toEqual({ kind: 'on', text: 'on target' })
    expect(chipFor(-22, t)).toEqual({ kind: 'on', text: 'on target' })
    expect(chipFor(-23.8, t)).toEqual({ kind: 'quiet', text: '3.8 dB too quiet' })
    expect(chipFor(-15.9, t)).toEqual({ kind: 'loud', text: '4.1 dB too loud' })
    expect(chipFor(null, t)).toBeNull()
    expect(chipFor(-19, null)).toBeNull()
  })

  it('judges the figure as shown, to one decimal', () => {
    const t = { target: -20, tolerance: 2 }
    expect(chipFor(-22.04, t)).toEqual({ kind: 'on', text: 'on target' })
    expect(chipFor(-22.05, t)).toEqual({ kind: 'quiet', text: '2.1 dB too quiet' })
    expect(chipFor(-17.96, t)).toEqual({ kind: 'on', text: 'on target' })
    expect(chipFor(-17.94, t)).toEqual({ kind: 'loud', text: '2.1 dB too loud' })
    // 0.1 apart is within a tolerance of 0.1, though the subtraction gives 0.10000000000000142.
    expect(chipFor(-19.9, { target: -20, tolerance: 0.1 })).toEqual({
      kind: 'on',
      text: 'on target',
    })
  })
})

const measure = (states: (number | null)[], over: Partial<SceneMeasure> = {}): SceneMeasure => ({
  measuredAt: '2026-11-05T14:02:00.000Z',
  entry: null,
  clips: {},
  states: states.map((lufs, i) => ({ state: `s${i}`, lufs })),
  without: [],
  error: null,
  ...over,
})

describe('sceneVerdict', () => {
  const t = { target: -20, tolerance: 2 }
  it('is null when every state is on target, nothing plays, or there is no target', () => {
    expect(sceneVerdict(measure([-19, -21, null]), t)).toBeNull()
    expect(sceneVerdict(measure([-30]), null)).toBeNull()
  })
  it('says which way a scene is off, or off target when the states differ', () => {
    expect(sceneVerdict(measure([-19, -15]), t)).toBe('too loud')
    expect(sceneVerdict(measure([-25]), t)).toBe('too quiet')
    expect(sceneVerdict(measure([-25, -15]), t)).toBe('off target')
  })
  it('flags nothing for a measure that failed', () => {
    expect(sceneVerdict(measure([-40], { error: 'no' }), t)).toBeNull()
  })
  it('judges the figure as shown', () => {
    expect(sceneVerdict(measure([-22.04]), t)).toBeNull()
    expect(sceneVerdict(measure([-22.05]), t)).toBe('too quiet')
  })
})

describe('measureChanged', () => {
  const now = { entry: { effects: [] }, clips: { 'effect:a': 'take 1' } }
  const was = measure([-20], { entry: { effects: [] }, clips: { 'effect:a': 'take 1' } })
  it('is false when the entry and the clips are the same', () => {
    expect(measureChanged(was, now)).toBe(false)
  })
  it('says nothing changed for a measure that failed', () => {
    expect(measureChanged({ ...was, error: 'no', clips: {} }, now)).toBe(false)
  })
  it('is true when the entry was saved differently or a take changed', () => {
    expect(
      measureChanged(was, { ...now, entry: { effects: [], music: { track: null, level: 1 } } }),
    ).toBe(true)
    expect(measureChanged(was, { ...now, clips: { 'effect:a': 'take 2' } })).toBe(true)
    expect(measureChanged(was, { ...now, clips: {} })).toBe(true)
  })
})

const t2 = { target: -20, tolerance: 2 }
const mixOf = (levels: Record<string, number>, music = 1): SceneMix => ({
  music: { track: 'theme', level: music },
  effects: Object.entries(levels).map(([id, level]) => ({
    id,
    play: { mode: 'loop' as const },
    level,
  })),
})

describe('scaleMix', () => {
  it('multiplies every level by the same factor, to a whole percent', () => {
    const out = scaleMix(mixOf({ a: 0.6, b: 0.5 }), 4)
    expect(out.music?.level).toBe(1.58)
    expect(out.effects.map((e) => e.level)).toEqual([0.95, 0.79])
  })
  it('leaves 0% at 0% and stops at 300%', () => {
    const out = scaleMix(mixOf({ a: 0, b: 2.6 }), 4)
    expect(out.effects.map((e) => e.level)).toEqual([0, 3])
  })
  it('keeps a scene with no music as it is', () => {
    expect(scaleMix({ music: undefined, effects: [] }, 3).music).toBeUndefined()
  })
})

describe('suggestChange', () => {
  const mix = mixOf({ a: 1 })
  const change = (lufs: number[], m = mix) => suggestChange(measure(lufs), t2, m)
  it('offers the even change that puts the middle of the states on the target', () => {
    expect(change([-23.4, -24.6])).toMatchObject({ kind: 'change', db: 4, closest: null })
    expect(change([-16.2, -17])).toMatchObject({ kind: 'change', db: -3.4 })
  })
  it('works for a scene with one state', () => {
    expect(change([-24.1])).toMatchObject({ kind: 'change', db: 4.1, states: 1 })
  })
  it('leaves out states that read nothing', () => {
    expect(change([null as never, -24.1])).toMatchObject({ db: 4.1, states: 1 })
  })
  it('offers the closest change when no single one fits', () => {
    expect(change([-19.4, -23.8])).toMatchObject({
      kind: 'change',
      db: 1.6,
      closest: { apart: 4.4, leaving: 0.2 },
    })
  })
  it('limits a louder change to what keeps every level within 300%', () => {
    const out = change([-23.4, -24.6], mixOf({ 'cat-purr': 2.6 }, 1))
    expect(out).toMatchObject({
      db: 1.2,
      ceiling: { sound: 'cat-purr', still: [2.2, 3.4] },
    })
  })
  it('is not a ceiling when the capped change still brings every state within the tolerance', () => {
    const out = suggestChange(measure([-22.1, -22.3]), t2, mixOf({ a: 2.85 }))
    expect(out).toMatchObject({ kind: 'change', ceiling: null })
  })
  it('offers nothing when states disagree and the closest change is under 0.5 dB', () => {
    expect(change([-16.9, -22.8])).toEqual({ kind: 'none', loud: ['s0'], quiet: ['s1'] })
  })
  it('is null when on target, nothing plays, it could not be measured, or no states read', () => {
    expect(change([-19.4, -20.6])).toBeNull()
    expect(change([null as never])).toBeNull()
    expect(suggestChange(measure([-24], { error: 'x' }), t2, mix)).toBeNull()
  })
  it('judges the figures as shown', () => {
    expect(change([-22.04])).toBeNull()
    expect(change([-22.05])).toMatchObject({ kind: 'change', db: 2.1 })
  })
})

describe('expectedFigures', () => {
  const entry = mixOf({ a: 0.6 })
  const base = measure([-23.4], { entry, clips: { a: '1' } })
  it('is expected while the scene is the measured one moved by the change', () => {
    const now = { entry: scaleMix(entry, 4), clips: { a: '1' } }
    expect(expectedFigures(base, { db: 4 }, now)).toBe('expected')
  })
  it('is measured while the scene is as measured, and changed otherwise', () => {
    expect(expectedFigures(base, { db: 4 }, { entry, clips: { a: '1' } })).toBe('measured')
    expect(expectedFigures(base, null, { entry: scaleMix(entry, 4), clips: { a: '1' } })).toBe(
      'changed',
    )
    expect(expectedFigures(base, { db: 4 }, { entry: mixOf({ a: 0.7 }), clips: { a: '1' } })).toBe(
      'changed',
    )
  })
  it('is expected for a scene that had no entry or no music key, as the page fills them in', () => {
    const page = { music: { track: 'theme', level: 1.58 }, effects: [] }
    expect(
      expectedFigures(measure([-24], { entry: null }), { db: 4 }, { entry: page, clips: {} }),
    ).toBe('expected')
    const noMusic = measure([-24], { entry: { effects: [] } })
    expect(expectedFigures(noMusic, { db: 4 }, { entry: page, clips: {} })).toBe('expected')
  })
  it('is expected for a scene with no music track, whose level the press leaves alone', () => {
    const page = {
      music: { track: null, level: 1 },
      effects: [{ ...mixOf({ a: 0.6 }).effects[0]!, level: 0.95 }],
    }
    const m = measure([-24], { entry: { effects: mixOf({ a: 0.6 }).effects }, clips: { a: '1' } })
    expect(expectedFigures(m, { db: 4 }, { entry: page, clips: { a: '1' } })).toBe('expected')
  })
  it('is not expected when the music was taken off after the press', () => {
    const withMusic = { music: { track: 'theme', level: 1 }, effects: [] }
    const page = { music: { track: null, level: 1 }, effects: [] }
    expect(
      expectedFigures(measure([-24], { entry: withMusic }), { db: 4 }, { entry: page, clips: {} }),
    ).toBe('changed')
  })
  it('shifts every figure and keeps what reads nothing', () => {
    const shifted = shiftStates(measure([-23.4, null as never]), 4)
    expect(shifted.states.map((s) => s.lufs)).toEqual([-19.4, null])
  })
})

describe('statesPlaying', () => {
  const states = ['calm', 'rainy']
  it('plays a loop in every state, or only in its own', () => {
    expect(statesPlaying({ play: { mode: 'loop' }, state: null }, states)).toEqual(states)
    expect(statesPlaying({ play: { mode: 'loop' }, state: 'rainy' }, states)).toEqual(['rainy'])
  })
  it('never plays a trigger, or an effect of a state the scene lacks', () => {
    expect(
      statesPlaying({ play: { mode: 'trigger', trigger: 'open' }, state: null }, states),
    ).toEqual([])
    expect(statesPlaying({ play: { mode: 'loop' }, state: 'flooded' }, states)).toEqual([])
  })
  it('plays once only inside the minute, and a random one when its first wait is', () => {
    expect(
      statesPlaying({ play: { mode: 'once', afterSeconds: 90 }, state: null }, [null]),
    ).toEqual([])
    expect(
      statesPlaying({ play: { mode: 'once', afterSeconds: 10 }, state: null }, [null]),
    ).toEqual([null])
    expect(
      statesPlaying({ play: { mode: 'random', everySeconds: [100, 140] }, state: null }, [null]),
    ).toEqual([])
    expect(
      statesPlaying({ play: { mode: 'random', everySeconds: [10, 30] }, state: null }, [null]),
    ).toEqual([null])
  })
})

describe('withoutName', () => {
  const all = ['calm', 'rainy', 'storm']
  it('adds no state for every state, or a scene without states', () => {
    expect(withoutName('fire', all, all)).toBe('fire')
    expect(withoutName('fire', [null], [null])).toBe('fire')
  })
  it('lists the states like a sentence', () => {
    expect(withoutName('rain', ['rainy'], all)).toBe('rain in rainy')
    expect(withoutName('rain', ['rainy', 'storm'], all)).toBe('rain in rainy and storm')
    expect(withoutName('rain', ['calm', 'rainy', 'storm'], ['calm', 'rainy', 'storm', 'dry'])).toBe(
      'rain in calm, rainy and storm',
    )
  })
})

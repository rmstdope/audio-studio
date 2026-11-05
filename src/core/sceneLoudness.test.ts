import { describe, expect, it } from 'bun:test'
import {
  chipFor,
  formatLufs,
  measureChanged,
  planStateMix,
  sceneStateNames,
  sceneVerdict,
  targetLine,
  WINDOW_SECONDS,
  type PlanEffect,
  type SceneMeasure,
} from './sceneLoudness'

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

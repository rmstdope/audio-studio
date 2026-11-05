import { describe, expect, it } from 'bun:test'
import type { SceneRow } from '../core/scenes'
import {
  howItPlays,
  levelText,
  listCount,
  measuredLine,
  statesLine,
  trackProblemChip,
} from './scenesText'

describe('how an effect plays', () => {
  it('is written as the page words it', () => {
    expect(howItPlays({ mode: 'loop' })).toBe('Round and round')
    expect(howItPlays({ mode: 'random', everySeconds: [15, 30] })).toBe(
      'Now and then, every 15–30 s',
    )
    expect(howItPlays({ mode: 'once', afterSeconds: 1.5 })).toBe('Once, 1.5 s after entering')
    expect(howItPlays({ mode: 'trigger', trigger: 'door-opens' })).toBe('On a trigger: door-opens')
  })
})

describe('a level', () => {
  it('is a whole percent', () => {
    expect(levelText(1)).toBe('100%')
    expect(levelText(0.6)).toBe('60%')
    expect(levelText(0.625)).toBe('63%')
    expect(levelText(3)).toBe('300%')
    expect(levelText(0)).toBe('0%')
  })
})

describe('what a scene list row says', () => {
  const row = (over: Partial<SceneRow>, effects = 0) =>
    ({ gone: 0, silent: 0, unreadable: false, effects: new Array(effects), ...over }) as SceneRow

  it('counts effects, none when there are none', () => {
    expect(listCount(row({}, 2))).toEqual({ text: '2 effects', red: false })
    expect(listCount(row({}, 1))).toEqual({ text: '1 effect', red: false })
    expect(listCount(row({}, 0))).toEqual({ text: 'none', red: false })
  })

  it('counts what is gone before what is silent, in red', () => {
    expect(listCount(row({ gone: 1, silent: 1 }, 3))).toEqual({ text: '1 gone', red: true })
    expect(listCount(row({ silent: 2 }, 3))).toEqual({ text: '2 silent', red: true })
  })

  it('says a scene that cannot be read is unreadable, in red', () => {
    expect(listCount(row({ unreadable: true }))).toEqual({ text: 'unreadable', red: true })
  })
})

describe('the line under the scene’s name', () => {
  it('lists the states and the triggers', () => {
    expect(statesLine({ states: ['plain', 'cat-home'], triggers: ['door-opens'] })).toBe(
      'States: plain, cat-home · Triggers: door-opens',
    )
  })
  it('says none for what the scene has none of', () => {
    expect(statesLine({ states: [], triggers: [] })).toBe('No states · No triggers')
    expect(statesLine({ states: [], triggers: ['bell-tolls'] })).toBe(
      'States: none · Triggers: bell-tolls',
    )
    expect(statesLine({ states: ['plain'], triggers: [] })).toBe('States: plain · Triggers: none')
  })
})

describe('the chip beside a track that plays nothing', () => {
  it('is red and names the missing take', () => {
    expect(trackProblemChip('Village lane', { kind: 'take', take: 3 })).toEqual({
      text: 'file not there',
      title: 'Take 3 of Village lane is not there.',
      tone: 'danger',
    })
  })
  it('is red and names the missing game file', () => {
    expect(
      trackProblemChip('Village lane', { kind: 'file', file: 'music/village-lane.wav' }),
    ).toEqual({
      text: 'file not there',
      title: "The game's file village-lane.wav is not there.",
      tone: 'danger',
    })
  })
  it('is amber when there is nothing to play at all', () => {
    expect(trackProblemChip('Village lane', { kind: 'nothing' })).toEqual({
      text: 'no take chosen',
      title: undefined,
      tone: 'warn',
    })
  })
})

describe('what a scene list row says of its loudness', () => {
  const target = { target: -20, tolerance: 2 }
  const measure = (lufs: (number | null)[], error: string | null = null) => ({
    measuredAt: '2026-11-05T14:02:00.000Z',
    entry: null,
    clips: {},
    states: lufs.map((l, i) => ({ state: `s${i}`, lufs: l })),
    without: [],
    error,
  })
  const row = (over: Partial<SceneRow>, effects = 1) =>
    ({
      gone: 0,
      silent: 0,
      unreadable: false,
      effects: new Array(effects),
      loudness: { saved: null, draft: null },
      ...over,
    }) as SceneRow

  it('says too loud, too quiet or off target in amber, in place of the count', () => {
    const saved = (l: (number | null)[]) => row({ loudness: { saved: measure(l), draft: null } })
    expect(listCount(saved([-15]), target)).toEqual({ text: 'too loud', red: false, warn: true })
    expect(listCount(saved([-25]), target)).toEqual({ text: 'too quiet', red: false, warn: true })
    expect(listCount(saved([-25, -15]), target)).toEqual({
      text: 'off target',
      red: false,
      warn: true,
    })
  })

  it('leaves the count when on target, with nothing playing, or never measured', () => {
    const plain = { text: '1 effect', red: false }
    expect(listCount(row({ loudness: { saved: measure([-19]), draft: null } }), target)).toEqual(
      plain,
    )
    expect(listCount(row({ loudness: { saved: measure([null]), draft: null } }), target)).toEqual(
      plain,
    )
    expect(listCount(row({}), target)).toEqual(plain)
  })

  it('lets a red problem win the column', () => {
    const loud = { saved: measure([-10]), draft: null }
    expect(listCount(row({ silent: 1, loudness: loud }), target)).toEqual({
      text: '1 silent',
      red: true,
    })
  })

  it('flags nothing without a target', () => {
    const loud = { saved: measure([-10]), draft: null }
    expect(listCount(row({ loudness: loud }), null)).toEqual({ text: '1 effect', red: false })
  })

  it('falls back to the draft measure when the scene was never measured saved', () => {
    expect(listCount(row({ loudness: { saved: null, draft: measure([-10]) } }), target).text).toBe(
      'too loud',
    )
  })
})

describe('when a scene was measured', () => {
  const now = new Date(2026, 10, 5, 15, 30)
  it('says today and yesterday with the time, an older day with its date', () => {
    expect(measuredLine(new Date(2026, 10, 5, 14, 2).toISOString(), now)).toBe(
      'Measured today 14:02',
    )
    expect(measuredLine(new Date(2026, 10, 4, 16, 40).toISOString(), now)).toBe(
      'Measured yesterday 16:40',
    )
    expect(measuredLine(new Date(2026, 10, 3, 9, 5).toISOString(), now)).toBe(
      'Measured 3 Nov 09:05',
    )
  })
})

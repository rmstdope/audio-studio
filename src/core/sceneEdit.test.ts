import { describe, expect, it } from 'bun:test'
import {
  addEffect,
  draftOf,
  fixHeading,
  redRows,
  rowProblems,
  sameDraft,
  sameMix,
  switchMode,
  toMix,
  type EffectDraft,
} from './sceneEdit'
import type { SceneEffectChoice, SceneMix, SceneRow } from './scenes'

const row = (entry: SceneMix | null, over: Partial<SceneRow> = {}): SceneRow =>
  ({
    id: 'store',
    name: 'General store',
    states: ['plain', 'cat-home'],
    triggers: ['door-opens'],
    music: { track: 'store', name: 'Store', level: 1, playable: true, gone: false },
    effects: (entry?.effects ?? []).map((e) => ({
      id: e.id,
      name: e.id,
      play: e.play,
      state: e.state ?? null,
      level: e.level,
    })),
    entry,
    unreadable: false,
    gone: 0,
    silent: 0,
    ...over,
  }) as unknown as SceneRow

const full: SceneMix = {
  music: { track: 'store', level: 0.8 },
  effects: [
    { id: 'bell', play: { mode: 'once', afterSeconds: 1.5 }, level: 0.6 },
    { id: 'clink', play: { mode: 'random', everySeconds: [15, 30] }, level: 0.5 },
    { id: 'purr', play: { mode: 'loop' }, state: 'cat-home', level: 1 },
    { id: 'creak', play: { mode: 'trigger', trigger: 'door-opens' }, level: 3 },
  ],
}

describe('draftOf and toMix', () => {
  it('round-trips a scene', () => {
    expect(toMix(draftOf(row(full)))).toEqual({ ...full, music: { track: 'store', level: 1 } })
  })

  it('takes the music from the row (the scene’s own track when the mix has none)', () => {
    expect(draftOf(row(null)).music).toEqual({ track: 'store', level: 1 })
  })

  it('writes decimals and leaves the state out for Always', () => {
    const draft = draftOf(row(full))
    expect(toMix(draft).effects[0]!.play).toEqual({ mode: 'once', afterSeconds: 1.5 })
    expect('state' in toMix(draft).effects[0]!).toBe(false)
  })
})

describe('adding and switching', () => {
  const choice = (loops: boolean): SceneEffectChoice => ({
    id: 'wind',
    name: 'Wind',
    loops,
    silent: false,
    playable: true,
  })

  it('adds a loop as Round and round and a one-shot as Now and then 10–20 s', () => {
    const loop = addEffect(draftOf(row(null)), choice(true)).effects[0]!
    expect(toMix({ music: { track: null, level: 1 }, effects: [loop] }).effects[0]).toEqual({
      id: 'wind',
      play: { mode: 'loop' },
      level: 1,
    })
    const shot = addEffect(draftOf(row(null)), choice(false)).effects[0]!
    expect(shot.mode).toBe('random')
    expect(shot.every).toEqual(['10', '20'])
    expect(shot.state).toBeNull()
    expect(shot.level).toBe(1)
  })

  it('starts Once at 0 and On a trigger at the first trigger', () => {
    const base = draftOf(row(null)).effects
    const e = addEffect(draftOf(row(null)), choice(true)).effects[0]!
    expect(base).toEqual([])
    expect(switchMode(e, 'once', ['door-opens']).after).toBe('0')
    expect(switchMode(e, 'trigger', ['door-opens']).trigger).toBe('door-opens')
  })

  it('keeps what was typed when switching back and forth', () => {
    const e: EffectDraft = { ...draftOf(row(full)).effects[1]!, every: ['3', '4'] }
    const there = switchMode(switchMode(e, 'once', []), 'random', [])
    expect(there.every).toEqual(['3', '4'])
  })
})

describe('rowProblems', () => {
  const base = (over: Partial<EffectDraft>): EffectDraft => ({
    ...draftOf(row(full)).effects[1]!,
    ...over,
  })

  it('accepts 0, 600 and decimals', () => {
    expect(rowProblems(base({ every: ['0', '600'] })).lines).toEqual([])
    expect(rowProblems(base({ mode: 'once', after: '1.5' })).lines).toEqual([])
    expect(rowProblems(base({ mode: 'once', after: '0' })).lines).toEqual([])
  })

  it('flags empty, not a number and negative', () => {
    for (const bad of ['', ' ', 'abc', '-1']) {
      const p = rowProblems(base({ mode: 'once', after: bad }))
      expect(p.after).toBe(true)
      expect(p.lines).toEqual(['Type a number of seconds.'])
    }
  })

  it('flags over 600', () => {
    const p = rowProblems(base({ every: ['20', '900'] }))
    expect(p.second).toBe(true)
    expect(p.first).toBe(false)
    expect(p.lines).toEqual(['At most 600 seconds.'])
  })

  it('needs the first number strictly smaller than the second, both boxes red', () => {
    for (const every of [
      ['30', '15'],
      ['15', '15'],
    ] as [string, string][]) {
      const p = rowProblems(base({ every }))
      expect([p.first, p.second]).toEqual([true, true])
      expect(p.lines).toEqual(['The first number must be smaller than the second.'])
    }
  })

  it('checks only the boxes of the mode in use', () => {
    expect(rowProblems(base({ mode: 'loop', every: ['', 'x'], after: '' })).lines).toEqual([])
  })

  it('counts red rows and words the heading', () => {
    const draft = draftOf(row(full))
    draft.effects[0]!.after = ''
    draft.effects[1]!.every = ['9', '1']
    expect(redRows(draft)).toBe(2)
    expect(fixHeading(2)).toBe('Fix the 2 red rows to save')
    expect(fixHeading(1)).toBe('Fix the 1 red row to save')
  })
})

describe('sameMix and sameDraft', () => {
  it('ignores key order and an absent effects list', () => {
    const a: SceneMix = { effects: [{ level: 1, id: 'x', play: { mode: 'loop' } }] }
    const b: SceneMix = { effects: [{ id: 'x', play: { mode: 'loop' }, level: 1 }] }
    expect(sameMix(a, b)).toBe(true)
    expect(sameMix(null, { effects: [] })).toBe(false)
    expect(sameMix(null, null)).toBe(true)
    expect(sameMix(a, { effects: [] })).toBe(false)
    expect(sameMix({ music: { track: null, level: 1 }, effects: [] }, { effects: [] })).toBe(false)
  })

  it('tells an edited draft from the saved one', () => {
    const saved = draftOf(row(full))
    expect(sameDraft(saved, draftOf(row(full)))).toBe(true)
    const edited = draftOf(row(full))
    edited.effects[2]!.level = 0.5
    expect(sameDraft(saved, edited)).toBe(false)
  })
})

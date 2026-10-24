import { describe, expect, it } from 'bun:test'
import type { LineState } from './planner'
import { planGeneration } from './generation'

function line(
  key: string,
  speaker: string,
  status: LineState['status'],
  reasons: LineState['reasons'] = [],
  text = 'Hello there.',
): LineState {
  return {
    key,
    speaker,
    text,
    cue: '',
    ownCue: false,
    status,
    reasons,
    heard: null,
    duration: null,
    file: null,
  }
}

const state = {
  lines: [
    line('m1', 'narrator', 'missing', [], 'Once upon a time.'),
    line('s1', 'tilda', 'stale', ['voice']),
    line('s2', 'mira', 'stale', ['cue', 'pronunciation']),
    line('o1', 'mira', 'ok'),
    line('w1', 'mira', 'weak'),
    line('u1', 'tilda', 'untracked'),
    line('x1', 'ghost', 'uncast'),
  ],
  orphans: [{ key: 'old', speaker: 'mira', file: 'old.mp3' }],
}

describe('planGeneration', () => {
  it('records the missing and stale lines of the whole part, counted by why', () => {
    const plan = planGeneration(state, { model: 's2.1-pro-free' })
    expect(plan.keys).toEqual(['m1', 's1', 's2'])
    expect(plan.missing).toBe(1)
    expect(plan.stale).toEqual({ voice: 1, cue: 1, pronunciation: 1 })
    expect(plan.uncast).toEqual(['ghost'])
    expect(plan.orphans).toEqual(['old'])
    expect(plan.bytes).toBe(
      new TextEncoder().encode('Once upon a time.Hello there.Hello there.').length,
    )
    expect(plan.cost).toBe(0)
  })

  it('narrows to one character, and its orphans', () => {
    const plan = planGeneration(state, { model: 's2.1-pro-free', speaker: 'tilda' })
    expect(plan.keys).toEqual(['s1'])
    expect(plan.orphans).toEqual([])
    expect(plan.uncast).toEqual([])
  })

  it('prices paid models by the bytes of text', () => {
    const plan = planGeneration(state, { model: 's2-pro' })
    expect(plan.cost).toBeCloseTo((plan.bytes / 1_000_000) * 15, 9)
  })
})

describe('planGeneration, cost', () => {
  it('prices at the moment planned, a promotion included', () => {
    const before = planGeneration(state, { model: 'drama-3', at: new Date('2026-11-01T00:00:00Z') })
    const after = planGeneration(state, { model: 'drama-3', at: new Date('2026-12-01T00:00:00Z') })
    expect(before.cost).toBeCloseTo((before.bytes / 1_000_000) * 10, 9)
    expect(after.cost).toBeCloseTo((after.bytes / 1_000_000) * 50, 9)
  })

  it('does not call an unknown model free', () => {
    expect(planGeneration(state, { model: 'brand-new' }).cost).toBeNull()
  })

  it('counts the text as it is sent, when told how', () => {
    const plan = planGeneration(state, {
      model: 's2-pro',
      sent: (line) => [`[cue] ${line.text}`, '[cue] more'],
    })
    const expected =
      3 * new TextEncoder().encode('[cue] more').length +
      ['Once upon a time.', 'Hello there.', 'Hello there.'].reduce(
        (s, t) => s + new TextEncoder().encode(`[cue] ${t}`).length,
        0,
      )
    expect(plan.bytes).toBe(expected)
  })
})

describe('planGeneration, takes', () => {
  it('says whether takes are checked, and how many a line may need', () => {
    expect(
      planGeneration(state, { model: 's2.1-pro-free', takes: 3, checked: true }),
    ).toMatchObject({ takes: 3, checked: true })
    expect(planGeneration(state, { model: 's2.1-pro-free' })).toMatchObject({
      takes: 1,
      checked: false,
    })
  })
})

describe('planGeneration, weak and unmeasured lines', () => {
  const measured = {
    lines: [
      { ...line('a', 'mira', 'ok'), file: 'a.mp3', heard: 0.97 },
      { ...line('b', 'mira', 'ok'), file: 'b.mp3', heard: null },
      { ...line('c', 'tilda', 'weak'), file: 'c.mp3', heard: 0.8 },
      line('d', 'tilda', 'missing'),
    ],
    orphans: [],
  }

  it('lists weak lines apart, and records them only when asked', () => {
    expect(planGeneration(measured, { model: 's2.1-pro-free' })).toMatchObject({
      keys: ['d'],
      weak: ['c'],
    })
    expect(planGeneration(measured, { model: 's2.1-pro-free', includeWeak: true }).keys).toEqual([
      'c',
      'd',
    ])
  })

  it('lists clips never measured, for checking without new audio', () => {
    expect(planGeneration(measured, { model: 's2.1-pro-free', checked: true }).unmeasured).toEqual([
      'b',
    ])
    expect(
      planGeneration(measured, { model: 's2.1-pro-free', checked: true, speaker: 'tilda' })
        .unmeasured,
    ).toEqual([])
    expect(planGeneration(measured, { model: 's2.1-pro-free' }).unmeasured).toEqual([])
  })
})

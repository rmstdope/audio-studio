import { describe, expect, it } from 'bun:test'
import type { LineState } from './planner'
import { planGeneration, costCeiling } from './generation'

/** A fixed moment to price plans at: no promotion runs then for the models tested. */
const AT = new Date('2026-10-24T12:00:00Z')

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
    english: null,
    cue: '',
    cueFrom: 'style',
    sourceCue: null,
    final: false,
    status,
    reasons,
    heard: null,
    accepted: false,
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
    const plan = planGeneration(state, { at: AT, model: 's2.1-pro-free' })
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

  it('counts the lines not translated in scope, which are never recorded', () => {
    const lines = [
      ...state.lines,
      line('t1', 'tilda', 'untranslated'),
      line('t2', 'mira', 'untranslated'),
    ]
    const plan = planGeneration({ ...state, lines }, { at: AT, model: 's2.1-pro-free' })
    expect(plan.untranslated).toBe(2)
    expect(plan.keys).toEqual(['m1', 's1', 's2'])
    expect(
      planGeneration({ ...state, lines }, { at: AT, model: 's2.1-pro-free', speaker: 'tilda' })
        .untranslated,
    ).toBe(1)
  })

  it('narrows to one character, and its orphans', () => {
    const plan = planGeneration(state, { at: AT, model: 's2.1-pro-free', speaker: 'tilda' })
    expect(plan.keys).toEqual(['s1'])
    expect(plan.orphans).toEqual([])
    expect(plan.uncast).toEqual([])
  })

  it('prices paid models by the bytes of text', () => {
    const plan = planGeneration(state, { at: AT, model: 's2-pro' })
    expect(plan.cost).toBeCloseTo((plan.bytes / 1_000_000) * 15, 9)
  })
})

describe('planGeneration, cost', () => {
  it('prices at the moment planned, a promotion included', () => {
    const before = planGeneration(state, {
      model: 'drama-3',
      at: new Date('2026-11-01T00:00:00Z'),
    })
    const after = planGeneration(state, {
      model: 'drama-3',
      at: new Date('2026-12-01T00:00:00Z'),
    })
    expect(before.cost).toBeCloseTo((before.bytes / 1_000_000) * 10, 9)
    expect(after.cost).toBeCloseTo((after.bytes / 1_000_000) * 50, 9)
  })

  it('does not call an unknown model free', () => {
    expect(planGeneration(state, { at: AT, model: 'brand-new' }).cost).toBeNull()
  })

  it('counts the text as it is sent, when told how', () => {
    const plan = planGeneration(state, {
      at: AT,
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
      planGeneration(state, { at: AT, model: 's2.1-pro-free', takes: 3, checked: true }),
    ).toMatchObject({ takes: 3, checked: true })
    expect(planGeneration(state, { at: AT, model: 's2.1-pro-free' })).toMatchObject({
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
    expect(planGeneration(measured, { at: AT, model: 's2.1-pro-free' })).toMatchObject({
      keys: ['d'],
      weak: ['c'],
    })
    expect(
      planGeneration(measured, { at: AT, model: 's2.1-pro-free', includeWeak: true }).keys,
    ).toEqual(['c', 'd'])
  })

  it('lists clips never measured, for checking without new audio', () => {
    expect(
      planGeneration(measured, { at: AT, model: 's2.1-pro-free', checked: true }).unmeasured,
    ).toEqual(['b'])
    expect(
      planGeneration(measured, { at: AT, model: 's2.1-pro-free', checked: true, speaker: 'tilda' })
        .unmeasured,
    ).toEqual([])
    expect(planGeneration(measured, { at: AT, model: 's2.1-pro-free' }).unmeasured).toEqual([])
  })

  it('lists weak lines Whisper can check again, final or not, in scope', () => {
    const final = {
      ...measured,
      lines: [
        ...measured.lines,
        { ...line('e', 'mira', 'weak'), file: 'e.mp3', heard: 0.5, final: true },
      ],
    }
    const plan = (options = {}) =>
      planGeneration(final, { at: AT, model: 's2.1-pro-free', checked: true, ...options }).recheck
    expect(plan()).toEqual(['c', 'e'])
    expect(plan({ speaker: 'mira' })).toEqual(['e'])
    expect(plan({ checked: false })).toEqual([])
  })
})

describe('costCeiling', () => {
  it('is the most the lines can cost: their bytes at the price, every take needed', () => {
    const plan = planGeneration(state, { at: AT, model: 's2-pro', takes: 3 })
    const keys = plan.keys.slice(0, 1)
    const one = planGeneration(
      { lines: state.lines.filter((l) => keys.includes(l.key)), orphans: [] },
      { at: AT, model: 's2-pro' },
    )
    expect(costCeiling(state, keys, { at: AT, model: 's2-pro', takes: 3 })).toBeCloseTo(
      (one.bytes / 1_000_000) * 15 * 3,
      12,
    )
    expect(costCeiling(state, keys, { at: AT, model: 's2.1-pro-free', takes: 3 })).toBe(0)
    expect(costCeiling(state, keys, { at: AT, model: 'brand-new', takes: 3 })).toBeNull()
  })

  it('is what the plan says at most, for the plan’s own lines', () => {
    const plan = planGeneration(state, { at: AT, model: 's2-pro', takes: 3 })
    expect(plan.ceiling).toBeCloseTo((plan.cost ?? 0) * 3, 12)
    expect(costCeiling(state, plan.keys, { at: AT, model: 's2-pro', takes: 3 })).toBeCloseTo(
      plan.ceiling!,
      12,
    )
  })
})

describe('planGeneration, the final recording', () => {
  it('records every cast line whose clip is not final yet, with the final model', () => {
    const lines: LineState[] = [
      { ...line('a', 'mira', 'ok'), file: 'a.mp3', final: true },
      { ...line('b', 'mira', 'ok'), file: 'b.mp3' },
      { ...line('c', 'mira', 'weak'), file: 'c.mp3' },
      line('d', 'mira', 'missing'),
      { ...line('e', 'mira', 'untracked'), file: 'e.mp3' },
      line('f', 'tilda', 'uncast'),
    ]
    const plan = planGeneration({ lines, orphans: [] }, { at: AT, model: 's2-pro', final: true })
    expect(plan.keys).toEqual(['b', 'c', 'd', 'e'])
    expect(plan.model).toBe('s2-pro')
    expect(plan.final).toBe(true)
    expect(planGeneration({ lines, orphans: [] }, { at: AT, model: 's2-pro' }).keys).toEqual(['d'])
  })
})

describe('planGeneration, final clips kept final', () => {
  const lines: LineState[] = [
    { ...line('a', 'mira', 'weak'), file: 'a.mp3', final: true },
    { ...line('b', 'mira', 'weak'), file: 'b.mp3' },
    { ...line('c', 'mira', 'ok'), file: 'c.mp3' },
    { ...line('d', 'mira', 'untracked'), file: 'd.mp3' },
    line('e', 'mira', 'missing'),
  ]
  const state = { lines, orphans: [] }

  it('never retakes a final clip in a draft plan', () => {
    expect(planGeneration(state, { at: AT, model: 'x', includeWeak: true }).keys).toEqual([
      'b',
      'e',
    ])
  })

  it('retakes a weak final clip in a final plan only when asked', () => {
    expect(planGeneration(state, { at: AT, model: 's2-pro', final: true }).keys).toEqual([
      'b',
      'c',
      'd',
      'e',
    ])
    expect(
      planGeneration(state, { at: AT, model: 's2-pro', final: true, includeWeak: true }).keys,
    ).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('names in a final plan the drafted and untracked clips it records again', () => {
    expect(planGeneration(state, { at: AT, model: 's2-pro', final: true })).toMatchObject({
      drafted: 2,
      untracked: 1,
      missing: 1,
    })
  })
})

describe('planGeneration, the weak lines offered', () => {
  const lines: LineState[] = [
    { ...line('a', 'mira', 'weak'), file: 'a.mp3', final: true },
    { ...line('b', 'mira', 'weak'), file: 'b.mp3' },
  ]
  it('offers to retake only the weak lines the plan would not record anyway', () => {
    expect(planGeneration({ lines, orphans: [] }, { at: AT, model: 'x' }).weak).toEqual(['b'])
    expect(
      planGeneration({ lines, orphans: [] }, { at: AT, model: 's2-pro', final: true }).weak,
    ).toEqual(['a'])
  })
})

describe('planGeneration, drafted lines', () => {
  it('counts drafted lines only in a final plan', () => {
    const lines: LineState[] = [{ ...line('b', 'mira', 'weak'), file: 'b.mp3' }]
    expect(
      planGeneration({ lines, orphans: [] }, { at: AT, model: 'x', includeWeak: true }).drafted,
    ).toBe(0)
  })
})

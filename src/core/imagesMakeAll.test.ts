import { describe, expect, it } from 'bun:test'
import type { ImageModelState } from './imageModels'
import { figuresOf } from './takeTimes'
import { planImagesMakeAll, TAKES_EACH, type MakeAllImage } from './imagesMakeAll'

const image = (id: string, status: MakeAllImage['status'] = 'none yet'): MakeAllImage => ({
  id,
  title: id.toUpperCase(),
  status,
})
const whole: ImageModelState = { download: 'whole', failed: false }
const states = { klein: whole, 'z-image-turbo': whole }
const base = {
  rows: [image('a'), image('b'), image('c', 'chosen')],
  conflicts: [] as { id: string; title: string }[],
  making: {},
  main: 'klein' as const,
  states,
  ready: true,
  figures: figuresOf({}),
}

describe('planImagesMakeAll', () => {
  it('makes four takes for every image with no chosen take, and leaves out the chosen', () => {
    const plan = planImagesMakeAll(base)
    expect(plan).toMatchObject({ kind: 'ready', model: 'klein', why: null, takes: 2 * TAKES_EACH })
    if (plan.kind !== 'ready') return
    expect(plan.images.map((i) => i.id)).toEqual(['a', 'b'])
    expect(plan.chosen.map((i) => i.id)).toEqual(['c'])
    expect(plan.seconds).toBe(8 * 20)
    expect(plan.guess).toBe(true)
    const timed = planImagesMakeAll({ ...base, figures: figuresOf({ klein: [30] }) })
    expect(timed).toMatchObject({ seconds: 8 * 30, guess: false })
  })

  it('counts an out-of-date chosen image as chosen', () => {
    const plan = planImagesMakeAll({ ...base, rows: [image('a'), image('d', 'out of date')] })
    if (plan.kind !== 'ready') throw new Error('not ready')
    expect(plan.images.map((i) => i.id)).toEqual(['a'])
    expect(plan.chosen.map((i) => i.id)).toEqual(['d'])
  })

  it('leaves out images already making takes, and names the images the lists disagree about', () => {
    const plan = planImagesMakeAll({
      ...base,
      making: {
        a: { takes: 2, left: 10, failed: 0, stopped: 0 },
        b: { takes: 0, left: 0, failed: 1, stopped: 0 },
      },
      conflicts: [{ id: 'x', title: 'X' }],
    })
    if (plan.kind !== 'ready') throw new Error('not ready')
    expect(plan.images.map((i) => i.id)).toEqual(['b'])
    expect(plan.busy.map((i) => i.id)).toEqual(['a'])
    expect(plan.disagree.map((i) => i.id)).toEqual(['x'])
  })

  it('says every image has a chosen take when none can be started', () => {
    expect(planImagesMakeAll({ ...base, rows: [image('c', 'chosen')] })).toEqual({
      kind: 'all-chosen',
    })
    expect(
      planImagesMakeAll({
        ...base,
        rows: [image('a')],
        making: { a: { takes: 1, left: 1, failed: 0, stopped: 0 } },
      }),
    ).toEqual({ kind: 'all-chosen' })
  })

  it('uses the other model, and says why, when the main one is not usable', () => {
    const why = (main: ImageModelState) => {
      const plan = planImagesMakeAll({ ...base, states: { ...states, klein: main } })
      return plan.kind === 'ready' ? [plan.model, plan.why, plan.seconds] : plan
    }
    expect(why({ download: 'absent', failed: false })).toEqual(['z-image-turbo', 'absent', 480])
    expect(why({ download: 'partial', failed: false })).toEqual(['z-image-turbo', 'partial', 480])
    expect(why({ download: 'whole', failed: true })).toEqual(['z-image-turbo', 'failed', 480])
  })

  it('keeps the main model when it is the only whole one, even after a failure', () => {
    const plan = planImagesMakeAll({
      ...base,
      states: {
        klein: { download: 'whole', failed: true },
        'z-image-turbo': { download: 'absent', failed: false },
      },
    })
    expect(plan).toMatchObject({ kind: 'ready', model: 'klein', why: null })
  })

  it('cannot make images when the generator is not ready or neither model is whole', () => {
    expect(planImagesMakeAll({ ...base, ready: false })).toEqual({ kind: 'not-ready' })
    const none = { download: 'absent', failed: false } as const
    expect(planImagesMakeAll({ ...base, states: { klein: none, 'z-image-turbo': none } })).toEqual({
      kind: 'not-ready',
    })
  })
})

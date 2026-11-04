import { describe, expect, it } from 'bun:test'
import type { EffectRow } from './effects'
import {
  EFFECTS_MAKE_ALL_FAILED,
  batchSummary,
  makeAllButton,
  makeAllHeading,
  makeAllLine,
  makeAllModelLine,
  makeAllTime,
  leftOutLines,
  planMakeAll,
  runningLine,
} from './effectsMakeAll'

function row(id: string, over: Partial<EffectRow> = {}): EffectRow {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: 'd',
    gameDescription: 'd',
    seconds: 1,
    loops: false,
    changedHere: false,
    gameChanged: false,
    status: 'none-yet',
    current: { kind: 'nothing' },
    changed: [],
    chosen: false,
    ...over,
  }
}

const chosen = (id: string, status: EffectRow['status'] = 'chosen') =>
  row(id, {
    chosen: true,
    status,
    current: { kind: 'take', take: 1, exists: status !== 'missing' },
  })

describe('planMakeAll', () => {
  it('starts effects with no chosen take, with or without takes', () => {
    const plan = planMakeAll(
      [row('a'), row('b', { status: 'not-chosen' }), chosen('c'), chosen('d', 'changed')],
      {},
    )
    expect(plan.startable.map((r) => r.id)).toEqual(['a', 'b'])
    expect(plan.chosen.map((r) => r.id)).toEqual(['c', 'd'])
    expect(plan.busy).toEqual([])
    expect(plan.lockUnread).toBe(false)
  })
  it('leaves out a chosen effect whose clip is missing', () => {
    expect(planMakeAll([chosen('c', 'missing')], {}).chosen.map((r) => r.id)).toEqual(['c'])
  })
  it('leaves out an effect already making takes, chosen or not', () => {
    const plan = planMakeAll([row('a'), row('b'), chosen('c')], { a: { takes: 2, left: 4 } })
    expect(plan.startable.map((r) => r.id)).toEqual(['b'])
    expect(plan.busy.map((r) => r.id)).toEqual(['a'])
    expect(plan.chosen.map((r) => r.id)).toEqual(['c'])
  })
  it('knows nothing when the lock cannot be read', () => {
    const plan = planMakeAll([row('a', { status: 'unknown', current: { kind: 'unknown' } })], {})
    expect(plan.lockUnread).toBe(true)
    expect(plan.startable).toEqual([])
  })
})

describe('the words', () => {
  it('says how many effects have no chosen take', () => {
    expect(makeAllLine(4)).toBe('4 effects have no chosen take')
    expect(makeAllLine(1)).toBe('1 effect has no chosen take')
    expect(makeAllButton()).toBe('Make 4 takes each')
    expect(makeAllHeading(16, 4)).toBe('Make 16 takes for 4 effects?')
    expect(makeAllHeading(4, 1)).toBe('Make 4 takes for 1 effect?')
  })
  it('words the time in all', () => {
    expect(makeAllTime(16, 'small-sfx')).toBe('About 1 min in all')
    expect(makeAllTime(8, 'small-sfx')).toBe('About 16 s in all')
    expect(makeAllTime(1, 'small-sfx')).toBe('About 2 s in all')
    expect(makeAllTime(16, 'open-1')).toBe('About 27 min in all')
  })
  it('names the model, and the other one with its reason', () => {
    const tail = ' — they are made one after another, and you can leave the page.'
    expect(makeAllModelLine('small-sfx', 'small-sfx', null, 30)).toBe(
      `Four takes each, on Stable Audio 3 Small SFX, the sound-effects model on Setup. About 1 min in all${tail}`,
    )
    expect(makeAllModelLine('small-sfx', 'open-1', 'absent', 16)).toBe(
      `Four takes each, on Stable Audio Open 1.0. Stable Audio 3 Small SFX, the project's sound-effects model, isn't on this computer, so these takes use Stable Audio Open 1.0. Setup says how to download it. About 27 min in all${tail}`,
    )
    expect(makeAllModelLine('small-sfx', 'open-1', 'partial', 16)).toContain(
      'is only partly downloaded, so these takes use Stable Audio Open 1.0. Setup says how to finish it.',
    )
  })
  it('says who is left out and why', () => {
    expect(leftOutLines(['Door creak', 'Footsteps'], ['Thunder'])).toEqual([
      'Door creak and Footsteps have a chosen take and get none.',
      'Thunder is already making takes and gets none.',
    ])
    expect(leftOutLines(['A'], [])).toEqual(['A has a chosen take and gets none.'])
    expect(leftOutLines(['A', 'B', 'C'], ['D', 'E'])).toEqual([
      'A, B and C have a chosen take and get none.',
      'D and E are already making takes and get none.',
    ])
    expect(leftOutLines([], [])).toEqual([])
  })
  it('words the running line', () => {
    expect(runningLine({ a: { takes: 8, left: 20 }, b: { takes: 8, left: 10 } })).toBe(
      'Making 16 takes for 2 effects · about 30 s left',
    )
    expect(runningLine({ a: { takes: 1, left: 0.2 } })).toBe(
      'Making 1 take for 1 effect · about 1 s left',
    )
  })
  it('words the four summaries', () => {
    expect(batchSummary({ total: 16, made: 16, stopped: 0, failed: [] })).toEqual({
      before: 'Made 16 of 16 takes.',
      failed: [],
      after: '',
    })
    expect(
      batchSummary({
        total: 16,
        made: 14,
        stopped: 0,
        failed: [
          { id: 'thunder', n: 3 },
          { id: 'thunder', n: 4 },
        ],
      }),
    ).toEqual({
      before: 'Made 14 of 16 takes. 2 could not be made — ',
      failed: ['thunder'],
      after: ' says why.',
    })
    expect(batchSummary({ total: 16, made: 6, stopped: 10, failed: [] }).before).toBe(
      'Made 6 of 16 takes. 10 were stopped.',
    )
    const both = batchSummary({
      total: 16,
      made: 4,
      stopped: 10,
      failed: [
        { id: 'thunder', n: 1 },
        { id: 'rain', n: 1 },
      ],
    })
    expect(both.before).toBe('Made 4 of 16 takes. 2 could not be made — ')
    expect(both.failed).toEqual(['thunder', 'rain'])
    expect(both.after).toBe(' say why. 10 were stopped.')
    expect(EFFECTS_MAKE_ALL_FAILED).toBe(
      'The takes could not be started. Nothing was made; try again.',
    )
  })
})

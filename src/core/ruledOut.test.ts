import { describe, expect, it } from 'bun:test'
import { allowAgain, emptyRuledOut, listRuledOut, ruleOut, RuledOutSchema } from './ruledOut'

describe('ruled-out voices', () => {
  it('rules voices out, listing the latest first', () => {
    let ruled = emptyRuledOut('mira')
    ruled = ruleOut(ruled, [{ id: 'a', title: 'Warm a' }], '2026-10-24T10:00:00.000Z')
    ruled = ruleOut(ruled, [{ id: 'b', title: 'Warm b' }], '2026-10-24T11:00:00.000Z')
    expect(listRuledOut(ruled)).toEqual([
      { id: 'b', title: 'Warm b', at: '2026-10-24T11:00:00.000Z' },
      { id: 'a', title: 'Warm a', at: '2026-10-24T10:00:00.000Z' },
    ])
    expect(RuledOutSchema.safeParse(ruled).success).toBe(true)
  })

  it('keeps when a voice was first ruled out', () => {
    const once = ruleOut(emptyRuledOut('mira'), [{ id: 'a', title: 'A' }], 'then')
    expect(ruleOut(once, [{ id: 'a', title: 'A' }], 'now').voices.a?.at).toBe('then')
  })

  it('allows voices again, leaving the others', () => {
    const ruled = ruleOut(
      emptyRuledOut('mira'),
      [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
      'then',
    )
    expect(listRuledOut(allowAgain(ruled, ['a', 'unknown'])).map((v) => v.id)).toEqual(['b'])
  })

  it('lists voices ruled out at the same moment in a stable order', () => {
    const ruled = ruleOut(
      emptyRuledOut('mira'),
      [
        { id: 'b', title: 'B' },
        { id: 'a', title: 'A' },
      ],
      'then',
    )
    expect(listRuledOut(ruled).map((v) => v.id)).toEqual(['a', 'b'])
  })
})

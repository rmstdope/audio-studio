import { describe, expect, it } from 'bun:test'
import { withAuditionTakes, withTake } from './takes'

const candidates = {
  ok: true as const,
  audition: { phrase: 'New.', own: true, spoken: '[warm] New.' },
  takes: { a: 'key-a' } as Record<string, string>,
}

describe('withTake', () => {
  it('adds a take of the phrase shown', () => {
    expect(withTake(candidates, 'b', { key: 'key-b', spoken: '[warm] New.' }).takes).toEqual({
      a: 'key-a',
      b: 'key-b',
    })
  })

  it('ignores a take of a phrase no longer shown', () => {
    expect(withTake(candidates, 'b', { key: 'old', spoken: '[warm] Old.' })).toBe(candidates)
  })
})

describe('withAuditionTakes', () => {
  it('keeps takes recorded meanwhile when the phrase is the same', () => {
    const fresh = withAuditionTakes(candidates, candidates.audition, { c: 'key-c' })
    expect(fresh.takes).toEqual({ a: 'key-a', c: 'key-c' })
  })

  it('takes the fresh take where both have one for the voice', () => {
    const fresh = withAuditionTakes(candidates, candidates.audition, { a: 'key-a2' })
    expect(fresh.takes).toEqual({ a: 'key-a2' })
  })

  it('takes only the fresh takes for a new phrase', () => {
    const audition = { phrase: 'Other.', own: true, spoken: '[warm] Other.' }
    const fresh = withAuditionTakes(candidates, audition, { c: 'key-c' })
    expect(fresh).toMatchObject({ audition, takes: { c: 'key-c' } })
  })
})

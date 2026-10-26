import { describe, expect, it } from 'bun:test'
import { failureLine, progressOf, takesAreBeingMade, timeLeftText } from './musicTakesText'

describe('timeLeftText', () => {
  it('says a take waits for its turn', () => {
    expect(timeLeftText({ n: 5, state: 'waiting', elapsed: 0 }, 180)).toBe('waiting')
  })

  it('rounds the time left up to whole minutes', () => {
    expect(timeLeftText({ n: 4, state: 'making', elapsed: 1 }, 180)).toBe(
      'making · about 3 min left',
    )
    expect(timeLeftText({ n: 4, state: 'making', elapsed: 70 }, 180)).toBe(
      'making · about 2 min left',
    )
    expect(timeLeftText({ n: 4, state: 'making', elapsed: 175 }, 180)).toBe(
      'making · about 1 min left',
    )
  })

  it('admits a take that takes longer than usual', () => {
    expect(timeLeftText({ n: 4, state: 'making', elapsed: 400 }, 180)).toBe(
      'making · taking longer than usual',
    )
  })
})

describe('progressOf', () => {
  it('is empty while waiting, and never reaches the end before the take is done', () => {
    expect(progressOf({ n: 1, state: 'waiting', elapsed: 0 }, 180)).toBe(0)
    expect(progressOf({ n: 1, state: 'making', elapsed: 90 }, 180)).toBe(0.5)
    expect(progressOf({ n: 1, state: 'making', elapsed: 900 }, 180)).toBe(0.95)
  })
})

describe('failureLine', () => {
  it('says the other takes are kept when there are any', () => {
    expect(failureLine('The music generator stopped: out of memory.', true)).toBe(
      'The music generator stopped: out of memory. Your other takes are kept.',
    )
    expect(failureLine('The music generator stopped: out of memory.', false)).toBe(
      'The music generator stopped: out of memory.',
    )
  })
})

describe('takesAreBeingMade', () => {
  it('is true while any take waits or is made', () => {
    expect(takesAreBeingMade([])).toBe(false)
    expect(takesAreBeingMade([{ n: 1, state: 'waiting', elapsed: 0 }])).toBe(true)
  })
})

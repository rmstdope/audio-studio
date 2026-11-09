import { describe, expect, it } from 'bun:test'
import { imageTimeLeftText } from './imageTakesText'

describe('the time left on an image take', () => {
  it('waits, counts down in seconds then minutes, and owns up to running over', () => {
    expect(imageTimeLeftText({ state: 'waiting', elapsed: 0, expected: 20 })).toBe('waiting')
    expect(imageTimeLeftText({ state: 'making', elapsed: 6, expected: 20 })).toBe(
      'making · about 15 s left',
    )
    expect(imageTimeLeftText({ state: 'making', elapsed: 60, expected: 480 })).toBe(
      'making · about 7 min left',
    )
    expect(imageTimeLeftText({ state: 'making', elapsed: 20, expected: 20 })).toBe(
      'making · taking longer than expected',
    )
  })
})

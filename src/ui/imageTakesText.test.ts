import { describe, expect, it } from 'bun:test'
import { imageMakingStatusText, imageTimeLeftText } from './imageTakesText'

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

describe("an image row's status while takes are made", () => {
  it('counts the takes and rounds the time left up like every image time', () => {
    expect(imageMakingStatusText({ takes: 4, left: 30 })).toBe('making 4 takes · about 30 s')
    expect(imageMakingStatusText({ takes: 2, left: 11 })).toBe('making 2 takes · about 15 s')
    expect(imageMakingStatusText({ takes: 1, left: 0 })).toBe('making 1 take · about 5 s')
    expect(imageMakingStatusText({ takes: 3, left: 400 })).toBe('making 3 takes · about 7 min')
  })
})

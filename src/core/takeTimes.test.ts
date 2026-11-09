import { describe, expect, it } from 'bun:test'
import {
  figureOf,
  perTakeText,
  recordTime,
  roundedSeconds,
  STARTING_SECONDS,
  timeText,
} from './takeTimes'

describe('figureOf', () => {
  it('is the starting figure, marked as a guess, before any take', () => {
    expect(figureOf({}, 'klein')).toEqual({ seconds: 20, guess: true })
    expect(STARTING_SECONDS['qwen-edit']).toBe(480)
    expect(STARTING_SECONDS['z-image-turbo']).toBe(60)
    expect(STARTING_SECONDS['klein-edit']).toBe(20)
  })
  it('is the take itself after one take, no longer a guess', () => {
    expect(figureOf({ klein: [23] }, 'klein')).toEqual({ seconds: 23, guess: false })
  })
  it('is the middle of the takes there are when fewer than five', () => {
    expect(figureOf({ klein: [10, 50, 20] }, 'klein').seconds).toBe(20)
    expect(figureOf({ klein: [10, 20] }, 'klein').seconds).toBe(15)
  })
  it('is not moved by one slow take among five', () => {
    expect(figureOf({ klein: [20, 21, 19, 120, 22] }, 'klein').seconds).toBe(21)
  })
  it('counts only the last five', () => {
    expect(figureOf({ klein: [500, 500, 500, 20, 20, 20, 20, 20] }, 'klein').seconds).toBe(20)
  })
  it('times each key apart', () => {
    const times = { klein: [20], 'klein-edit': [90] }
    expect(figureOf(times, 'klein').seconds).toBe(20)
    expect(figureOf(times, 'klein-edit').seconds).toBe(90)
    expect(figureOf(times, 'z-image-turbo').guess).toBe(true)
  })
})

describe('recordTime', () => {
  it('keeps the last five', () => {
    let t = {}
    for (const s of [1, 2, 3, 4, 5, 6, 7]) t = recordTime(t, 'klein', s)
    expect(t).toEqual({ klein: [3, 4, 5, 6, 7] })
  })
  it('keeps the keys in one order, whichever was timed first', () => {
    const t = recordTime(recordTime({}, 'klein-edit', 9), 'klein', 8)
    expect(Object.keys(t)).toEqual(['klein', 'klein-edit'])
  })
  it('ignores a time that is not a positive number', () => {
    expect(recordTime({}, 'klein', Number.NaN)).toEqual({})
    expect(recordTime({}, 'klein', 0)).toEqual({})
    expect(recordTime({}, 'klein', -3)).toEqual({})
  })
})

describe('roundedSeconds', () => {
  it('rounds under a minute to five seconds, at least five', () => {
    expect(roundedSeconds(23, 'nearest')).toBe(25)
    expect(roundedSeconds(1, 'nearest')).toBe(5)
    expect(roundedSeconds(11, 'up')).toBe(15)
    expect(roundedSeconds(15, 'up')).toBe(15)
    expect(roundedSeconds(0.2, 'up')).toBe(5)
  })
  it('rounds a minute and over to whole minutes', () => {
    expect(roundedSeconds(58, 'nearest')).toBe(60)
    expect(roundedSeconds(460, 'nearest')).toBe(480)
    expect(roundedSeconds(61, 'up')).toBe(120)
    expect(roundedSeconds(8400, 'nearest')).toBe(8400)
  })
})

describe('words', () => {
  it('writes seconds under a minute and whole minutes after, never hours', () => {
    expect(timeText(23, 'nearest')).toBe('25 s')
    expect(timeText(58, 'nearest')).toBe('1 min')
    expect(timeText(460, 'nearest')).toBe('8 min')
    expect(timeText(14 * 60, 'nearest')).toBe('14 min')
    expect(timeText(3 * 3600, 'up')).toBe('180 min')
  })
  it('marks a guess', () => {
    expect(perTakeText({ seconds: 20, guess: true })).toBe('a guess: about 20 s a take')
    expect(perTakeText({ seconds: 23, guess: false })).toBe('about 25 s a take')
    expect(perTakeText({ seconds: 460, guess: false })).toBe('about 8 min a take')
  })
})

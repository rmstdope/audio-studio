import { describe, expect, test } from 'bun:test'
import { off } from './off'
import { CHANGING, NOTHING_TO_SAVE, SAVING, cloneReasons, saveReasons } from './voiceOffText'

const first = (...r: Parameters<typeof saveReasons>) => off(...saveReasons(...r))['data-why']

describe('saveReasons', () => {
  test('a save with something to save and nothing in the way has no reason', () => {
    expect(first({ changed: true, moved: false, problem: null, pending: false })).toBeUndefined()
  })

  test('names what the person fixes on the page before what they wait for', () => {
    const all = { changed: false, moved: true, problem: 'A group is empty.', pending: true }
    expect(first(all)).toBe('A group is empty.')
    expect(first({ ...all, problem: null })).toContain('Discard')
    expect(first({ ...all, problem: null, moved: false })).toBe(NOTHING_TO_SAVE)
    expect(first({ ...all, problem: null, moved: false, changed: true })).toBe(SAVING)
  })
})

test('the waiting sentences say what to wait for', () => {
  expect(SAVING).toBe('Wait for the save to finish.')
  expect(CHANGING).toBe('Wait for the current change to finish.')
})

describe('cloneReasons', () => {
  const ready: Parameters<typeof cloneReasons>[0] = {
    note: null,
    sendable: 2,
    name: 'Lyria',
    permitted: true,
    cloning: false,
  }
  const why = (over: Partial<typeof ready>) =>
    off(...cloneReasons({ ...ready, ...over }))['data-why']

  test('nothing in the way has no reason', () => {
    expect(why({})).toBeUndefined()
  })

  test('the files come first, then the name, the permission, then the wait', () => {
    expect(why({ note: 'Too many.', sendable: 0, name: '', permitted: false, cloning: true })).toBe(
      'Too many.',
    )
    expect(why({ sendable: 0, name: '', permitted: false })).toContain('recording')
    expect(why({ name: ' ', permitted: false })).toContain('name')
    expect(why({ permitted: false, cloning: true })).toContain('permission')
    expect(why({ cloning: true })).toContain('Cloning is under way')
  })
})

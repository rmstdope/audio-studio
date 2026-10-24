import { describe, expect, it } from 'bun:test'
import { HeardSchema, emptyHeard, withHeard } from './heard'

describe('withHeard', () => {
  const line = {
    at: '2026-10-24T16:11:29.762Z',
    text: 'This was Aren.',
    words: ['This', 'was', 'Arn'],
    missed: [2],
  }

  it('keeps what was heard of a line, replacing what was kept before', () => {
    const once = withHeard(emptyHeard('act1'), 'k1', { ...line, missed: [0, 2] })
    const twice = withHeard(once, 'k1', line)
    expect(twice).toEqual({ version: 1, part: 'act1', lines: { k1: line } })
    expect(HeardSchema.parse(twice)).toEqual(twice)
  })

  it('forgets a line heard in full, and is unchanged when there was nothing to forget', () => {
    const kept = withHeard(emptyHeard('act1'), 'k1', line)
    expect(withHeard(kept, 'k1', null).lines).toEqual({})
    const empty = emptyHeard('act1')
    expect(withHeard(empty, 'k1', null)).toBe(empty)
  })

  it('keeps line keys that are object properties as plain keys', () => {
    const kept = withHeard(emptyHeard('act1'), 'constructor', line)
    expect(Object.keys(kept.lines)).toEqual(['constructor'])
    expect(withHeard(emptyHeard('act1'), 'toString', null).lines).toEqual({})
  })
})

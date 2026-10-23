import { describe, expect, it } from 'bun:test'
import { addKeyword } from './keywords'

describe('addKeyword', () => {
  it('adds a new keyword, trimmed', () => {
    expect(addKeyword(['warm'], '  old  ')).toEqual(['warm', 'old'])
  })

  it('ignores one already there in another case', () => {
    expect(addKeyword(['Warm'], 'warm')).toBeNull()
  })

  it('ignores one without words', () => {
    expect(addKeyword(['warm'], ' - ')).toBeNull()
    expect(addKeyword(['warm'], '')).toBeNull()
  })
})

import { describe, expect, it } from 'bun:test'
import { groupsFrom, groupsProblem, rowsFrom, sameGroups } from './soundAlikeEdit'

describe('groupsFrom', () => {
  it('reads each row as words split at commas, trimmed, empty words and rows dropped', () => {
    expect(groupsFrom(['Lyria, Liria', ' inn ,in, ', '', ' , '])).toEqual([
      ['Lyria', 'Liria'],
      ['inn', 'in'],
    ])
  })

  it('gives back the rows it was written from', () => {
    expect(groupsFrom(rowsFrom([['Lyria', 'Liria']]))).toEqual([['Lyria', 'Liria']])
    expect(rowsFrom([['Lyria', 'Liria']])).toEqual(['Lyria, Liria'])
  })
})

describe('groupsProblem', () => {
  it('accepts groups of two words or more, each a word with letters', () => {
    expect(groupsProblem([['Lyria', 'Liria', 'Leeria']])).toBeNull()
    expect(groupsProblem([])).toBeNull()
  })

  it('says which group has one word, or a word that could never match', () => {
    expect(groupsProblem([['inn', 'in'], ['Lyria']])).toBe(
      'Group 2 has one word: add another that sounds the same, or remove it.',
    )
    expect(groupsProblem([['Lyria', 'Leer ia']])).toBe(
      'Group 1: “Leer ia” is not one word (no spaces, some letters).',
    )
    expect(groupsProblem([['Lyria', '!!']])).toBe(
      'Group 1: “!!” is not one word (no spaces, some letters).',
    )
  })
})

describe('sameGroups', () => {
  it('compares groups word for word, in order', () => {
    expect(sameGroups([['a', 'b']], [['a', 'b']])).toBe(true)
    expect(sameGroups([['a', 'b']], [['b', 'a']])).toBe(false)
    expect(sameGroups([], [['a', 'b']])).toBe(false)
  })
})

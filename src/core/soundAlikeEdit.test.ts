import { describe, expect, it } from 'bun:test'
import { groupsFrom, groupsProblem, rowsFrom, sameGroups } from './soundAlikeEdit'

describe('groupsFrom', () => {
  it('reads each row as words split at commas, trimmed, empty words and rows dropped', () => {
    expect(groupsFrom(['all  right , alright'])).toEqual([['all right', 'alright']])
    expect(groupsFrom(['Lyria, Liria', ' inn ,in, ', '', ' , '])).toEqual([
      ['Lyria', 'Liria'],
      ['inn', 'in'],
    ])
  })

  it('gives back the rows it was written from', () => {
    expect(groupsFrom(rowsFrom([['Lyria', 'Liria']]))).toEqual([['Lyria', 'Liria']])
    expect(rowsFrom([['Lyria', 'Liria']])).toEqual(['Lyria, Liria'])
  })

  it('takes no word with a comma in it, as a row could not give it back', () => {
    expect(groupsProblem([['1,000', 'thousand']])).toBe(
      '“1,000” is not a word or phrase (no commas, some letters in each word).',
    )
  })
})

describe('groupsProblem', () => {
  it('accepts groups of two words or more, each a word with letters', () => {
    expect(groupsProblem([['Lyria', 'Liria', 'Leeria']])).toBeNull()
    expect(groupsProblem([])).toBeNull()
  })

  it('says which group has one word, or a word that could never match', () => {
    expect(groupsProblem([['inn', 'in'], ['Lyria']])).toBe(
      '“Lyria” is alone in its group: add another word that sounds the same, or remove it.',
    )
    expect(groupsProblem([['all right', 'alright']])).toBeNull()
    expect(groupsProblem([['Lyria', '!!']])).toBe(
      '“!!” is not a word or phrase (no commas, some letters in each word).',
    )
    expect(groupsProblem([['Lyria', 'Leer !!']])).toBe(
      '“Leer !!” is not a word or phrase (no commas, some letters in each word).',
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

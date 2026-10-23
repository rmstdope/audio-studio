import { describe, expect, it } from 'bun:test'
import { cleanPronunciations, pronounceProblem, sameTable } from './pronounce'

describe('cleanPronunciations', () => {
  it('trims both sides and drops rows left empty', () => {
    expect(
      cleanPronunciations([
        ['  Eldoria ', ' El-door-ia '],
        ['', ''],
        ['  ', ' '],
      ]),
    ).toEqual([['Eldoria', 'El-door-ia']])
  })
})

describe('pronounceProblem', () => {
  it('accepts a table in any order', () => {
    expect(
      pronounceProblem([
        ['Act I:', 'Act One:'],
        ['Eldoria', 'El-door-ia'],
      ]),
    ).toBeNull()
    expect(pronounceProblem([])).toBeNull()
  })

  it('needs both the written words and how they are said', () => {
    expect(pronounceProblem([['Eldoria', '']])).toContain('“Eldoria” needs how it is said')
    expect(pronounceProblem([['', 'El-door-ia']])).toContain('the words it replaces')
  })

  it('takes each written form once', () => {
    expect(
      pronounceProblem([
        ['Eldoria', 'a'],
        ['Eldoria', 'b'],
      ]),
    ).toContain('“Eldoria” twice')
  })

  it('refuses a number among others, which JavaScript would move to the front', () => {
    expect(pronounceProblem([['10', 'ten']])).toBeNull()
    expect(
      pronounceProblem([
        ['Eldoria', 'x'],
        ['10', 'ten'],
      ]),
    ).toContain('“10”')
  })
})

describe('sameTable', () => {
  it('compares entries and their order', () => {
    expect(
      sameTable(
        [
          ['a', '1'],
          ['b', '2'],
        ],
        [
          ['a', '1'],
          ['b', '2'],
        ],
      ),
    ).toBe(true)
    expect(
      sameTable(
        [
          ['a', '1'],
          ['b', '2'],
        ],
        [
          ['b', '2'],
          ['a', '1'],
        ],
      ),
    ).toBe(false)
    expect(sameTable([['a', '1']], [['a', '2']])).toBe(false)
  })
})

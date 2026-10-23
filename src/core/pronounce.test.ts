import { describe, expect, it } from 'bun:test'
import { cleanPronunciations, pronounceProblem, sameTable, spaceNote } from './pronounce'

describe('cleanPronunciations', () => {
  it('drops rows left empty, and keeps spaces, which anchor an entry', () => {
    expect(
      cleanPronunciations([
        ['Al ', 'Al '],
        ['', ''],
        [' I ', ' eye '],
      ]),
    ).toEqual([
      ['Al ', 'Al '],
      [' I ', ' eye '],
    ])
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

  it('needs the written words; an empty said form leaves them out, as in narrate.py', () => {
    expect(pronounceProblem([['', 'El-door-ia']])).toContain('the words it replaces')
    expect(pronounceProblem([['um, ', '']])).toBeNull()
  })

  it('refuses a written form of spaces only, which would change every line', () => {
    expect(pronounceProblem([[' ', '']])).toContain('only spaces')
  })

  it('takes each written form once, spaces counting', () => {
    expect(
      pronounceProblem([
        ['Eldoria', 'a'],
        ['Eldoria', 'b'],
      ]),
    ).toContain('“Eldoria” twice')
    expect(
      pronounceProblem([
        ['Eldoria', 'a'],
        ['Eldoria ', 'b'],
      ]),
    ).toBeNull()
  })

  it('refuses a number among others, which JavaScript would move to the front', () => {
    expect(pronounceProblem([['10', 'ten']])).toBeNull()
    expect(
      pronounceProblem([
        ['Eldoria', 'x'],
        ['10', 'ten'],
      ]),
    ).toContain('“10”')
    expect(
      pronounceProblem([
        ['Eldoria', 'x'],
        ['10 ', 'ten '],
      ]),
    ).toBeNull()
  })

  it('refuses __proto__, which JavaScript cannot keep as a key', () => {
    expect(pronounceProblem([['__proto__', 'x']])).toContain('__proto__')
  })
})

describe('spaceNote', () => {
  it('points out spaces at either end, which are easy to miss', () => {
    expect(spaceNote('Al ')).toBe('ends with a space')
    expect(spaceNote(' I ')).toBe('starts and ends with a space')
    expect(spaceNote(' I')).toBe('starts with a space')
    expect(spaceNote('Eldoria')).toBeNull()
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

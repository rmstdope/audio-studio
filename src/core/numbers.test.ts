import { describe, expect, it } from 'bun:test'
import { numberWords } from './numbers'

describe('numberWords', () => {
  it('writes 0 to 99 as the language writes them, with the digits', () => {
    const en = numberWords('en')
    expect(en).toHaveLength(100)
    expect(en[0]).toEqual(['0', 'zero'])
    expect(en.find((g) => g[0] === '21')).toEqual(['21', 'twentyone'])
    expect(numberWords('de').find((g) => g[0] === '21')).toEqual(['21', 'einundzwanzig'])
    expect(numberWords('sv').find((g) => g[0] === '99')).toEqual(['99', 'nittionio'])
    expect(numberWords('ru').find((g) => g[0] === '22')).toEqual([
      '22',
      'двадцатьдва',
      'двадцатьдве',
    ])
  })

  it('reads the language part of a code, and has none for other languages', () => {
    expect(numberWords('en-GB')).toEqual(numberWords('en'))
    expect(numberWords('fr')).toEqual([])
  })
})

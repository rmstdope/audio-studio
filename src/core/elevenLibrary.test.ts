import { describe, expect, it } from 'bun:test'
import { addedVoiceFor, ElevenVoicesSchema, libraryFilters, libraryWords } from './elevenLibrary'

describe('libraryFilters', () => {
  it('asks for the gender and age the keywords name', () => {
    expect(libraryFilters(['gruff', 'old man'])).toEqual({ gender: 'male', age: 'old' })
    expect(libraryFilters(['Young woman', 'bright'])).toEqual({ gender: 'female', age: 'young' })
    expect(libraryFilters(['middle-aged', 'female'])).toEqual({
      gender: 'female',
      age: 'middle_aged',
    })
    expect(libraryFilters(['elderly'])).toEqual({ age: 'old' })
  })

  it('asks for neither when the keywords name none, or name two', () => {
    expect(libraryFilters(['warm', 'storyteller'])).toEqual({})
    expect(libraryFilters(['man', 'woman', 'young', 'old'])).toEqual({})
  })

  it('reads middle aged with or without its hyphen, and aged alone as nothing', () => {
    expect(libraryFilters(['middle aged woman'])).toEqual({ gender: 'female', age: 'middle_aged' })
    expect(libraryFilters(['aged'])).toEqual({})
  })

  it('names the words of the keywords that asked for them', () => {
    expect(libraryWords(['gruff', 'old man'])).toEqual(['old', 'man'])
    expect(libraryWords(['Middle aged', 'man', 'woman'])).toEqual(['middle', 'aged'])
    // "boy" is a gender too, and no gender was asked for: a young woman is no boy.
    expect(libraryWords(['boy', 'female', 'young'])).toEqual(['young'])
  })

  it('reads whole words only', () => {
    expect(libraryFilters(['human', 'golden', 'oldish'])).toEqual({})
  })
})

describe('the voices the studio added', () => {
  it('reads a file with none, and finds the voice a library voice became', () => {
    expect(ElevenVoicesSchema.parse({ version: 1 })).toEqual({ version: 1, added: [] })
    const file = ElevenVoicesSchema.parse({
      version: 1,
      added: [
        {
          library: 'eleven:lib1',
          voice: 'eleven:own1',
          name: 'Gravel',
          character: 'wizard',
          at: '2026-10-28T10:00:00.000Z',
        },
      ],
    })
    expect(addedVoiceFor(file, 'eleven:lib1')).toBe('eleven:own1')
    expect(addedVoiceFor(file, 'eleven:lib2')).toBeNull()
  })
})

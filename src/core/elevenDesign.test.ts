import { describe, expect, it } from 'bun:test'
import { elevenDesignCredits, elevenDesignPoints, elevenDesignText } from './elevenDesign'

describe('elevenDesignText', () => {
  const phrase = 'Elior, dear, come in from the cold.'

  it('says the phrase, then her lines in order, until ElevenLabs’ least of 100 characters', () => {
    const text = elevenDesignText(phrase, [
      'Sit by the fire and I will tell you of the sea.',
      'The lamps are lit, so the boats will come home.',
      'Never this one.',
    ])
    expect(text).toBe(
      'Elior, dear, come in from the cold. Sit by the fire and I will tell you of the sea. The lamps are lit, so the boats will come home.',
    )
  })

  it('leaves out lines said twice, or that are the phrase', () => {
    const text = elevenDesignText(phrase, [phrase, 'Hush.', 'Hush.', 'x'.repeat(70)])
    expect(text).toBe(`${phrase} Hush. ${'x'.repeat(70)}`)
  })

  it('is the phrase alone when it is long enough, and cut at a word within 1,000 characters', () => {
    const long = 'word '.repeat(300).trim()
    expect([...elevenDesignText(long, [])!].length).toBeLessThanOrEqual(1000)
    expect(elevenDesignText(long, [])).toEndWith('word')
    const enough = 'a'.repeat(120)
    expect(elevenDesignText(enough, ['more'])).toBe(enough)
  })

  it('is null when she has too few words: ElevenLabs then writes its own text', () => {
    expect(elevenDesignText('Hush.', ['Go.'])).toBeNull()
  })
})

describe('what an ElevenLabs design costs', () => {
  it('costs a credit a character of the text, or up to 1,000 for ElevenLabs’ own', () => {
    expect(elevenDesignCredits('a'.repeat(130))).toBe(130)
    expect(elevenDesignCredits(null)).toBe(1000)
  })

  it('says what it makes and uses', () => {
    expect(elevenDesignPoints('Mara', true, 'a'.repeat(130))).toEqual([
      'ElevenLabs makes 3 voices from your description, each saying the audition phrase and Mara’s lines (130 characters).',
      'It uses 130 credits of your ElevenLabs plan, charged only if it works.',
    ])
    expect(elevenDesignPoints('Mara', false, null)).toEqual([
      'ElevenLabs makes 3 voices from your description, each saying a text it writes: Mara’s phrase and lines are under the 100 characters it needs.',
      'It uses as many credits as that text has characters, up to 1,000, charged only if it works.',
      'No audition is going on for Mara: this starts one, and the voices join its board.',
    ])
  })
})

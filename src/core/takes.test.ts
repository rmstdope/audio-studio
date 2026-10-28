import { describe, expect, it } from 'bun:test'
import { projectJson } from '../../test/helpers'
import { ProjectSchema } from './project'
import { auditionText, takeKey } from './takes'
import { ttsFor } from './resources'

const narration = ProjectSchema.parse(projectJson()).narration

describe('auditionText', () => {
  it('uses the project’s phrase, in the character’s style, said as the cast asks', () => {
    const text = auditionText({ style: '[warm]' }, { Elior: 'El-ee-or' }, narration)
    expect(text.phrase).toBe(narration.audition.phrase)
    expect(text.from).toBe('standard')
    expect(text.spoken).toBe(`[warm] ${narration.audition.phrase}`)
    const named = auditionText(
      { style: '', audition: { phrase: 'Elior, come here.' } },
      { Elior: 'El-ee-or' },
      narration,
    )
    expect(named).toEqual({
      phrase: 'Elior, come here.',
      from: 'own',
      standard: true,
      spoken: 'El-ee-or, come here.',
    })
  })
})

describe('auditionText in another language', () => {
  const several: typeof narration = {
    ...narration,
    languages: ['en', 'sv'],
    audition: { ...narration.audition, phrases: { sv: 'Kom in, barn.' } },
  }
  const sv = (character: Parameters<typeof auditionText>[0], longest: string | null, n = several) =>
    auditionText(character, {}, n, 'sv', longest)

  it('prefers the character’s own phrase in the language', () => {
    expect(sv({ audition: { phrase: 'Min fras.' } }, 'Längsta raden.')).toMatchObject({
      phrase: 'Min fras.',
      from: 'own',
    })
  })

  it('then the project’s standard phrase in that language, not the English one', () => {
    expect(sv({ style: '[warm]' }, 'Längsta raden.')).toMatchObject({
      phrase: 'Kom in, barn.',
      from: 'standard',
      spoken: '[warm] Kom in, barn.',
    })
  })

  it('then her longest line in that language', () => {
    expect(sv({}, 'Längsta raden.', { ...several, audition: narration.audition })).toMatchObject({
      phrase: 'Längsta raden.',
      from: 'line',
    })
  })

  it('has none when the project has no phrase for it and she has no lines', () => {
    expect(sv({}, null, { ...several, audition: narration.audition })).toEqual({
      phrase: null,
      from: 'none',
      standard: false,
      spoken: '',
    })
  })

  it('keeps the built-in phrase for the source language, whatever else is known', () => {
    expect(auditionText({}, {}, several, 'en', 'The longest line.').from).toBe('standard')
  })
})

describe('takeKey', () => {
  it('differs for a character with its own speed', () => {
    const own = { ...base, tts: ttsFor(narration.tts, { speed: 0.9 }) }
    expect(takeKey(own)).not.toBe(takeKey(base))
  })

  const base = { model: 's2.1-pro-free', voice: 'v1', spoken: '[warm] Hello.', tts: narration.tts }

  it('keeps a Fish take’s key as it was, so takes already cached are found', () => {
    expect(takeKey(base)).toBe('07a90e3cc871d96f')
  })

  it('changes with an ElevenLabs take’s voice settings', () => {
    const eleven = { ...base, model: 'eleven_v3', voice: 'eleven:abc' }
    const settings = { stability: 0.5 as const, similarityBoost: 0.75, style: 0 }
    expect(takeKey({ ...eleven, eleven: settings })).not.toBe(takeKey(eleven))
    expect(takeKey({ ...eleven, eleven: { ...settings, style: 0.3 } })).not.toBe(
      takeKey({ ...eleven, eleven: settings }),
    )
  })

  it('is sixteen hex characters, the same for the same inputs', () => {
    expect(takeKey(base)).toMatch(/^[0-9a-f]{16}$/)
    expect(takeKey(base)).toBe(takeKey({ ...base }))
  })

  it('changes with the voice, the words, the model or the settings', () => {
    const keys = new Set([
      takeKey(base),
      takeKey({ ...base, voice: 'v2' }),
      takeKey({ ...base, spoken: '[warm] Hi.' }),
      takeKey({ ...base, model: 's2-pro' }),
      takeKey({ ...base, tts: { ...base.tts, speed: 0.9 } }),
    ])
    expect(keys.size).toBe(5)
  })
})

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
    expect(text.own).toBe(false)
    expect(text.spoken).toBe(`[warm] ${narration.audition.phrase}`)
    const named = auditionText(
      { style: '', audition: { phrase: 'Elior, come here.' } },
      { Elior: 'El-ee-or' },
      narration,
    )
    expect(named).toEqual({
      phrase: 'Elior, come here.',
      own: true,
      spoken: 'El-ee-or, come here.',
    })
  })
})

describe('takeKey', () => {
  it('differs for a character with its own speed', () => {
    const own = { ...base, tts: ttsFor(narration.tts, { speed: 0.9 }) }
    expect(takeKey(own)).not.toBe(takeKey(base))
  })

  const base = { model: 's2.1-pro-free', voice: 'v1', spoken: '[warm] Hello.', tts: narration.tts }

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

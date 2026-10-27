import { describe, expect, it } from 'bun:test'
import { ProjectSchema } from './project'
import { projectJson } from '../../test/helpers'
import {
  DEFAULT_ELEVEN_MODEL,
  readsCues,
  requestsAtOnce,
  ELEVEN_TTS,
  elevenCredits,
  isElevenModel,
  takesLanguage,
  modelForStage,
  speedProblem,
} from './elevenSpeech'

const narration = ProjectSchema.parse(projectJson({})).narration

describe('ElevenLabs’ speech models', () => {
  it('are v3 by default, Multilingual v2 and Flash, each with its credits a character', () => {
    expect(DEFAULT_ELEVEN_MODEL).toBe('eleven_v3')
    expect(elevenCredits('eleven_v3', 'Hello there')).toBe(11)
    expect(elevenCredits('eleven_multilingual_v2', 'Hello there')).toBe(11)
    expect(elevenCredits('eleven_flash_v2_5', 'Hello there')).toBe(5.5)
    expect(isElevenModel('eleven_v3')).toBe(true)
    expect(isElevenModel('s2.1-pro')).toBe(false)
  })

  it('count characters as a person reads them, not bytes', () => {
    expect(elevenCredits('eleven_v3', 'Får jag?')).toBe(8)
  })

  it('speak with ElevenLabs’ own default settings', () => {
    expect(ELEVEN_TTS).toEqual({ stability: 0.5, similarityBoost: 0.75, style: 0 })
  })
})

describe('the model a stage records with', () => {
  it('is the project’s Fish model for a Fish voice, and ElevenLabs’ for an ElevenLabs voice', () => {
    expect(modelForStage(narration, 'e48a228e21a4', 'draft')).toBe(narration.models.draft)
    expect(modelForStage(narration, 'e48a228e21a4', 'final')).toBe(narration.models.final)
    for (const stage of ['audition', 'draft', 'final'] as const)
      expect(modelForStage(narration, 'eleven:abc', stage)).toBe('eleven_v3')
  })
})

describe('the speed ElevenLabs takes', () => {
  it('is 0.7 to 1.2; another says so', () => {
    expect(speedProblem(0.7)).toBeNull()
    expect(speedProblem(1.2)).toBeNull()
    expect(speedProblem(1.5)).toBe(
      'ElevenLabs speaks at 0.7 to 1.2 times its pace, and this voice is set to 1.5; change its speed to record it.',
    )
  })
})

describe('the language sent', () => {
  it('goes with v3 and Flash, but not with Multilingual v2, which does not take one', () => {
    expect(takesLanguage('eleven_v3')).toBe(true)
    expect(takesLanguage('eleven_flash_v2_5')).toBe(true)
    expect(takesLanguage('eleven_multilingual_v2')).toBe(false)
  })
})

describe('requestsAtOnce', () => {
  it('is the project’s for a Fish voice, and at most two for an ElevenLabs one', () => {
    expect(requestsAtOnce(4, 'abc')).toBe(4)
    expect(requestsAtOnce(4, 'eleven:abc')).toBe(2)
    expect(requestsAtOnce(1, 'eleven:abc')).toBe(1)
  })
})

describe('readsCues', () => {
  it('is true for Fish’s models and Eleven v3, false for the ElevenLabs models that speak them', () => {
    expect(readsCues('s2-pro')).toBe(true)
    expect(readsCues('eleven_v3')).toBe(true)
    expect(readsCues('eleven_multilingual_v2')).toBe(false)
    expect(readsCues('eleven_flash_v2_5')).toBe(false)
  })
})

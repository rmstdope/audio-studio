import { createHash } from 'node:crypto'
import type { Project } from './project'
import type { Character } from './resources'
import { spokenText } from './spoken'

/** What a character says in an audition: the phrase, whether it is its own, and the text sent. */
export interface AuditionText {
  phrase: string
  /** True when the character has its own phrase, false for the project's standard one. */
  own: boolean
  /** The phrase as sent to Fish: the character's style cue, then the words as the cast says them. */
  spoken: string
}

/** The audition phrase for a character: its own if it has one, else the project's standard one. */
export function auditionText(
  character: Pick<Character, 'style' | 'audition'>,
  pronounce: Record<string, string>,
  narration: Project['narration'],
): AuditionText {
  const own = character.audition?.phrase?.trim()
  const phrase = own || narration.audition.phrase
  return { phrase, own: Boolean(own), spoken: spokenText(phrase, character.style ?? '', pronounce) }
}

/** Everything that changes an audition take's audio. */
export interface TakeInputs {
  model: string
  voice: string
  spoken: string
  tts: Project['narration']['tts']
}

/**
 * What the Fish client sends that is not in `TakeInputs` (format, latency, volume). Change it
 * when the client changes them, so cached takes made the old way are not served as new.
 */
const TAKE_FORMAT = 'mp3/normal/volume0'

/** A take's cache key: a short hash of everything that changes its audio. */
export function takeKey({ model, voice, spoken, tts }: TakeInputs): string {
  const value = JSON.stringify([
    TAKE_FORMAT,
    model,
    voice,
    spoken,
    tts.temperature,
    tts.topP,
    tts.speed,
  ])
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

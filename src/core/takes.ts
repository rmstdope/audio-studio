import { createHash } from 'node:crypto'
import type { ElevenTts, Project } from './project'
import type { Character } from './resources'
import { spokenText } from './spoken'

/** Where an audition phrase comes from. */
export type PhraseSource = 'own' | 'standard' | 'line' | 'none'

/** What a character says in an audition: the phrase, where it came from, and the text sent. */
export interface AuditionText {
  /** The phrase; null when there is none (`from` is `none`). */
  phrase: string | null
  /**
   * The character's own phrase, the project's standard one, her longest line in the language, or
   * nothing.
   */
  from: PhraseSource
  /** Whether the project has a standard phrase in the language, which clearing her own would go back to. */
  standard: boolean
  /** The phrase as sent to Fish: the character's style cue, then the words as the cast says them. */
  spoken: string
}

/**
 * The audition phrase for a character in a language (`character` as that language sees it, see
 * `projectCast`): its own if it has one, else the project's standard one for the language, else
 * `longest`, her longest line in it. The source language always has the standard one.
 */
export function auditionText(
  character: Pick<Character, 'style' | 'audition'>,
  pronounce: Record<string, string>,
  narration: Project['narration'],
  language: string = narration.languages[0]!,
  longest: string | null = null,
): AuditionText {
  const own = character.audition?.phrase?.trim()
  const standard =
    language === narration.languages[0]
      ? narration.audition.phrase
      : narration.audition.phrases?.[language]
  const [phrase, from]: [string | null, PhraseSource] = own
    ? [own, 'own']
    : standard
      ? [standard, 'standard']
      : longest
        ? [longest, 'line']
        : [null, 'none']
  return {
    phrase,
    from,
    standard: Boolean(standard),
    spoken: phrase === null ? '' : spokenText(phrase, character.style ?? '', pronounce),
  }
}

/** Everything that changes an audition take's audio. */
export interface TakeInputs {
  model: string
  voice: string
  spoken: string
  tts: Project['narration']['tts']
  /** An ElevenLabs take's voice settings (its speed is `tts.speed`); none for a Fish take. */
  eleven?: ElevenTts
}

/**
 * What the Fish client sends that is not in `TakeInputs` (format, latency, volume). Change it
 * when the client changes them, so cached takes made the old way are not served as new.
 */
const TAKE_FORMAT = 'mp3/normal/volume0'

/** A take's cache key: a short hash of everything that changes its audio. */
export function takeKey({ model, voice, spoken, tts, eleven }: TakeInputs): string {
  const value = JSON.stringify([
    TAKE_FORMAT,
    model,
    voice,
    spoken,
    tts.temperature,
    tts.topP,
    tts.speed,
    // Only an ElevenLabs take has them, so a Fish take's key stays as it always was.
    ...(eleven ? [eleven.stability, eleven.similarityBoost, eleven.style] : []),
  ])
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

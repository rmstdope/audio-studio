import type { Project } from './project'
import { providerOf } from './voices'

/**
 * ElevenLabs' speech models the studio records with, and the credits each takes a character of
 * text sent (ElevenLabs' API pricing, October 2026: v3 and Multilingual v2 a credit a character,
 * Flash half of one). A table of its own, beside Fish's prices, so neither provider's models can
 * stand for the other's.
 */
const ELEVEN_SPEECH: Record<string, { credits: number; language: boolean; cues: boolean }> = {
  // Eleven v3 reads `[bracket]` tags as directions, as Fish's models do.
  eleven_v3: { credits: 1, language: true, cues: true },
  // ElevenLabs takes no language_code with Multilingual v2; it and Flash would speak a cue aloud.
  eleven_multilingual_v2: { credits: 1, language: false, cues: false },
  eleven_flash_v2_5: { credits: 0.5, language: true, cues: false },
}

/** The ElevenLabs model every stage records with until the project names its own (§8.6). */
export const DEFAULT_ELEVEN_MODEL = 'eleven_v3'

/** ElevenLabs' voice settings a line is spoken with: its own defaults. */
export const ELEVEN_TTS = { stability: 0.5, similarityBoost: 0.75, style: 0 } as const

/** The pace ElevenLabs speaks at, as a share of the voice's own: it takes nothing outside this. */
const ELEVEN_SPEED = { min: 0.7, max: 1.2 }

/** Whether a model is one of ElevenLabs' speech models. */
export function isElevenModel(model: string): boolean {
  return Object.hasOwn(ELEVEN_SPEECH, model)
}

/**
 * The credits speaking `text` with an ElevenLabs model takes (a character is what a person reads
 * as one), or undefined for a model that is not one of ElevenLabs'.
 */
export function elevenCredits(model: string, text: string): number | undefined {
  const entry = Object.hasOwn(ELEVEN_SPEECH, model) ? ELEVEN_SPEECH[model] : undefined
  return entry && [...text].length * entry.credits
}

/**
 * Whether a model reads `[bracket]` cues as directions (every Fish model, and Eleven v3) rather
 * than speaking them, so a line's cues are sent to it.
 */
export function readsCues(model: string): boolean {
  return !isElevenModel(model) || ELEVEN_SPEECH[model]!.cues
}

/** Whether an ElevenLabs model is told the language it speaks. */
export function takesLanguage(model: string): boolean {
  return Object.hasOwn(ELEVEN_SPEECH, model) && ELEVEN_SPEECH[model]!.language
}

/**
 * The model a stage records a voice with: the project's for a Fish voice, ElevenLabs' for an
 * ElevenLabs one (the same for every stage, so its lines have no final step of their own yet).
 */
export function modelForStage(
  narration: Project['narration'],
  voice: string,
  stage: 'audition' | 'draft' | 'final',
): string {
  return providerOf(voice) === 'elevenlabs' ? DEFAULT_ELEVEN_MODEL : narration.models[stage]
}

/** Why ElevenLabs cannot speak at `speed`, or null when it can. */
export function speedProblem(speed: number): string | null {
  if (speed >= ELEVEN_SPEED.min && speed <= ELEVEN_SPEED.max) return null
  return `ElevenLabs speaks at ${ELEVEN_SPEED.min} to ${ELEVEN_SPEED.max} times its pace, and this voice is set to ${speed}; change its speed to record it.`
}

/**
 * How many requests ElevenLabs takes at once from the studio: two, the Free plan's limit, which
 * every plan allows. Higher plans allow more; the studio does not ask until that is measured.
 */
const ELEVEN_AT_ONCE = 2

/** How many requests for a voice's lines are sent at once: the project's, ElevenLabs' at most two. */
export function requestsAtOnce(parallel: number, voice: string): number {
  return providerOf(voice) === 'elevenlabs' ? Math.min(parallel, ELEVEN_AT_ONCE) : parallel
}

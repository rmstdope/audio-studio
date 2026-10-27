import type { Project } from './project'
import { providerOf } from './voices'

/**
 * ElevenLabs' speech models the studio records with, and the credits each takes a character of
 * text sent (ElevenLabs' API pricing, October 2026: v3 and Multilingual v2 a credit a character,
 * Flash half of one). A table of its own, beside Fish's prices, so neither provider's models can
 * stand for the other's.
 */
const ELEVEN_SPEECH: Record<string, { credits: number; language: boolean }> = {
  eleven_v3: { credits: 1, language: true },
  // ElevenLabs takes no language_code with Multilingual v2.
  eleven_multilingual_v2: { credits: 1, language: false },
  eleven_flash_v2_5: { credits: 0.5, language: true },
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

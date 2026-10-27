import { ELEVEN_TTS, modelForStage, readsCues } from './elevenSpeech'
import { providerOf } from './voices'
import { createHash } from 'node:crypto'
import type { Project } from './project'
import { openingFor, parseCued, type InsideCue } from './cued'
import { cueFor, sceneKey, ttsFor, type Character, type LockEntry } from './resources'
import { REPLACEMENT_MODEL, RETIRED_MODEL, sameModel } from './retirement'
import { saidText } from './spoken'

/** Everything that changes a clip's audio. Two clips with the same inputs sound the same. */
export interface ClipInputs {
  model: string
  voice: string
  /** The delivery cue: the line's own cue, else its scene's, else the character's style. */
  cue: string
  /** The cues placed inside the line's words; none for most lines. */
  inside: InsideCue[]
  /** The line as shown. */
  text: string
  /** The line as said: pronunciations and list reading applied. */
  said: string
  /** Generation and output settings, as one string. */
  settings: string
}

/** Short hashes of a clip's inputs, kept in the lock so a changed input can be named. */
export type InputHashes = LockEntry['parts']

/** Why a clip no longer matches its inputs. */
export type StaleReason = 'voice' | 'model' | 'cue' | 'text' | 'pronunciation' | 'settings'

/** A line as the cue rules see it. */
export interface CueLine {
  key: string
  speaker?: string
  scene?: string | null
  /** The line's words, to read its own cue against. */
  text?: string
}

/**
 * The scene's cue a line follows: its scene's, when its speaker is one the project names and it
 * has no cue of its own; undefined otherwise.
 */
export function sceneCueFor(
  line: CueLine,
  cues: Record<string, string>,
  narration: Pick<Project['narration'], 'sceneCueSpeakers'>,
): string | undefined {
  if (!line.scene || !line.speaker || openingFor(cues, line.key, line.text ?? '') !== undefined)
    return undefined
  if (!narration.sceneCueSpeakers.includes(line.speaker)) return undefined
  return cueFor(cues, sceneKey(line.scene))
}

const NONE = { opening: '', inside: [] as InsideCue[] }

/**
 * The cue a line is delivered with and the cues placed inside it, whatever model speaks it: its
 * own opening cue, else its scene's, else its character's style. What the page shows; a model
 * that would speak cues is sent none (`clipInputs`).
 */
export function cueInputs(
  line: CueLine & { text: string },
  character: Character,
  cues: Record<string, string>,
  narration: Project['narration'],
): { cue: string; inside: InsideCue[] } {
  const entry = cueFor(cues, line.key)
  const { opening, inside } = entry === undefined ? NONE : parseCued(entry, line.text)
  return { cue: opening || (sceneCueFor(line, cues, narration) ?? character.style ?? ''), inside }
}

/**
 * The inputs of a line's clip, or null when its speaker has no voice yet. The model is the draft
 * stage's of the voice's provider: everyday generation uses it. An ElevenLabs voice is spoken
 * with ElevenLabs' voice settings in place of Fish's temperature and top-p.
 */
export function clipInputs(
  line: CueLine & { text: string },
  character: Character | undefined,
  cues: Record<string, string>,
  pronounce: Record<string, string>,
  narration: Project['narration'],
  model?: string,
): ClipInputs | null {
  if (!character?.voice) return null
  const { output, quality } = narration
  const tts = ttsFor(narration.tts, character)
  const voice = character.voice
  const delivery =
    providerOf(voice) === 'elevenlabs'
      ? [ELEVEN_TTS.stability, ELEVEN_TTS.similarityBoost, ELEVEN_TTS.style, tts.speed]
      : [tts.temperature, tts.topP, tts.speed]
  const made = model ?? modelForStage(narration, voice, 'draft')
  // A model that would speak a cue is sent none: editing one then changes nothing it makes.
  const { cue, inside } = readsCues(made)
    ? cueInputs(line, character, cues, narration)
    : { cue: '', inside: [] }
  return {
    model: made,
    voice,
    cue,
    inside,
    text: line.text,
    said: saidText(line.text, pronounce),
    settings: JSON.stringify([
      ...delivery,
      quality.chunkLimit,
      output.codec,
      output.bitrate,
      output.channels,
    ]),
  }
}

/** The clip's fingerprint, and the short hashes of the inputs that are not kept in the clear. */
export function fingerprint(inputs: ClipInputs): { fp: string; parts: InputHashes } {
  return {
    fp: hash(
      JSON.stringify([
        inputs.model,
        inputs.voice,
        inputs.cue,
        inputs.said,
        inputs.settings,
        // Only when there are some: a clip made before cues inside stays up to date.
        ...(inputs.inside.length ? [inputs.inside] : []),
      ]),
      16,
    ),
    parts: {
      cue: hash(inputs.inside.length ? JSON.stringify([inputs.cue, inputs.inside]) : inputs.cue, 8),
      text: hash(inputs.text, 8),
      said: hash(inputs.said, 8),
      settings: hash(inputs.settings, 8),
    },
  }
}

/** Whether the lock entry's fingerprint is the one these inputs give, `s1` clips counting as `s2.1-pro`. */
export function fingerprintMatches(entry: LockEntry, inputs: ClipInputs): boolean {
  if (entry.fp === fingerprint(inputs).fp) return true
  return (
    inputs.model === REPLACEMENT_MODEL &&
    entry.fp === fingerprint({ ...inputs, model: RETIRED_MODEL }).fp
  )
}

/**
 * Which inputs differ between the clip in the lock and the line now. A changed pronunciation shows
 * only when the words themselves are the same, since new words change how they are said too.
 */
export function staleReasons(entry: LockEntry, inputs: ClipInputs): StaleReason[] {
  const { parts } = fingerprint(inputs)
  const reasons: StaleReason[] = []
  if (entry.voice !== inputs.voice) reasons.push('voice')
  if (!sameModel(entry.model, inputs.model)) reasons.push('model')
  if (entry.parts.cue !== parts.cue) reasons.push('cue')
  if (entry.parts.text !== parts.text) reasons.push('text')
  else if (entry.parts.said !== parts.said) reasons.push('pronunciation')
  if (entry.parts.settings !== parts.settings) reasons.push('settings')
  return reasons
}

function hash(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

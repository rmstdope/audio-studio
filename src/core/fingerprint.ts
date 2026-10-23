import { createHash } from 'node:crypto'
import type { Project } from './project'
import type { Character, LockEntry } from './resources'
import { saidText } from './spoken'

/** Everything that changes a clip's audio. Two clips with the same inputs sound the same. */
export interface ClipInputs {
  model: string
  voice: string
  /** The delivery cue: the line's own cue, else the character's style. */
  cue: string
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

/**
 * The inputs of a line's clip, or null when its speaker has no voice yet. The model is the draft
 * stage's: everyday generation uses it.
 */
export function clipInputs(
  line: { key: string; text: string },
  character: Character | undefined,
  cues: Record<string, string>,
  pronounce: Record<string, string>,
  narration: Project['narration'],
): ClipInputs | null {
  if (!character?.voice) return null
  const { tts, output, quality } = narration
  return {
    model: narration.models.draft,
    voice: character.voice,
    cue: cues[line.key] ?? character.style ?? '',
    text: line.text,
    said: saidText(line.text, pronounce),
    settings: JSON.stringify([
      tts.temperature,
      tts.topP,
      tts.speed,
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
      JSON.stringify([inputs.model, inputs.voice, inputs.cue, inputs.said, inputs.settings]),
      16,
    ),
    parts: {
      cue: hash(inputs.cue, 8),
      text: hash(inputs.text, 8),
      said: hash(inputs.said, 8),
      settings: hash(inputs.settings, 8),
    },
  }
}

/**
 * Which inputs differ between the clip in the lock and the line now. A changed pronunciation shows
 * only when the words themselves are the same, since new words change how they are said too.
 */
export function staleReasons(entry: LockEntry, inputs: ClipInputs): StaleReason[] {
  const { parts } = fingerprint(inputs)
  const reasons: StaleReason[] = []
  if (entry.voice !== inputs.voice) reasons.push('voice')
  if (entry.model !== inputs.model) reasons.push('model')
  if (entry.parts.cue !== parts.cue) reasons.push('cue')
  if (entry.parts.text !== parts.text) reasons.push('text')
  else if (entry.parts.said !== parts.said) reasons.push('pronunciation')
  if (entry.parts.settings !== parts.settings) reasons.push('settings')
  return reasons
}

function hash(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

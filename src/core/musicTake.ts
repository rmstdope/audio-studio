import { z } from 'zod'
import { MUSIC_MODEL_IDS, musicModel, type MusicModelId } from './musicModels'
import { readWav, writeWav, type Wav } from './wav'

/** What a take made before models were chosen records, and what the take fingerprint begins with. */
export const MUSIC_MODEL = musicModel('balanced').recipe

/** How much longer than it plays a loop is generated, since every take closes as a song does. */
export const LOOP_EXTRA_SECONDS = 20

/** The seconds after a loop's cut that are crossfaded over its start. */
export const SEAM_SECONDS = 4

/** ACE-Step's shortest take, which every stinger is generated at. */
export const STINGER_GENERATED_SECONDS = 10

/** How long a stinger's ending fades out. */
export const STINGER_FADE_SECONDS = 0.3

/** What is kept after a stinger's last sound before it is cut, in seconds. */
const STINGER_TAIL_SECONDS = 0.15

/** Samples below this (of 32768) count as silence when a stinger's end is looked for. */
const SILENCE = 300

/** The length ACE-Step is asked for, for a track of this kind that should play `seconds`. */
export function generatedSeconds(kind: 'loop' | 'stinger', seconds: number): number {
  return kind === 'loop' ? seconds + LOOP_EXTRA_SECONDS : STINGER_GENERATED_SECONDS
}

/** The samples of a 16-bit WAV, channels interleaved. */
function samplesOf(wav: Wav): Int16Array {
  if (wav.format.bitsPerSample !== 16) throw new Error('only 16-bit audio can be shaped')
  const { data } = wav
  return new Int16Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.length - (data.length % 2)),
  )
}

function wavOf(format: Wav['format'], samples: Int16Array): Wav {
  return { format, data: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength) }
}

/** A WAV's length in seconds. */
export function wavSeconds(wav: Wav): number {
  const frame = (wav.format.bitsPerSample / 8) * wav.format.channels
  return wav.data.length / frame / wav.format.sampleRate
}

/**
 * A loop from a take generated `LOOP_EXTRA_SECONDS` longer: cut at `seconds`, with the
 * `SEAM_SECONDS` after the cut crossfaded (equal power) over its start, so the end runs into
 * the beginning without a seam. Where the two sum past full scale the blend is held at it.
 */
export function shapeLoop(wav: Wav, seconds: number): Wav {
  const { channels, sampleRate } = wav.format
  const samples = samplesOf(wav)
  const cut = Math.round(seconds * sampleRate)
  const blend = SEAM_SECONDS * sampleRate
  if (samples.length / channels < cut + blend) {
    throw new Error(`the take is too short to make a loop of ${seconds} seconds`)
  }
  const out = samples.slice(0, cut * channels)
  for (let frame = 0; frame < blend; frame++) {
    const angle = (frame / blend) * (Math.PI / 2)
    for (let channel = 0; channel < channels; channel++) {
      const at = frame * channels + channel
      const tail = samples[(cut + frame) * channels + channel]!
      // Equal power sums to up to 1.4 times either side: held at full scale, since a 16-bit
      // sample past it wraps round to the other sign, a loud crackle.
      const blended = Math.round(tail * Math.cos(angle) + samples[at]! * Math.sin(angle))
      out[at] = Math.max(-32768, Math.min(32767, blended))
    }
  }
  return wavOf(wav.format, out)
}

/**
 * A stinger from a take: cut a moment after its last sound, or at `seconds` if that comes first,
 * with a short fade-out.
 */
export function shapeStinger(wav: Wav, seconds: number): Wav {
  const { channels, sampleRate } = wav.format
  const samples = samplesOf(wav)
  const frames = samples.length / channels
  let last = -1
  for (let frame = frames - 1; frame >= 0 && last < 0; frame--) {
    for (let channel = 0; channel < channels; channel++) {
      if (Math.abs(samples[frame * channels + channel]!) > SILENCE) {
        last = frame
        break
      }
    }
  }
  const sounded = last < 0 ? 0 : last + 1 + Math.round(STINGER_TAIL_SECONDS * sampleRate)
  const length = Math.max(1, Math.min(frames, sounded, Math.round(seconds * sampleRate)))
  const out = samples.slice(0, length * channels)
  const fade = Math.min(length, Math.round(STINGER_FADE_SECONDS * sampleRate))
  for (let k = 0; k < fade; k++) {
    const gain = 1 - (k + 1) / fade
    for (let channel = 0; channel < channels; channel++) {
      const at = (length - fade + k) * channels + channel
      out[at] = Math.round(out[at]! * gain)
    }
  }
  return wavOf(wav.format, out)
}

/**
 * `count` bars for a waveform: the loudest sample of each stretch, 0 to 1, relative to the
 * loudest of the whole take.
 */
export function peaks(wav: Wav, count: number): number[] {
  const samples = samplesOf(wav)
  const bucket = Math.max(1, Math.ceil(samples.length / count))
  const loud: number[] = []
  for (let i = 0; i < count; i++) {
    let max = 0
    for (let at = i * bucket; at < Math.min(samples.length, (i + 1) * bucket); at++) {
      max = Math.max(max, Math.abs(samples[at]!))
    }
    loud.push(max)
  }
  const top = Math.max(...loud)
  return loud.map((value) => (top ? Math.round((value / top) * 1000) / 1000 : 0))
}

/**
 * A loop's seam to listen to: its last `SEAM_SECONDS` followed by its first, which is what the
 * game plays as the loop comes round.
 */
export function seamWav(wav: Wav): Wav {
  const { channels, sampleRate, bitsPerSample } = wav.format
  const frame = (bitsPerSample / 8) * channels
  const frames = wav.data.length / frame
  const edge = Math.min(frames, SEAM_SECONDS * sampleRate) * frame
  const data = new Uint8Array(edge * 2)
  data.set(wav.data.subarray(wav.data.length - edge), 0)
  data.set(wav.data.subarray(0, edge), edge)
  return { format: wav.format, data }
}

/** Shapes a take's WAV file by the kind of track it is for. */
export function shapeTake(
  bytes: Uint8Array,
  kind: 'loop' | 'stinger',
  seconds: number,
): Uint8Array {
  const wav = readWav(bytes)
  return writeWav(kind === 'loop' ? shapeLoop(wav, seconds) : shapeStinger(wav, seconds))
}

/** One take on a track's page. */
export interface TakeView {
  n: number
  /** The file name to ask for under the track's takes. */
  file: string
  seconds: number
  /** The seed the take was made from. */
  seed: number
  /** The waveform's bars, 0 to 1. */
  peaks: number[]
  /** Made from a brief, length, tempo or key the track no longer has. */
  earlier: boolean
  /** The take the game plays. */
  chosen: boolean
  /** The music model that made it, as a line: "Balanced · XL turbo · 4B". */
  model: string
}

/** A take being made or waiting its turn. */
export interface MakingView {
  n: number
  state: 'waiting' | 'making'
  /** Seconds since it began; 0 while it waits. */
  elapsed: number
  /** The music model it is made with, as a line. */
  model: string
  /** About how long that model takes, in seconds. */
  expected: number
}

/** A take that could not be made, and why. */
export interface FailedView {
  n: number
  message: string
  /** The music model it was asked with, as a line. */
  model: string
}

/** A track's takes as its page shows them. */
export interface MusicTakesView {
  ok: true
  kind: 'loop' | 'stinger'
  /** Whether takes can be made on this computer, and what is missing if not. */
  generator: { ok: true } | { ok: false; message: string }
  /** The music model the project makes takes with unless a track asks for another. */
  defaultModel: MusicModelId
  /** Every music model, and whether this computer has its files. */
  models: { id: MusicModelId; installed: boolean }[]
  takes: TakeView[]
  making: MakingView[]
  failed: FailedView[]
}

/** What a take was made from: the track's inputs at the time. */
export const TakeInputsSchema = z.object({
  brief: z.string(),
  kind: z.enum(['loop', 'stinger']),
  seconds: z.number(),
  bpm: z.number().nullable(),
  key: z.string().nullable(),
})

/** What a take was made from. */
export type TakeInputs = z.infer<typeof TakeInputsSchema>

/** A take on a track's board, saved in `.audio-studio/music/<track>.json`. */
export const BoardTakeSchema = z.object({
  n: z.number().int().positive(),
  /** The hash of its inputs, which with `n` names its WAV. */
  hash: z.string().regex(/^[0-9a-f]{16}$/),
  seed: z.number(),
  /** The music model that made it; absent on a take made before this was kept (the current one). */
  model: z.string().optional(),
  seconds: z.number(),
  peaks: z.array(z.number()),
  inputs: TakeInputsSchema,
})

/** A track's board: the takes kept, and the number the next take gets (numbers are never reused). */
export const MusicBoardSchema = z.object({
  next: z.number().int().positive(),
  takes: z.array(BoardTakeSchema),
})

/** A track's saved board. */
export type MusicBoard = z.infer<typeof MusicBoardSchema>

/** A take on the board. */
export type BoardTake = z.infer<typeof BoardTakeSchema>

/** What is being made for a track: how many takes wait or are made, and about how many seconds are left. */
export interface MakingSummary {
  takes: number
  left: number
}

/** The most takes one click asks for. */
export const MAX_TAKES_AT_ONCE = 4

/** The body of a request for takes: this many new ones (with a model, else the project's), or a failed one again. */
export const MakeTakesBody = z.union([
  z
    .object({
      count: z.number().int().min(1).max(MAX_TAKES_AT_ONCE),
      model: z.enum(MUSIC_MODEL_IDS).optional(),
    })
    .strict(),
  z.object({ retry: z.number().int().positive() }).strict(),
])

/** The body of a choice: the file name of the take on the track's board. */
export const ChooseTakeBody = z.object({ file: z.string().min(1) }).strict()

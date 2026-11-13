import { z } from 'zod'
import { type FineTuneAnswer } from '../services/imageFineTunes'
import { type ImagePatchAnswer, type RemakeAnswer } from '../services/imagePatches'
import { seamWav } from '../core/musicTake'
import { FadesSchema, applyFades } from '../core/fades'
import { readWav, writeWav } from '../core/wav'
import { FishTierSchema } from '../core/project'
import { FISH_VOICE_ID, VOICE_ID } from '../core/voices'
import { type Budget } from '../core/spend'
import { SPEED } from '../core/resources'
import { type ImageEditResult } from '../services/imageEdits'
import { type EffectEditResult } from '../services/effectWords'
import { SceneMixSchema } from '../core/scenes'
import { type ImageMakeAllAnswer, type ImageTakesAnswer } from '../services/imageTakes'

/**
 * A change to a character: its keywords, its own audition phrase (null for the standard one), its
 * style, or its own speed (null for the project's).
 */
export const CharacterBody = z.union([
  z.object({ keywords: z.array(z.string()).max(20) }).strict(),
  z.object({ phrase: z.string().max(10_000).nullable() }).strict(),
  z.object({ style: z.string().max(1_000) }).strict(),
  z.object({ speed: z.number().min(SPEED.min).max(SPEED.max).nullable() }).strict(),
])

/** The whole pronunciation table, and the one the page showed (to refuse a stale page). */
export const Table = z.array(z.tuple([z.string().max(1_000), z.string().max(1_000)])).max(2_000)
/** The body of a save of the pronunciation table. */
export const PronounceBody = z.object({ table: Table, was: Table }).strict()

/** The project's own sound-alike groups, and the ones the editing began from. */
export const Groups = z.array(z.array(z.string().max(200)).max(50)).max(1000)
/** The body of a save of the words that sound the same. */
export const SoundAlikeBody = z.object({ groups: Groups, was: Groups }).strict()

/** The Fish tier the user chose, or null to clear it. */
export const FishTierBody = z.object({ tier: FishTierSchema.nullable() }).strict()

/** How long takes fade in the studio, in seconds. */
export const TakeFadeBody = z.object({ seconds: z.number().min(0) }).strict()

/** The takes whose model the page offered to switch from s1. */
export const ModelsBody = z
  .object({
    takes: z
      .array(z.enum(['draft', 'final']))
      .min(1)
      .refine((takes) => new Set(takes).size === takes.length),
  })
  .strict()

/** The stages whose model can be chosen. */
export const StageParam = z.enum(['audition', 'draft', 'final'])

/** The box of a named area as the page saves it; null takes it away. */
export const AreaBoxBody = z.object({
  box: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      point: z.object({ x: z.number(), y: z.number() }).optional(),
    })
    .nullable(),
})

/** The answer to a change of the studio's image words: 404 for an unknown image, 409 with the reason. */
export function imageAnswer(
  result:
    | ImageEditResult
    | ImageTakesAnswer
    | ImageMakeAllAnswer
    | ImagePatchAnswer
    | RemakeAnswer
    | FineTuneAnswer,
): Response {
  if (!result) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(result, { status: result.ok ? 200 : 409 })
}

/** A scene as the page saves it, and the entry it was read as (null: the mix had none). */
export const SceneBody = z
  .object({
    scene: SceneMixSchema,
    was: SceneMixSchema.nullable(),
    moved: z.object({ db: z.number(), measuredAt: z.string() }).strict().optional(),
  })
  .strict()

/** Measuring an act's scenes, with the open scene as the page has it (unsaved changes included). */
export const MeasureBody = z
  .object({ open: z.object({ scene: z.string(), entry: SceneMixSchema }).strict().optional() })
  .strict()

/** The new description of a sound effect: text, or null to take the game's back. */
export const EffectDescriptionBody = z.object({ description: z.string().nullable() }).strict()

/** The answer to a change of the studio's sound effect descriptions. */
export function effectAnswer(result: EffectEditResult): Response {
  if (!result) return notFound()
  return Response.json(result, { status: result.ok ? 200 : 409 })
}

/** The model the page chose for a stage or for the music, and the one it showed. */
export const StageModelBody = z
  .object({ model: z.string().min(1), was: z.string().min(1) })
  .strict()

/** ElevenLabs' voice settings as numbers; their ranges are the project file's to check. */
export const ElevenTtsShape = z
  .object({ stability: z.number(), similarityBoost: z.number(), style: z.number() })
  .strict()

/** The body of a voice settings save: the new settings, and the ones the page showed. */
export const ElevenTtsBody = z.object({ tts: ElevenTtsShape, was: ElevenTtsShape }).strict()

/** Where an orphaned cue goes: a line key, or null to remove it. */
export const MoveCueBody = z.object({ to: z.string().min(1).max(200).nullable() }).strict()

/** A cue tried or placed at a gap inside a line (`at`: the words before it). */
export const TryBody = z
  .object({ cue: z.string().max(1_000), at: z.number().int().optional() })
  .strict()

/** A cue placed, changed (or, empty, removed) at a gap inside a line, and the words the page showed. */
export const InsideCueBody = z
  .object({
    at: z.number().int(),
    cue: z.string().max(1_000),
    text: z.string().max(20_000),
  })
  .strict()

/** A scene's cue, by the scene's name; empty to remove it. */
export const SceneCueBody = z
  .object({ scene: z.string().min(1).max(200), cue: z.string().max(1_000) })
  .strict()

/** Where an orphaned scene cue goes: the name of a scene, or null to remove it. */
export const MoveSceneCueBody = z
  .object({ from: z.string().min(1).max(200), to: z.string().min(1).max(200).nullable() })
  .strict()

/** A line's own cue; empty to go back to the character's style. */
export const CueBody = z.object({ cue: z.string().max(1_000) }).strict()

/** The user's note on a line; empty to remove it. */
export const NoteBody = z.object({ note: z.string().max(2_000) }).strict()

/**
 * A generation to start: the scope, and the lines and orphans the page showed. Only those, and
 * only as far as they are still in the server's own fresh plan, are recorded or removed.
 */
export const JobBody = z
  .object({
    /**
     * Record lines (default), measure clips never checked, or check weak lines again: the last
     * two with Whisper alone, without new audio.
     */
    kind: z.enum(['record', 'measure', 'check']).default('record'),
    /** Record with the draft model (default), or the final recording with the final one. */
    stage: z.enum(['draft', 'final']).default('draft'),
    /** Retake the weak lines among `keys` (only when the user ticked it). */
    retakeWeak: z.boolean().default(false),
    speaker: z.string().min(1).max(200).nullable(),
    keys: z.array(z.string()).max(100_000),
    orphans: z.array(z.string()).max(100_000),
    /** The most the user agreed to spend, in dollars, for a paid model. */
    confirmedCost: z.number().nonnegative().optional(),
    /** The most ElevenLabs credits the user agreed to, for lines with ElevenLabs voices. */
    confirmedCredits: z.number().nonnegative().optional(),
  })
  .strict()

/** JSON text parsed, or null when it is not JSON (answered with 400 by the route's schema). */
export function parseOrNull(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Taking a line again: the most the user agreed to spend on the take, for a paid draft model, or
 * the ElevenLabs credits, for a line with an ElevenLabs voice.
 */
export const TakeLineBody = z
  .object({
    confirmedCost: z.number().nonnegative().optional(),
    confirmedCredits: z.number().nonnegative().optional(),
  })
  .strict()

/** Recording one line: the most the user agreed to spend on it, for a paid model, or in credits. */
export const RecordBody = z
  .object({
    confirmedCost: z.number().nonnegative().optional(),
    confirmedCredits: z.number().nonnegative().optional(),
    /** Record with the final model (a final clip recorded again), or the draft one (default). */
    stage: z.enum(['draft', 'final']).default('draft'),
  })
  .strict()

/** A voice to bring in or cast: either provider's. */
export const VoiceBody = z.object({ voice: z.string().regex(VOICE_ID) })

/** The voices to remove from the user's ElevenLabs voices, by their studio ids. */
export const FreeBody = z
  .object({ voices: z.array(z.string().regex(VOICE_ID)).min(1).max(500) })
  .strict()

/** Whose library more voices come from: Fish's unless ElevenLabs' is asked for. */
export const MoreBody = z
  .object({ provider: z.enum(['fish', 'elevenlabs']).default('fish') })
  .strict()

/** The body of moving a voice on the audition board. */
export const MoveBody = VoiceBody.extend({ move: z.enum(['shortlist', 'unlist', 'drop']) })

/**
 * A take to record: for the board (the audition model, paid from the sitting) or the cast voice's
 * page (free with a Fish voice, ElevenLabs' audition model with an ElevenLabs one).
 */
export const AuditionTakeBody = z.object({
  voice: z.string().regex(VOICE_ID),
  board: z.boolean().default(false),
})

/** Credits a sitting may spend on ElevenLabs voices' takes, from the box. */
export const SittingCredits = z.number().int().positive().max(10_000_000)

/**
 * What a sitting may spend, from the box: Fish's dollars, ElevenLabs' credits, or both; at least
 * one of them.
 */
export const AmountBody = z
  .object({
    amount: z.number().positive().max(10_000).optional(),
    credits: SittingCredits.optional(),
  })
  .strict()
  .refine((body) => body.amount !== undefined || body.credits !== undefined)

/** What is added to a sitting: Fish's dollars or ElevenLabs' credits, one at a time. */
export const AddBody = z.union([
  z.object({ amount: z.number().positive().max(10_000) }).strict(),
  z.object({ credits: SittingCredits }).strict(),
])

/**
 * Starting an audition; a paid audition model needs the amount its sitting may spend, and
 * ElevenLabs voices' board takes the credits (`creditsUpTo`, optional: without them those voices
 * make no takes).
 */
export const StartBody = z
  .object({
    spendUpTo: z.number().positive().max(10_000).optional(),
    creditsUpTo: SittingCredits.optional(),
  })
  .strict()
/** Designing voices: the description, and the most the user agreed to spend on the design. */
export const DesignBody = z
  .object({
    description: z.string(),
    spendUpTo: z.number().positive().max(10_000).optional(),
    /** Whose design: Fish's unless ElevenLabs' is asked for, with the credits confirmed. */
    provider: z.enum(['fish', 'elevenlabs']).default('fish'),
    creditsUpTo: z.number().int().positive().max(10_000).optional(),
  })
  .strict()
/** What casting a voice made from recordings sends: the voice and the name to cast it under. */
export const CastOwnBody = z.object({
  voice: z.string().regex(FISH_VOICE_ID),
  name: z.string().trim().min(1),
})

/** How long a plan shows the ElevenLabs account it read before reading it again. */
export const SHOWN_ACCOUNT_MS = 30_000

/** The `?language=` a request names, if any: the services fall back to the source language. */
export const languageOf = (request: Request) =>
  new URL(request.url).searchParams.get('language') ?? undefined

/** The answer for a path or thing that is not there. */
export const notFound = () => Response.json({ error: 'not found' }, { status: 404 })

/** The answer for a request the studio refuses to serve. */
export const forbidden = (error: string) => Response.json({ error }, { status: 403 })

/**
 * The Host values the studio answers to on `port`. Browsers leave the port out on port 80, so
 * there the bare names count too.
 */
export function allowedHosts(port: number): string[] {
  const names = ['127.0.0.1', 'localhost']
  const withPort = names.map((name) => `${name}:${port}`)
  return port === 80 ? [...withPort, ...names] : withPort
}

/**
 * A take's WAV; with `?seam=1`, its seam instead: the last seconds and then the first, to hear a
 * loop come round; with `?fadeIn=&fadeOut=&shape=`, the take with those fades in the sound, which is
 * what the game will play once they are saved.
 */
export async function takeResponse(
  request: Request,
  file: string,
  /** The sound to serve instead of the file's: a trimmed take's part between its cuts. */
  sound?: Uint8Array,
): Promise<Response> {
  const params = new URL(request.url).searchParams
  if (params.get('seam') === '1') {
    const wav = readWav(new Uint8Array(await Bun.file(file).arrayBuffer()))
    return new Response(writeWav(seamWav(wav)) as Uint8Array<ArrayBuffer>, {
      headers: { 'content-type': 'audio/wav' },
    })
  }
  if (!['fadeIn', 'fadeOut', 'shape'].some((name) => params.has(name))) {
    return sound
      ? new Response(sound as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'audio/wav' } })
      : new Response(Bun.file(file))
  }
  const asked = FadesSchema.safeParse({
    in: Number(params.get('fadeIn') ?? 0),
    out: Number(params.get('fadeOut') ?? 0),
    shape: params.get('shape') ?? 'smooth',
  })
  if (!asked.success) {
    return Response.json({ error: 'expected fadeIn, fadeOut and shape' }, { status: 400 })
  }
  const wav = readWav(sound ?? new Uint8Array(await Bun.file(file).arrayBuffer()))
  return new Response(writeWav(applyFades(wav, asked.data)) as Uint8Array<ArrayBuffer>, {
    headers: { 'content-type': 'audio/wav' },
  })
}

/** What a fresh sitting was given: its dollars on a paid model, its credits when asked for. */
export type Given = { dollars?: Budget; credits?: Budget }

/**
 * A request to one of the API's routes: the address's parameters, which Bun types from a route's
 * path only where the route is written inside `Bun.serve`. Each route has the few it names.
 */
export type RouteRequest = Request & {
  params: Record<
    'area' | 'file' | 'id' | 'key' | 'n' | 'part' | 'patch' | 'stage' | 'voice',
    string
  >
}

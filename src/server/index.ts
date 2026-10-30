import { basename, dirname } from 'node:path'
import { z } from 'zod'
import {
  characterVoice,
  setKeywords,
  setPhrase,
  setPronunciations,
  setSpeed,
  setStyle,
  type FishFactory,
} from '../services/auditions'
import type { Encoder } from '../services/audio'
import { createLimiter } from '../services/limit'
import { costCeiling, creditCeiling, planGeneration } from '../core/generation'
import type { LineState } from '../core/planner'
import { ChooseImageTakeBody, MakeImageTakesBody } from '../core/imageTakes'
import { BriefChangeBody } from '../core/music'
import { ChooseTakeBody, MakeTakesBody, MoveTakeBody, seamWav } from '../core/musicTake'
import { readWav, writeWav } from '../core/wav'
import { FishTierSchema } from '../core/project'
import { FISH_VOICE_ID, providerOf, VOICE_ID } from '../core/voices'
import { finalStepFor, modelForStage, voicesOf } from '../core/elevenSpeech'
import type { ElevenAnswer } from '../core/setup'
import {
  accountOf,
  createElevenLabsClient,
  elevenFromEnv,
  NO_ELEVENLABS_KEY,
  type ElevenLabsClient,
  type ElevenLabsFactory,
} from '../services/elevenlabs'
import { createElevenMusic } from '../services/elevenMusic'
import { elevenLabsApiKey } from '../services/env'
import {
  isPaid,
  sittingMoney,
  suggestedAmount,
  suggestedCredits,
  type SittingView,
} from '../core/sitting'
import {
  createBudget,
  creditProblem,
  creditsLeft,
  spendProblem,
  type Budget,
  type SpendProblem,
} from '../core/spend'
import { planPart } from '../core/planner'
import { SPEED } from '../core/resources'
import { sentPieces } from '../core/spoken'
import { createJobs } from '../services/jobs'
import { appendMusic, createSpendLog, readSpending } from '../services/spending'
import { outcomeOf, summariseSpending } from '../core/spending'
import { moveCue, moveSceneCue, setCue, setInsideCue, setSceneCue } from '../services/cues'
import { gitChanges } from '../services/git'
import { setTrackBrief } from '../services/briefs'
import {
  markStyleSeen,
  resolveImageCompare,
  setImageWords,
  setStyleField,
  type ImageEditResult,
} from '../services/imageEdits'
import { CompareBody, StyleFieldBody, WordsBody } from '../core/images'
import { isRefreshing, refreshDialog, refreshShared } from '../services/refresh'
import { acceptLine, measureLine, recordLine, removeOrphans } from '../services/narration'
import {
  setElevenModel,
  setElevenSettings,
  setImageModel,
  setMusicModel,
  setStageModel,
  switchRetiredModels,
  type ModelsChange,
} from '../services/models'
import type { Stage } from '../core/models'
import { modelsView } from '../services/modelsView'
import type { Busy } from '../core/models'
import { setFishTier } from '../services/fishTier'
import { setTakeFade } from '../services/takeFade'
import { setSoundAlike } from '../services/soundAlike'
import { recordTake, takeFile, tryLine } from '../services/takes'
import { checkSetup } from '../services/setup'
import { setNote } from '../services/notes'
import {
  dropLineTake,
  lineTakeFile,
  listLineTakes,
  takeLine,
  useLineTake,
} from '../services/lineTakes'
import { cloneVoice } from '../services/cloneVoice'
import { DESIGN_MODEL, DESIGN_PRICE, isDesignId } from '../core/design'
import {
  castDesign,
  designElevenVoices,
  designVoices,
  designsFor,
  elevenDesignFor,
} from '../services/designs'
import { ELEVEN_DESIGN_MODEL, elevenDescriptionState } from '../core/elevenDesign'
import { allowVoices, ruledOutVoices, type RuledOutResult } from '../services/ruledOut'
import {
  addVoiceById,
  auditionMoney,
  boardVoice,
  castOwnVoice,
  castVoice,
  discardSession,
  moreVoices,
  moveVoice,
  recordSpent,
  refreshOwnVoices,
  sessionFor,
  startAudition,
  undoLastDrop,
  viewOf,
  voiceAdded,
  voicesInUse,
  voicesRemoved,
  SESSIONS_DIR,
  type SessionResult,
} from '../services/sessions'
import { freeVoices, readAddedVoices, voiceToSpeak } from '../services/elevenVoices'
import { freeableVoices } from '../core/elevenLibrary'
import type { Voice } from '../core/voiceSearch'
import { fishFromEnv, NO_KEY, type CreditResult, type FishClient } from '../services/fish'
import { heardFor } from '../services/heard'
import { onGpu, onGpuFree } from '../services/gpu'
import { createAceStepWorker, createMusicRouter, type MusicGenerator } from '../services/music'
import { createStableAudioWorker } from '../services/stableAudio'
import { createFakeMusic } from '../services/musicFake'
import { removeOrphan } from '../services/musicOrphans'
import { createMusicTakes } from '../services/musicTakes'
import { createImageTakes, type ImageTakesAnswer } from '../services/imageTakes'
import { createMfluxGenerator, type ImageGenerator } from '../services/images'
import { createFakeImages } from '../services/imagesFake'
import { createWhisperWorker, type Transcriber } from '../services/transcriber'
import { declaredLanguage } from '../core/project'
import {
  adoptPart,
  cacheNameFor,
  clipFile,
  musicClipFile,
  musicCurrentFile,
  loadPart,
  loadProject,
  openProject,
  readPart,
} from '../services/workspace'
import index from '../ui/index.html'

/** How to start the studio's server. */
export interface ServerOptions {
  projectFile: string
  /** 0 picks a free port. */
  port: number
  /** Hot reloading and browser console forwarding, for working on the studio itself. */
  development?: boolean
  /** The Fish client to use (tests); by default one is made from the project's API key. */
  fish?: FishClient | null
  /** The clip encoder to use (tests); ffmpeg by default. */
  encode?: Encoder
  /** The take checker to use (tests: null for none); by default a Whisper worker, started on use. */
  transcriber?: Transcriber | null
  /** The music generator to use (tests); by default an ACE-Step worker, started on use. */
  music?: MusicGenerator
  /** The ElevenLabs client to use (tests); by default one is made from the project's API key. */
  elevenlabs?: ElevenLabsClient | null
  /** The image generator to use (tests); by default mflux, or a stand-in when `AUDIO_STUDIO_FAKE_IMAGES=1`. */
  images?: ImageGenerator
}

/**
 * The process's one Whisper worker, kept across `--dev` reloads (which rerun this module) so a
 * reload never leaves a worker and its model behind. It starts on its first take and exits when
 * the studio does.
 */
function sharedWhisper(): Transcriber {
  const state = globalThis as { audioStudioWhisper?: Transcriber }
  if (!state.audioStudioWhisper) {
    state.audioStudioWhisper = createWhisperWorker()
    onGpuFree(() => state.audioStudioWhisper?.close())
  }
  return state.audioStudioWhisper
}

/**
 * The process's music generators as one, kept across `--dev` reloads like Whisper's: the ACE-Step
 * and Stable Audio workers, each started with its first take and ended with the studio, and Eleven
 * Music, with the project's ElevenLabs key read on every use. `AUDIO_STUDIO_FAKE_MUSIC=1` swaps
 * them for a stand-in that makes tones, for working on the pages.
 */
function sharedMusic(projectFile: string): MusicGenerator {
  const state = globalThis as { audioStudioMusic?: MusicGenerator }
  if (!state.audioStudioMusic) {
    state.audioStudioMusic =
      process.env.AUDIO_STUDIO_FAKE_MUSIC === '1'
        ? createFakeMusic()
        : createMusicRouter({
            acestep: createAceStepWorker(),
            'stable-audio': createStableAudioWorker(),
            elevenlabs: createElevenMusic({
              apiKey: async () => {
                const opened = await openProject(projectFile)
                return opened.ok ? elevenLabsApiKey(dirname(projectFile), opened.project.env) : null
              },
            }),
          })
    // An image take closes the music workers first (they come back with the next take).
    onGpuFree(() => state.audioStudioMusic?.close())
  }
  return state.audioStudioMusic
}

/**
 * A change to a character: its keywords, its own audition phrase (null for the standard one), its
 * style, or its own speed (null for the project's).
 */
const CharacterBody = z.union([
  z.object({ keywords: z.array(z.string()).max(20) }).strict(),
  z.object({ phrase: z.string().max(10_000).nullable() }).strict(),
  z.object({ style: z.string().max(1_000) }).strict(),
  z.object({ speed: z.number().min(SPEED.min).max(SPEED.max).nullable() }).strict(),
])

/** The whole pronunciation table, and the one the page showed (to refuse a stale page). */
const Table = z.array(z.tuple([z.string().max(1_000), z.string().max(1_000)])).max(2_000)
const PronounceBody = z.object({ table: Table, was: Table }).strict()

/** The project's own sound-alike groups, and the ones the editing began from. */
const Groups = z.array(z.array(z.string().max(200)).max(50)).max(1000)
const SoundAlikeBody = z.object({ groups: Groups, was: Groups }).strict()

/** The Fish tier the user chose, or null to clear it. */
const FishTierBody = z.object({ tier: FishTierSchema.nullable() }).strict()

/** How long takes fade in the studio, in seconds. */
const TakeFadeBody = z.object({ seconds: z.number().min(0) }).strict()

/** The takes whose model the page offered to switch from s1. */
const ModelsBody = z
  .object({
    takes: z
      .array(z.enum(['draft', 'final']))
      .min(1)
      .refine((takes) => new Set(takes).size === takes.length),
  })
  .strict()

/** The stages whose model can be chosen. */
const StageParam = z.enum(['audition', 'draft', 'final'])

/** The answer to a change of the studio's image words: 404 for an unknown image, 409 with the reason. */
function imageAnswer(result: ImageEditResult | ImageTakesAnswer): Response {
  if (!result) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(result, { status: result.ok ? 200 : 409 })
}

/** The model the page chose for a stage or for the music, and the one it showed. */
const StageModelBody = z.object({ model: z.string().min(1), was: z.string().min(1) }).strict()

/** ElevenLabs' voice settings as numbers; their ranges are the project file's to check. */
const ElevenTtsShape = z
  .object({ stability: z.number(), similarityBoost: z.number(), style: z.number() })
  .strict()

/** The body of a voice settings save: the new settings, and the ones the page showed. */
const ElevenTtsBody = z.object({ tts: ElevenTtsShape, was: ElevenTtsShape }).strict()

/** Where an orphaned cue goes: a line key, or null to remove it. */
const MoveCueBody = z.object({ to: z.string().min(1).max(200).nullable() }).strict()

/** A cue tried or placed at a gap inside a line (`at`: the words before it). */
const TryBody = z.object({ cue: z.string().max(1_000), at: z.number().int().optional() }).strict()

/** A cue placed, changed (or, empty, removed) at a gap inside a line, and the words the page showed. */
const InsideCueBody = z
  .object({
    at: z.number().int(),
    cue: z.string().max(1_000),
    text: z.string().max(20_000),
  })
  .strict()

/** A scene's cue, by the scene's name; empty to remove it. */
const SceneCueBody = z
  .object({ scene: z.string().min(1).max(200), cue: z.string().max(1_000) })
  .strict()

/** Where an orphaned scene cue goes: the name of a scene, or null to remove it. */
const MoveSceneCueBody = z
  .object({ from: z.string().min(1).max(200), to: z.string().min(1).max(200).nullable() })
  .strict()

/** A line's own cue; empty to go back to the character's style. */
const CueBody = z.object({ cue: z.string().max(1_000) }).strict()

/** The user's note on a line; empty to remove it. */
const NoteBody = z.object({ note: z.string().max(2_000) }).strict()

/**
 * A generation to start: the scope, and the lines and orphans the page showed. Only those, and
 * only as far as they are still in the server's own fresh plan, are recorded or removed.
 */
const JobBody = z
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
function parseOrNull(text: string): unknown {
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
const TakeLineBody = z
  .object({
    confirmedCost: z.number().nonnegative().optional(),
    confirmedCredits: z.number().nonnegative().optional(),
  })
  .strict()

/** Recording one line: the most the user agreed to spend on it, for a paid model, or in credits. */
const RecordBody = z
  .object({
    confirmedCost: z.number().nonnegative().optional(),
    confirmedCredits: z.number().nonnegative().optional(),
    /** Record with the final model (a final clip recorded again), or the draft one (default). */
    stage: z.enum(['draft', 'final']).default('draft'),
  })
  .strict()

/** A voice to bring in or cast: either provider's. */
const VoiceBody = z.object({ voice: z.string().regex(VOICE_ID) })

/** The voices to remove from the user's ElevenLabs voices, by their studio ids. */
const FreeBody = z.object({ voices: z.array(z.string().regex(VOICE_ID)).min(1).max(500) }).strict()

/** Whose library more voices come from: Fish's unless ElevenLabs' is asked for. */
const MoreBody = z.object({ provider: z.enum(['fish', 'elevenlabs']).default('fish') }).strict()

const MoveBody = VoiceBody.extend({ move: z.enum(['shortlist', 'unlist', 'drop']) })

/**
 * A take to record: for the board (the audition model, paid from the sitting) or the cast voice's
 * page (free with a Fish voice, ElevenLabs' audition model with an ElevenLabs one).
 */
const AuditionTakeBody = z.object({
  voice: z.string().regex(VOICE_ID),
  board: z.boolean().default(false),
})

/** Credits a sitting may spend on ElevenLabs voices' takes, from the box. */
const SittingCredits = z.number().int().positive().max(10_000_000)

/**
 * What a sitting may spend, from the box: Fish's dollars, ElevenLabs' credits, or both; at least
 * one of them.
 */
const AmountBody = z
  .object({
    amount: z.number().positive().max(10_000).optional(),
    credits: SittingCredits.optional(),
  })
  .strict()
  .refine((body) => body.amount !== undefined || body.credits !== undefined)

/** What is added to a sitting: Fish's dollars or ElevenLabs' credits, one at a time. */
const AddBody = z.union([
  z.object({ amount: z.number().positive().max(10_000) }).strict(),
  z.object({ credits: SittingCredits }).strict(),
])

/**
 * Starting an audition; a paid audition model needs the amount its sitting may spend, and
 * ElevenLabs voices' board takes the credits (`creditsUpTo`, optional: without them those voices
 * make no takes).
 */
const StartBody = z
  .object({
    spendUpTo: z.number().positive().max(10_000).optional(),
    creditsUpTo: SittingCredits.optional(),
  })
  .strict()
/** Designing voices: the description, and the most the user agreed to spend on the design. */
const DesignBody = z
  .object({
    description: z.string(),
    spendUpTo: z.number().positive().max(10_000).optional(),
    /** Whose design: Fish's unless ElevenLabs' is asked for, with the credits confirmed. */
    provider: z.enum(['fish', 'elevenlabs']).default('fish'),
    creditsUpTo: z.number().int().positive().max(10_000).optional(),
  })
  .strict()
/** What casting a voice made from recordings sends: the voice and the name to cast it under. */
const CastOwnBody = z.object({
  voice: z.string().regex(FISH_VOICE_ID),
  name: z.string().trim().min(1),
})

/** How long a plan shows the ElevenLabs account it read before reading it again. */
const SHOWN_ACCOUNT_MS = 30_000

/** The `?language=` a request names, if any: the services fall back to the source language. */
const languageOf = (request: Request) =>
  new URL(request.url).searchParams.get('language') ?? undefined

const notFound = () => Response.json({ error: 'not found' }, { status: 404 })

const forbidden = (error: string) => Response.json({ error }, { status: 403 })

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
 * The studio's local server: the UI, and a JSON API over the project. It listens on 127.0.0.1
 * only, reads the project from disk on every request, so edits show up on reload, and takes
 * changes only from its own page.
 *
 * The API answers only requests addressed to 127.0.0.1 or localhost on its port, so a web page
 * whose host name was made to point at this machine (DNS rebinding) cannot read the project.
 */
export function startServer({
  projectFile,
  port,
  development = false,
  fish,
  encode,
  transcriber,
  music,
  elevenlabs,
  images,
}: ServerOptions) {
  const imageGenerator =
    images ??
    (process.env.AUDIO_STUDIO_FAKE_IMAGES === '1' ? createFakeImages() : createMfluxGenerator())
  const imageTakes = createImageTakes({ generator: imageGenerator })
  const musicGenerator = music ?? sharedMusic(projectFile)
  const musicTakes = createMusicTakes({
    generator: musicGenerator,
    ...(encode ? { encode } : {}),
    // A paid take is a row of the spending record (its version 2).
    spent: async (file, take) => {
      const saved = await appendMusic(file, take)
      if (!saved.ok) {
        console.error(
          'Audio Studio: a paid music take was not saved to the spending record:',
          saved.problems,
        )
      }
    },
  })
  /** The Fish client: the one given (tests), else made from the project's API key on every use. */
  const fishFor: FishFactory = fish !== undefined ? async () => fish : fishFromEnv
  /** The ElevenLabs client: the one given (tests; null for none), else made from the project's key on every use. */
  const elevenFor: ElevenLabsFactory =
    elevenlabs !== undefined ? async () => elevenlabs : elevenFromEnv
  /** A character's ruled-out voices as an answer: 404 for an unknown character, 409 for a broken project. */
  async function ruledOut(pending: Promise<RuledOutResult>): Promise<Response> {
    const result = await pending
    if (!result) return notFound()
    return Response.json(result, { status: result.ok ? 200 : 409 })
  }

  /** A session action's answer: the session as the page shows it; 404 for an unknown character. */
  async function answer(
    characterId: string,
    pending: Promise<SessionResult>,
    options: { recorded?: boolean; language?: string } = {},
  ): Promise<Response> {
    const result = await pending
    if (!result) return notFound()
    const view = await viewOf(projectFile, characterId, result, options)
    return Response.json(view, { status: view.ok ? 200 : 409 })
  }

  /**
   * The language a request means, as the project declares it (the source language's if unknown).
   * Jobs need the code itself, as they are kept by part and language; the services given the
   * raw `?language=` settle it themselves.
   */
  async function languageFor(request: Request): Promise<string | undefined> {
    const opened = await openProject(projectFile)
    return opened.ok ? declaredLanguage(opened.project.narration, languageOf(request)) : undefined
  }

  /** Fish TTS requests (audition takes and lines alike): `quality.parallel` at a time, each once. */
  const fishWork = createLimiter()
  /** ElevenLabs' requests wait for each other only, never for Fish's. */
  const elevenWork = createLimiter()
  /** Generation jobs, one per part at a time. */
  const jobs = createJobs()

  /** What is asking Fish now outside a job: a part's line being recorded or tried, a character's audition. */
  const going = new Map<string, number>()

  /** Runs one request that records or auditions, which counts as going on until it answers. */
  async function whileGoing<T>(kind: 'part' | 'character', id: string, run: () => Promise<T>) {
    const key = `${kind}:${id}`
    going.set(key, (going.get(key) ?? 0) + 1)
    try {
      return await run()
    } finally {
      const left = (going.get(key) ?? 1) - 1
      if (left > 0) going.set(key, left)
      else going.delete(key)
    }
  }

  /** What is recording or auditioning now, which stops the models being changed; null if nothing. */
  async function busyNow(): Promise<Busy | null> {
    const opened = await openProject(projectFile)
    if (!opened.ok) return null
    const { parts } = opened.project.narration
    const titleOf = (id: string) => parts.find((p) => p.id === id)?.title ?? id
    const underway = (kind: 'part' | 'character') =>
      [...going.keys()].find((key) => key.startsWith(`${kind}:`))?.slice(kind.length + 1)
    const recording = jobs.active()[0] ?? spendLog.running()[0]?.part ?? underway('part')
    if (recording !== undefined) return { kind: 'recording', name: titleOf(recording) }
    const character = underway('character')
    if (character === undefined) return null
    const loaded = await loadProject(projectFile)
    const name = loaded.ok ? loaded.summary.characters.find((c) => c.id === character)?.name : null
    return { kind: 'auditioning', name: name ?? character }
  }

  /** The account's remaining credit, or why it cannot be read. */
  async function creditOf(): Promise<CreditResult> {
    const opened = await openProject(projectFile)
    if (!opened.ok)
      return { ok: false, reason: 'project', message: 'The project file cannot be read.' }
    const client = await fishFor(dirname(projectFile), opened.project)
    if (!client) {
      return {
        ok: false,
        reason: 'no-key',
        message: NO_KEY,
      }
    }
    try {
      return { ok: true, credit: await client.credit() }
    } catch (error) {
      return {
        ok: false,
        reason: 'fish',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * The ElevenLabs account, asked with the key Setup found: through the client given (tests; null
   * is none, so nothing is asked), else one made from that key.
   */
  async function elevenAccountOf(apiKey: string): Promise<ElevenAnswer> {
    const client = elevenlabs !== undefined ? elevenlabs : createElevenLabsClient(apiKey)
    return client
      ? accountOf(client)
      : { ok: false, reason: 'no-key', message: 'No ElevenLabs client.' }
  }

  /**
   * Admits a recording on `model` costing at most `ceiling`: a budget for it (the confirmed
   * dollars, held back from the credit while it runs; release it with `budgets.delete`), or why
   * not. The credit is asked for only once a paid cost is confirmed.
   */
  function admit(
    model: string,
    ceiling: number | null,
    confirmed?: number,
  ): Promise<{ budget: Budget } | { problem: SpendProblem }> {
    const asked = spendProblem({ ceiling, confirmed })
    if (asked && asked.reason !== 'credit') return Promise.resolve({ problem: asked })
    // Free: nothing to hold back, so no need to wait for anyone else's credit check.
    if (!ceiling) return Promise.resolve({ budget: createBudget({ model, dollars: 0 }) })
    // The budget is what was confirmed, rounded to cents at most a cent above the ceiling; the
    // credit is checked against that whole budget.
    const dollars = Math.min(confirmed ?? ceiling, ceiling + 0.01)
    return (async () => {
      // A recording that ends while the credit is read may not be billed in that reading yet:
      // what was held back when it was asked for is still counted.
      const heldWhenAsked = new Set(budgets)
      const credit = await creditOf()
      // From here to adding the budget nothing awaits, so two recordings asked for at once cannot
      // both count on the same credit: the second sees the first's budget held back.
      const free = credit.ok ? credit.credit - reserved(heldWhenAsked) : null
      const problem = spendProblem({ ceiling: dollars, confirmed: dollars, credit: free })
      if (problem) return { problem }
      const budget = createBudget({ model, dollars })
      budgets.add(budget)
      return { budget }
    })()
  }

  /**
   * Admits a recording on ElevenLabs' `model` taking at most `ceiling` credits: a budget for it
   * (the confirmed credits, held back from what the plan has left while it runs; release it with
   * `held.delete`), or why not. The account is asked only once the credits are confirmed.
   */
  async function admitCredits(
    model: string,
    ceiling: number,
    confirmed?: number,
    replacing?: Budget,
  ): Promise<{ budget: Budget } | { problem: SpendProblem }> {
    const asked = creditProblem({ ceiling, confirmed, left: Infinity })
    if (asked) return { problem: asked }
    if (!ceiling) return { budget: createBudget({ model, dollars: 0 }) }
    // The confirmation covers the ceiling; what is held is the ceiling up to the whole credit.
    const credits = Math.ceil(ceiling)
    const budget = createBudget({ model, dollars: credits })
    const problem = await holdCredits(credits, () => creditBudgets.add(budget), replacing)
    return problem ? { problem } : { budget }
  }

  /**
   * Checks that the plan has `credits` free beyond what running recordings and sittings hold (but
   * `replacing`, a sitting's credits about to be replaced), and if so calls `hold` before anything
   * else can run, so two of them cannot count on the same credits; else gives the problem (no key,
   * unknown, too few).
   */
  async function holdCredits(
    credits: number,
    hold: () => void,
    replacing?: Budget,
  ): Promise<SpendProblem | null> {
    const opened = await openProject(projectFile)
    const client = opened.ok ? await elevenFor(dirname(projectFile), opened.project) : null
    if (!client) return { reason: 'credits', message: NO_ELEVENLABS_KEY }
    // As with Fish's credit: what was held back when the account was asked is still counted.
    const heldWhenAsked = new Set(creditBudgets)
    const answer = await accountOf(client)
    // From here to `hold` nothing awaits.
    const holding = [...new Set([...creditBudgets, ...heldWhenAsked])]
    // A sitting about to be replaced holds only its takes in flight, which ElevenLabs may still bill.
    const held = holding.reduce(
      (sum, b) => sum + (b === replacing ? (creditsInFlight.get(b) ?? 0) : heldCredits(b)),
      0,
    )
    const left = answer.ok ? creditsLeft(answer.account) - held - landingCredits() : null
    const problem = creditProblem({ ceiling: credits, confirmed: credits, left })
    if (!problem) hold()
    return problem
  }

  /** The credits running recordings and audition sittings hold back from the plan. */
  function elevenHeld(): number {
    return (
      [...creditBudgets].reduce((sum, budget) => sum + heldCredits(budget), 0) + landingCredits()
    )
  }

  /**
   * The ElevenLabs account as plans show it: asked at most every half minute, since a part's plan
   * is asked for again after every line recorded. Admission always asks afresh.
   */
  let shown: { at: number; answer: Promise<ElevenAnswer> } | null = null
  async function shownAccount(): Promise<ElevenAnswer> {
    if (shown && Date.now() - shown.at < SHOWN_ACCOUNT_MS) return shown.answer
    const opened = await openProject(projectFile)
    const client = opened.ok ? await elevenFor(dirname(projectFile), opened.project) : null
    const answer: Promise<ElevenAnswer> = client
      ? accountOf(client)
      : Promise.resolve({ ok: false, reason: 'no-key', message: NO_ELEVENLABS_KEY })
    shown = { at: Date.now(), answer }
    return answer
  }

  /**
   * The ElevenLabs budgets of the recordings and audition sittings running now: held back from
   * what the plan has left until they end (`heldCredits` says how much).
   */
  const creditBudgets = new Set<Budget>()
  /**
   * What an ElevenLabs budget holds back from the plan: all a recording was given, but only what
   * is left of a sitting, and what its takes in flight cost, as Fish's sittings hold dollars.
   */
  const heldCredits = (budget: Budget) =>
    [...creditSittings.values()].includes(budget)
      ? budget.left + (creditsInFlight.get(budget) ?? 0)
      : budget.dollars
  /** What ElevenLabs takes sent but not finished cost, per sitting. */
  const creditsInFlight = new Map<Budget, number>()
  /**
   * Sittings ended (or replaced) with takes still in flight: what those takes cost stays held
   * until each lands, since ElevenLabs may bill them all the same.
   */
  const landing = new Set<Budget>()
  const landingCredits = () =>
    [...landing].reduce((sum, b) => sum + (creditsInFlight.get(b) ?? 0), 0)

  /**
   * Admits recording `keys` of a planned part: a Fish budget in dollars and an ElevenLabs one in
   * credits, each confirmed in its own unit, or the first problem. `release` gives both back.
   */
  async function admitBoth(
    planned: {
      model: string
      elevenModel: string
      ceilingOf: (keys: string[], takes?: number) => number | null
      creditsOf: (keys: string[], takes?: number) => number
    },
    keys: string[],
    confirmed: { confirmedCost?: number; confirmedCredits?: number },
    takes?: number,
  ): Promise<{ budget: Budget; credits: Budget; release: () => void } | { problem: SpendProblem }> {
    const fish = await admit(planned.model, planned.ceilingOf(keys, takes), confirmed.confirmedCost)
    if ('problem' in fish) return fish
    const eleven = await admitCredits(
      planned.elevenModel,
      planned.creditsOf(keys, takes),
      confirmed.confirmedCredits,
    )
    if ('problem' in eleven) {
      budgets.delete(fish.budget)
      return eleven
    }
    return {
      budget: fish.budget,
      credits: eleven.budget,
      release: () => {
        budgets.delete(fish.budget)
        creditBudgets.delete(eleven.budget)
      },
    }
  }

  /**
   * The budgets of the recordings running now. All they were given is held back from the credit
   * until they end: Fish may bill a request some time after it was charged to its budget.
   */
  const budgets = new Set<Budget>()
  const reserved = (also: Set<Budget> = new Set()) =>
    [...new Set([...budgets, ...also])].reduce((sum, budget) => sum + held(budget), 0)
  /**
   * What a budget holds back from the credit: all a recording was given (Fish may bill it after
   * it was charged), but only what is left of a sitting, which lasts a whole audition: what it
   * spent is already out of the credit Fish reports.
   */
  const held = (budget: Budget) =>
    isSitting(budget) ? budget.left + (inFlight.get(budget) ?? 0) : budget.dollars
  /**
   * Notes `amount` in flight for `budget` in `map` (a take sent, not finished), and gives what
   * takes it off again once the take is done.
   */
  function flightIn(map: Map<Budget, number>, budget: Budget, amount: number): () => void {
    map.set(budget, (map.get(budget) ?? 0) + amount)
    return () => {
      const now = map.get(budget)
      if (now === undefined) return
      const rest = Math.max(now - amount, 0)
      map.set(budget, rest)
      // An ended sitting's last take has landed: nothing of it is held any more.
      if (rest === 0 && landing.delete(budget)) map.delete(budget)
    }
  }
  /** What takes sent but not finished cost, per sitting: Fish's credit may not show it yet. */
  const inFlight = new Map<Budget, number>()
  const isSitting = (budget: Budget) => [...sittings.values()].includes(budget)

  /**
   * The sittings of the auditions going on, by character: what each may still spend on the
   * audition model's paid takes. In memory only, so a sitting ends with the studio. Each one is
   * also in `budgets`, so its money is held back from the credit while it lasts.
   */
  const sittings = new Map<string, Budget>()
  /**
   * The ElevenLabs credits of the same sittings, for board takes of ElevenLabs voices; each is also
   * in `creditBudgets`, so what it has left is held back from the plan while it lasts.
   */
  const creditSittings = new Map<string, Budget>()

  /** What a character's sitting is kept under: its id and the language of the audition it is for. */
  const sittingKey = (characterId: string, request: Request) =>
    cacheNameFor(projectFile, characterId, languageOf(request))

  /**
   * The id a shortlisted voice of ElevenLabs' library is cast as: the voice it became when the
   * studio added it, added now if it was not (once).
   */
  async function saveToAccount(voice: Voice, characterId: string): Promise<string> {
    const id = await voiceToSpeak(
      projectFile,
      async () => {
        const opened = await openProject(projectFile)
        return opened.ok ? elevenFor(dirname(projectFile), opened.project) : null
      },
      voice,
      characterId,
    )
    // It may have taken a voice slot: the board asks for the account afresh.
    shown = null
    return id
  }

  /** The refusal to offer or remove voices while what is in use cannot be read, naming the files. */
  async function unknownUse(): Promise<Response> {
    const opened = await openProject(projectFile)
    const cast = opened.ok ? opened.project.narration.characters : 'The cast'
    return Response.json(
      {
        ok: false,
        reason: 'unknown-use',
        message: `${cast} or a saved audition in ${SESSIONS_DIR} can’t be read, so no ElevenLabs voice is offered for removal. Fix it and try again.`,
      },
      { status: 409 },
    )
  }

  /** Ends a character's sitting: what was left is not kept, and the credit is free again. */
  function endSitting(characterId: string) {
    const budget = sittings.get(characterId)
    if (budget) {
      budgets.delete(budget)
      inFlight.delete(budget)
    }
    sittings.delete(characterId)
    endCredits(characterId)
  }

  /** What a fresh sitting was given: its dollars on a paid model, its credits when asked for. */
  type Given = { dollars?: Budget; credits?: Budget }

  /**
   * Makes `key`'s sitting a fresh one, in place of both halves of any it had: dollars on a paid
   * audition model (`amount`, which it needs), and ElevenLabs credits when `credits` are asked
   * for. Both are admitted before anything is replaced, so a refusal leaves the sitting as it was
   * and holds nothing; the old dollars are held while the new are checked (less than a take, when
   * the old sitting is used up), the old credits are not counted against the new.
   */
  async function freshSitting(
    key: string,
    money: { model: string; eleven: { model: string } },
    { amount, credits }: { amount?: number; credits?: number },
  ): Promise<Given | { problem: SpendProblem }> {
    const given: Given = {}
    const paid = isPaid(money.model, new Date())
    // Nothing to give: a free model's dollars are not a sitting, and an old one is left alone.
    if (!paid && credits === undefined) {
      return {
        problem: {
          reason: 'confirm-credits',
          ceiling: 0,
          message: `Takes with ${money.model} are free; give credits for ElevenLabs voices’ takes.`,
        },
      }
    }
    if (paid) {
      if (amount === undefined) {
        return {
          problem: {
            reason: 'confirm',
            ceiling: 0,
            message: `Takes with ${money.model} are paid; say how much the audition may spend.`,
          },
        }
      }
      const got = await admit(money.model, amount, amount)
      if ('problem' in got) return got
      given.dollars = got.budget
    }
    if (credits !== undefined) {
      const got = await admitCredits(money.eleven.model, credits, credits, creditSittings.get(key))
      if ('problem' in got) {
        if (given.dollars) budgets.delete(given.dollars)
        return got
      }
      given.credits = got.budget
    }
    // After the credit was read, so two at once cannot leave a budget behind.
    endSitting(key)
    if (given.dollars) sittings.set(key, given.dollars)
    if (given.credits) creditSittings.set(key, given.credits)
    return given
  }

  /** Ends the halves `given` gave `key`'s sitting, if they are still its own. */
  function endGiven(key: string, given: Given) {
    if (given.dollars && sittings.get(key) === given.dollars) {
      budgets.delete(given.dollars)
      inFlight.delete(given.dollars)
      sittings.delete(key)
    }
    if (given.credits && creditSittings.get(key) === given.credits) endCredits(key)
  }

  /**
   * Ends a sitting's ElevenLabs credits alone: what was left is free again, but what its takes in
   * flight cost stays held until they land (`landing`).
   */
  function endCredits(characterId: string) {
    const credits = creditSittings.get(characterId)
    if (credits) {
      creditBudgets.delete(credits)
      if (creditsInFlight.get(credits)) landing.add(credits)
      else creditsInFlight.delete(credits)
    }
    creditSittings.delete(characterId)
  }

  /** The money of a character's audition for the page; null for an unknown character. */
  async function sittingView(characterId: string, key: string, language?: string) {
    const money = await auditionMoney(projectFile, characterId, language)
    if (!money || !money.ok) return money
    const paid = isPaid(money.model, new Date())
    const budget = paid ? sittings.get(key) : undefined
    const credits = creditSittings.get(key)
    const view: SittingView = {
      model: money.model,
      paid,
      perTake: money.perTake,
      suggested: paid ? suggestedAmount(money.perTake) : 0,
      spentBefore: money.spentBefore,
      sitting: budget ? sittingMoney(budget.dollars, budget.left, money.perTake) : null,
      eleven: {
        ...money.eleven,
        suggested: suggestedCredits(money.eleven.perTake),
        sitting: credits ? sittingMoney(credits.dollars, credits.left, money.eleven.perTake) : null,
      },
    }
    return { ok: true as const, ...view }
  }

  /** A sitting's answer: its money, or why it was refused (409), or 404 for an unknown character. */
  async function sittingAnswer(
    request: Request,
    characterId: string,
    refused?: SpendProblem | null,
  ) {
    if (refused) return Response.json({ ok: false, ...refused }, { status: 409 })
    const view = await sittingView(
      characterId,
      await sittingKey(characterId, request),
      languageOf(request),
    )
    if (!view) return notFound()
    return Response.json(view, { status: view.ok ? 200 : 409 })
  }

  /** The take checker: the one given (tests), else the process's one Whisper worker. */
  async function transcriberFor(): Promise<Transcriber | null> {
    return transcriber !== undefined ? transcriber : onGpu(sharedWhisper())
  }

  /** What generating a part (or one speaker in it) would do, or why it can't be planned. */
  /** Saves the one field of a character a PATCH changes. */
  function changeCharacter(id: string, change: z.infer<typeof CharacterBody>, language?: string) {
    if ('keywords' in change) return setKeywords(projectFile, id, change.keywords)
    if ('style' in change) return setStyle(projectFile, id, change.style)
    if ('speed' in change) return setSpeed(projectFile, id, change.speed, language)
    return setPhrase(projectFile, id, change.phrase, language)
  }

  async function planFor(
    part: string,
    speaker?: string,
    includeWeak = false,
    asked: 'draft' | 'final' = 'draft',
    language?: string,
  ) {
    const read = await readPart(projectFile, part, language)
    if (!read) return null
    if (!read.ok) return read
    if (read.problems.length) return { ok: false as const, problems: read.problems }
    const { narration } = read.project
    // Without a final step for its voices (one model for both, on each one's provider), the final
    // plan is the draft one.
    const stage: 'draft' | 'final' =
      asked === 'final' &&
      finalStepFor(narration, voicesOf(read.input.lines, read.input.cast.speakers))
        ? 'final'
        : 'draft'
    const { pronounce, speakers } = read.input.cast
    const state = planPart(read.input)
    // A line with an ElevenLabs voice is recorded, and priced, by ElevenLabs.
    const elevenModelOf = (line: { speaker: string }) => {
      const voice = speakers[line.speaker]?.voice ?? ''
      return providerOf(voice) === 'elevenlabs' ? modelForStage(narration, voice, stage) : null
    }
    const pricing = {
      at: new Date(),
      model: narration.models[stage],
      // What is sent: each piece of a line with its cue (for a model that reads cues) and the
      // cast's pronunciations.
      sent: (line: LineState) =>
        sentPieces(
          line,
          elevenModelOf(line) ?? narration.models[stage],
          pronounce,
          narration.quality.chunkLimit,
        ),
      takes: narration.quality.transcriber === 'none' ? 1 : narration.quality.takes,
      elevenModelOf,
    }
    const plan = planGeneration(state, {
      ...pricing,
      speaker,
      checked: narration.quality.transcriber !== 'none',
      includeWeak,
      final: stage === 'final',
    })
    // The most recording these lines can cost, priced as the plan was: Fish's in dollars,
    // ElevenLabs' in credits.
    const ceilingOf = (keys: string[], takes = pricing.takes) =>
      costCeiling(state, keys, { ...pricing, takes })
    const creditsOf = (keys: string[], takes = pricing.takes) =>
      creditCeiling(state, keys, { ...pricing, takes })
    return {
      ok: true as const,
      plan,
      model: pricing.model,
      // The stage's ElevenLabs model, which every ElevenLabs line of the part is recorded with.
      elevenModel: narration.elevenlabs.models[stage],
      ceilingOf,
      creditsOf,
      parallel: narration.quality.parallel,
      stage,
      // Recording is in the source language.
      language: narration.languages[0] ?? 'en',
    }
  }

  /** The paid recordings of this studio: running ones live, finished ones saved. */
  const spendLog = createSpendLog(projectFile)

  /**
   * Runs one request's recording of a single line, following it in the spend log: it counts as one
   * line recorded when the result is a recording, and is saved if it spent anything.
   */
  async function loggedOne<T extends { ok: boolean } | null>(
    planned: { model: string; stage: 'draft' | 'final'; language: string },
    part: string,
    { budget, credits }: { budget: Budget; credits?: Budget },
    run: () => Promise<T>,
  ): Promise<T> {
    const followed = spendLog.follow({
      part,
      ...planned,
      planned: 1,
      budget,
      credits,
      progress: () => ({ lines: 0 }),
    })
    let result: T | undefined
    try {
      result = await run()
      return result
    } finally {
      const recorded = result?.ok === true && !(result && 'skipped' in result)
      await followed.end({ lines: recorded ? 1 : 0, outcome: recorded ? 'done' : 'error' })
    }
  }

  /**
   * Saves one stage's model with `save` (Fish's or ElevenLabs'), from the body's `{ model, was }`:
   * 404 for a stage that is not one, and refused while a part records or a character auditions,
   * naming it, so no recording changes model under its feet.
   */
  async function putStageModel(
    request: Request,
    asked: string,
    path: string,
    save: (projectFile: string, stage: Stage, model: string, was: string) => Promise<ModelsChange>,
  ): Promise<Response> {
    const stage = StageParam.safeParse(asked)
    if (!stage.success) return notFound()
    const body = StageModelBody.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return Response.json({ error: 'expected { model, was }' }, { status: 400 })
    }
    const busy = await busyRefusal(`${path}.${stage.data}`)
    if (busy) return busy
    const result = await save(projectFile, stage.data, body.data.model, body.data.was)
    return Response.json(result, { status: result.ok ? 200 : 409 })
  }

  /**
   * The refusal of a save at `path` while a part records or a character auditions, naming it, so
   * no recording changes what it records with under its feet; null when nothing is going on.
   */
  async function busyRefusal(path: string): Promise<Response | null> {
    const busy = await busyNow()
    if (!busy) return null
    return Response.json(
      {
        ok: false,
        problems: [{ file: basename(projectFile), path, message: `${busy.name} is ${busy.kind}` }],
      },
      { status: 409 },
    )
  }

  /** Only requests addressed to the studio itself reach `handler`. */
  const guard =
    <R extends Request>(handler: (request: R) => Response | Promise<Response>) =>
    (request: R) =>
      hosts().includes(request.headers.get('host')?.toLowerCase() ?? '')
        ? handler(request)
        : forbidden('requests must be addressed to the studio itself')

  /** Only changes sent by the studio's own page reach `handler`. A browser sends Origin with every POST. */
  const fromOwnPage = <R extends Request>(handler: (request: R) => Promise<Response>) =>
    guard((request: R) =>
      hosts()
        .map((host) => `http://${host}`)
        .includes(request.headers.get('origin') ?? '')
        ? handler(request)
        : forbidden('changes are only accepted from the studio itself'),
    )

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    // Recording a line or a batch of takes can take well over Bun's default 10 s; never cut it off.
    idleTimeout: 0,
    // Cloning a voice sends up to 20 recordings, which pass Bun's default 128 MiB as WAV.
    maxRequestBodySize: 1024 * 1024 * 1024,
    development: development ? { hmr: true, console: true } : false,
    routes: {
      '/': index,
      '/api/project': {
        GET: guard(async () => Response.json(await loadProject(projectFile))),
      },
      '/api/parts/:part': {
        GET: guard(async (request) => {
          const result = await loadPart(projectFile, request.params.part, languageOf(request))
          return result ? Response.json(result) : notFound()
        }),
      },
      '/api/parts/:part/adopt': {
        POST: fromOwnPage(async (request) => {
          const result = await adoptPart(
            projectFile,
            request.params.part,
            new Date(),
            languageOf(request),
          )
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/lines/:key/heard': {
        GET: guard(async (request) => {
          const result = await heardFor(
            projectFile,
            request.params.part,
            request.params.key,
            languageOf(request),
          )
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/lines/:key/note': {
        PATCH: fromOwnPage(async (request) => {
          const body = NoteBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { note }' }, { status: 400 })
          const { part, key } = request.params
          const result = await setNote(projectFile, part, key, body.data.note, languageOf(request))
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/lines/:key/check': {
        POST: fromOwnPage(async (request) => {
          const { part, key } = request.params
          const transcriber = await transcriberFor()
          const result = await measureLine(projectFile, part, key, {
            transcriber,
            again: true,
            language: languageOf(request),
          })
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/lines/:key/accept': {
        POST: fromOwnPage(async (request) => {
          const result = await acceptLine(
            projectFile,
            request.params.part,
            request.params.key,
            languageOf(request),
          )
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/lines/:key/record': {
        POST: fromOwnPage(async (request) => {
          const { part, key } = request.params
          const text = await request.text()
          const body = RecordBody.safeParse(parseOrNull(text || '{}'))
          if (!body.success) {
            return Response.json({ error: 'expected { confirmedCost?, stage? }' }, { status: 400 })
          }
          // Fails closed: without a plan, nothing is priced, so nothing is recorded.
          const planned = await planFor(part, undefined, true, body.data.stage, languageOf(request))
          if (!planned) return notFound()
          if (!planned.ok) return Response.json(planned, { status: 409 })
          const admitted = await admitBoth(planned, [key], body.data)
          if ('problem' in admitted) {
            return Response.json({ ok: false, ...admitted.problem }, { status: 409 })
          }
          try {
            const result = await whileGoing('part', part, () =>
              loggedOne(planned, part, admitted, async () =>
                recordLine(projectFile, part, key, fishFor, {
                  encode,
                  limiter: fishWork,
                  elevenLimiter: elevenWork,
                  elevenlabs: elevenFor,
                  transcriber: await transcriberFor(),
                  stage: body.data.stage,
                  budget: admitted.budget,
                  credits: admitted.credits,
                  language: languageOf(request),
                }),
              ),
            )
            if (!result) return notFound()
            return Response.json(result, { status: result.ok ? 200 : 409 })
          } finally {
            admitted.release()
          }
        }),
      },
      '/api/parts/:part/plan': {
        GET: guard(async (request) => {
          const query = new URL(request.url).searchParams
          const speaker = query.get('speaker') || undefined
          const stage = query.get('stage') === 'final' ? 'final' : 'draft'
          const plan = await planFor(
            request.params.part,
            speaker,
            query.get('weak') === '1',
            stage,
            languageOf(request),
          )
          if (!plan) return notFound()
          if (!plan.ok || !plan.plan.eleven) return Response.json(plan)
          // What the plan has left, beside what its ElevenLabs lines take and what running
          // recordings and auditions hold.
          return Response.json({
            ...plan,
            elevenAccount: await shownAccount(),
            elevenHeld: elevenHeld(),
          })
        }),
      },
      '/api/parts/:part/jobs': {
        POST: fromOwnPage(async (request) => {
          const body = JobBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json(
              {
                error:
                  'expected { kind, stage, speaker, keys, orphans, retakeWeak, confirmedCost, confirmedCredits }',
              },
              { status: 400 },
            )
          }
          const { part } = request.params
          const { retakeWeak } = body.data
          const { stage } = body.data
          const language = await languageFor(request)
          const planned = await planFor(
            part,
            body.data.speaker ?? undefined,
            retakeWeak,
            stage,
            language,
          )
          if (!planned) return notFound()
          if (!planned.ok) return Response.json(planned, { status: 409 })
          const { plan, parallel } = planned
          const shownKeys = new Set(body.data.keys)
          const shownOrphans = new Set(body.data.orphans)
          const { kind } = body.data
          // Measuring and checking again use Whisper alone: no new audio, nothing spent.
          const measuring = kind !== 'record'
          const offered = { record: plan.keys, measure: plan.unmeasured, check: plan.recheck }[kind]
          const keys = offered.filter((key) => shownKeys.has(key))
          const orphans = measuring ? [] : plan.orphans.filter((key) => shownOrphans.has(key))
          if (!keys.length && !orphans.length) {
            return Response.json({ error: 'There is nothing to do.' }, { status: 409 })
          }
          const admitted = measuring
            ? {
                budget: createBudget({ model: planned.model, dollars: 0 }),
                credits: createBudget({ model: planned.elevenModel, dollars: 0 }),
                release: () => undefined,
              }
            : await admitBoth(planned, keys, body.data)
          if ('problem' in admitted) {
            const { problem } = admitted
            return Response.json({ error: problem.message, ...problem }, { status: 409 })
          }
          const { budget, credits, release } = admitted
          // Checked with no await before the job starts, so a refresh cannot slip in between.
          if (isRefreshing(projectFile, part)) {
            release()
            return Response.json(
              { error: 'The dialog is being refreshed; generate when it is done.' },
              { status: 409 },
            )
          }
          // Set once the job has started; `onEnd` only runs after the job's first await, so it is set.
          let jobId = ''
          const progress = () => {
            const state = jobs.get(jobId)
            return { lines: state ? state.done - state.skipped - state.failed.length : 0 }
          }
          const followed = measuring
            ? null
            : spendLog.follow({
                part,
                ...planned,
                planned: keys.length,
                budget,
                credits,
                progress,
              })
          const job = jobs.start({
            kind: body.data.kind,
            part,
            language,
            speaker: body.data.speaker,
            keys,
            orphans,
            parallel,
            record: async (key) =>
              measuring
                ? measureLine(projectFile, part, key, {
                    transcriber: await transcriberFor(),
                    again: kind === 'check',
                    onlyIfNeeded: true,
                    language,
                  })
                : recordLine(projectFile, part, key, fishFor, {
                    encode,
                    limiter: fishWork,
                    elevenLimiter: elevenWork,
                    elevenlabs: elevenFor,
                    onlyIfNeeded: true,
                    retakeWeak,
                    stage,
                    budget,
                    credits,
                    transcriber: await transcriberFor(),
                    language,
                  }),
            removeOrphans: (keys) => removeOrphans(projectFile, part, keys, language),
            onEnd: () => {
              release()
              const state = jobs.get(jobId)
              if (!followed || !state || state.status === 'running') return
              void followed.end({
                lines: progress().lines,
                outcome: outcomeOf({
                  status: state.status === 'done' ? 'done' : 'cancelled',
                  failed: state.failed.length,
                }),
              })
            },
          })
          // Not started (another job runs for the part): nothing is held back for it.
          if ('error' in job) {
            release()
            void followed?.end({ lines: 0, outcome: 'error' })
          } else jobId = job.id
          return Response.json(job, { status: 'error' in job ? 409 : 200 })
        }),
      },
      '/api/parts/:part/jobs/latest': {
        GET: guard(async (request) =>
          Response.json(jobs.latest(request.params.part, await languageFor(request))),
        ),
      },
      '/api/jobs/:id': {
        GET: guard((request) => {
          const job = jobs.get(request.params.id)
          return job ? Response.json(job) : notFound()
        }),
        DELETE: fromOwnPage(async (request) => {
          const job = jobs.cancel(request.params.id)
          return job ? Response.json(job) : notFound()
        }),
      },
      '/api/parts/:part/clips/:file': {
        GET: guard(async (request) => {
          const file = await clipFile(
            projectFile,
            request.params.part,
            request.params.file,
            languageOf(request),
          )
          return file ? new Response(Bun.file(file)) : notFound()
        }),
      },
      '/api/characters/:id': {
        PATCH: fromOwnPage(async (request) => {
          const body = CharacterBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json(
              {
                error:
                  'expected { keywords: string[] }, { phrase: string | null }, { style: string } or { speed: number | null }',
              },
              { status: 400 },
            )
          }
          const { id } = request.params
          const result = await changeCharacter(id, body.data, languageOf(request))
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/refresh': {
        POST: fromOwnPage(async (request) => {
          // A job reads the dialog as it records: refreshing under it would fail its lines.
          if (jobs.running(request.params.part)) {
            const message = 'A generation is running for this part; refresh when it is done.'
            return Response.json({ ok: false, reason: 'busy', message }, { status: 409 })
          }
          const result = await refreshDialog(projectFile, request.params.part)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/images/:id': {
        PATCH: fromOwnPage(async (request) => {
          const body = WordsBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { words: string | null }' }, { status: 400 })
          }
          return imageAnswer(await setImageWords(projectFile, request.params.id, body.data.words))
        }),
      },
      '/api/images/:id/compare': {
        POST: fromOwnPage(async (request) => {
          const body = CompareBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: "expected { choice: 'keep' | 'game' }" }, { status: 400 })
          }
          return imageAnswer(
            await resolveImageCompare(projectFile, request.params.id, body.data.choice),
          )
        }),
      },
      '/api/images/making': {
        GET: guard(async () => Response.json(await imageTakes.making(projectFile))),
      },
      '/api/images/:id/takes': {
        GET: guard(async (request) => {
          const view = await imageTakes.view(projectFile, request.params.id)
          return view ? Response.json(view) : notFound()
        }),
        POST: fromOwnPage(async (request) => {
          const body = MakeImageTakesBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { count } or { retry }' }, { status: 400 })
          }
          return imageAnswer(await imageTakes.make(projectFile, request.params.id, body.data))
        }),
      },
      '/api/images/:id/takes/:n': {
        GET: guard(async (request) => {
          const file = await imageTakes.takeFile(projectFile, request.params.id, request.params.n)
          return file ? new Response(Bun.file(file)) : notFound()
        }),
        DELETE: fromOwnPage(async (request) =>
          imageAnswer(
            await imageTakes.drop(projectFile, request.params.id, Number(request.params.n)),
          ),
        ),
      },
      '/api/images/:id/takes/:n/seen': {
        POST: fromOwnPage(async (request) =>
          imageAnswer(
            await imageTakes.markSeen(projectFile, request.params.id, Number(request.params.n)),
          ),
        ),
      },
      '/api/images/:id/choose': {
        POST: fromOwnPage(async (request) => {
          const body = ChooseImageTakeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { n }' }, { status: 400 })
          return imageAnswer(await imageTakes.choose(projectFile, request.params.id, body.data.n))
        }),
      },
      '/api/images/:id/unchoose': {
        POST: fromOwnPage(async (request) =>
          imageAnswer(await imageTakes.unchoose(projectFile, request.params.id)),
        ),
      },
      '/api/images/:id/stop': {
        POST: fromOwnPage(async (request) => {
          const result = await imageTakes.stop(projectFile, request.params.id)
          return result ? Response.json(result) : notFound()
        }),
      },
      '/api/images/:id/current': {
        GET: guard(async (request) => {
          const file = await imageTakes.currentFile(projectFile, request.params.id)
          return file ? new Response(Bun.file(file)) : notFound()
        }),
      },
      '/api/image-style': {
        PATCH: fromOwnPage(async (request) => {
          const body = StyleFieldBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json(
              { error: 'expected { look: string | null } or { keepOut: string | null }' },
              { status: 400 },
            )
          }
          const [field, text] = Object.entries(body.data)[0] as ['look' | 'keepOut', string | null]
          return imageAnswer(await setStyleField(projectFile, field, text))
        }),
      },
      '/api/image-style/seen': {
        POST: fromOwnPage(async () => imageAnswer(await markStyleSeen(projectFile))),
      },
      '/api/music/stingers/refresh': {
        POST: fromOwnPage(async () => {
          const result = await refreshShared(projectFile)
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/music/tracks/:id': {
        PATCH: fromOwnPage(async (request) => {
          const body = BriefChangeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json(
              { error: 'expected one of { brief }, { seconds }, { bpm } or { key }' },
              { status: 400 },
            )
          }
          const result = await setTrackBrief(projectFile, request.params.id, body.data)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/music/tracks/:id/takes': {
        GET: guard(async (request) => {
          const view = await musicTakes.view(projectFile, request.params.id)
          return view ? Response.json(view) : notFound()
        }),
        POST: fromOwnPage(async (request) => {
          const body = MakeTakesBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { count } or { retry }' }, { status: 400 })
          }
          const result = await musicTakes.make(projectFile, request.params.id, body.data)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/music/tracks/:id/takes/:file': {
        GET: guard(async (request) => {
          const file = await musicTakes.takeFile(
            projectFile,
            request.params.id,
            request.params.file,
          )
          if (!file) return notFound()
          // `?seam=1`: the take's last seconds and then its first, to hear the loop come round.
          if (new URL(request.url).searchParams.get('seam') !== '1') {
            return new Response(Bun.file(file))
          }
          const wav = readWav(new Uint8Array(await Bun.file(file).arrayBuffer()))
          return new Response(writeWav(seamWav(wav)) as Uint8Array<ArrayBuffer>, {
            headers: { 'content-type': 'audio/wav' },
          })
        }),
        DELETE: fromOwnPage(async (request) => {
          const result = await musicTakes.drop(projectFile, request.params.id, request.params.file)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/music/tracks/:id/choose': {
        POST: fromOwnPage(async (request) => {
          const body = ChooseTakeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { file }' }, { status: 400 })
          const result = await musicTakes.choose(projectFile, request.params.id, body.data.file)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/music/tracks/:id/move': {
        POST: fromOwnPage(async (request) => {
          const body = MoveTakeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { file, to }' }, { status: 400 })
          }
          const result = await musicTakes.move(
            projectFile,
            request.params.id,
            body.data.file,
            body.data.to,
          )
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/music/tracks/:id/unchoose': {
        POST: fromOwnPage(async (request) => {
          const result = await musicTakes.unchoose(projectFile, request.params.id)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/music/tracks/:id/remove': {
        POST: fromOwnPage(async (request) => {
          const result = await removeOrphan(projectFile, request.params.id)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/music/clips/:file': {
        GET: guard(async (request) => {
          const file = await musicClipFile(projectFile, request.params.file)
          return file ? new Response(Bun.file(file)) : notFound()
        }),
      },
      '/api/music/tracks/:id/current': {
        GET: guard(async (request) => {
          const file = await musicCurrentFile(projectFile, request.params.id)
          return file ? new Response(Bun.file(file)) : notFound()
        }),
      },
      '/api/music/tracks/:id/stop': {
        POST: fromOwnPage(async (request) => {
          const result = await musicTakes.stop(projectFile, request.params.id)
          return result ? Response.json(result) : notFound()
        }),
      },
      '/api/music/making': {
        GET: guard(async () => Response.json(await musicTakes.making(projectFile))),
      },
      '/api/parts/:part/cues/:key/move': {
        POST: fromOwnPage(async (request) => {
          const body = MoveCueBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { to }' }, { status: 400 })
          const { part, key } = request.params
          const result = await moveCue(projectFile, part, key, body.data.to, languageOf(request))
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/spending': {
        GET: guard(async () => {
          const [project, saved] = await Promise.all([
            loadProject(projectFile),
            readSpending(projectFile),
          ])
          if (!saved.ok) return Response.json({ ok: false, problems: saved.problems })
          // The acts, and the stingers once a stinger take cost something: a take's list is one.
          const stingers = saved.music.some((take) => take.part === 'stingers')
          const parts = project.ok
            ? [
                ...project.summary.parts.map((p) => ({ id: p.id, title: p.title })),
                ...(stingers ? [{ id: 'stingers', title: 'Stingers' }] : []),
              ]
            : []
          return Response.json({
            ok: true,
            ...summariseSpending(
              saved.recordings,
              spendLog.running(),
              parts,
              saved.music,
              saved.tries,
            ),
            languages: project.ok ? project.summary.languages.length : 1,
          })
        }),
      },
      '/api/credit': {
        GET: guard(async () => Response.json(await creditOf())),
      },
      '/api/setup': {
        GET: guard(async () =>
          Response.json(
            await checkSetup(
              projectFile,
              creditOf,
              undefined,
              undefined,
              undefined,
              elevenAccountOf,
              (model) => imageGenerator.installed(model),
            ),
          ),
        ),
      },
      '/api/changes': {
        GET: guard(async () => Response.json(await gitChanges(projectFile))),
      },
      '/api/pronounce': {
        PATCH: fromOwnPage(async (request) => {
          const body = PronounceBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { table, was }' }, { status: 400 })
          }
          const result = await setPronunciations(
            projectFile,
            body.data.table,
            body.data.was,
            languageOf(request),
          )
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/sound-alike': {
        PATCH: fromOwnPage(async (request) => {
          const body = SoundAlikeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { groups, was }' }, { status: 400 })
          }
          const result = await setSoundAlike(
            projectFile,
            body.data.groups,
            body.data.was,
            languageOf(request),
          )
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/fish-tier': {
        PATCH: fromOwnPage(async (request) => {
          const body = FishTierBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { tier }' }, { status: 400 })
          }
          const result = await setFishTier(projectFile, body.data.tier)
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/take-fade': {
        PATCH: fromOwnPage(async (request) => {
          const body = TakeFadeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { seconds }' }, { status: 400 })
          }
          const result = await setTakeFade(projectFile, body.data.seconds)
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/models': {
        GET: guard(async () => {
          const view = await modelsView(projectFile, musicGenerator.installed, imageGenerator)
          return Response.json(view.ok ? { ...view, busy: await busyNow() } : view)
        }),
        PATCH: fromOwnPage(async (request) => {
          const body = ModelsBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { takes }' }, { status: 400 })
          }
          const result = await switchRetiredModels(projectFile, body.data.takes)
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/music/model': {
        PUT: fromOwnPage(async (request) => {
          const body = StageModelBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { model, was }' }, { status: 400 })
          }
          const result = await setMusicModel(projectFile, body.data.model, body.data.was)
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/image-model': {
        PUT: fromOwnPage(async (request) => {
          const body = StageModelBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { model, was }' }, { status: 400 })
          }
          const result = await setImageModel(projectFile, body.data.model, body.data.was)
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/models/:stage': {
        PUT: fromOwnPage((request) =>
          putStageModel(request, request.params.stage, 'narration.models', setStageModel),
        ),
      },
      '/api/models/elevenlabs/:stage': {
        PUT: fromOwnPage((request) =>
          putStageModel(
            request,
            request.params.stage,
            'narration.elevenlabs.models',
            setElevenModel,
          ),
        ),
      },
      // The plan's account and what running recordings and auditions hold of it, for the board.
      '/api/elevenlabs/account': {
        GET: guard(async () =>
          Response.json({ account: await shownAccount(), held: elevenHeld() }),
        ),
      },
      '/api/elevenlabs/voices/freeable': {
        // The voices the studio added from the library that nothing uses: their slots can be freed.
        GET: guard(async () => {
          const added = await readAddedVoices(projectFile)
          // Nothing the studio added: nothing to offer, whatever can be read.
          if (!added.added.length) return Response.json({ ok: true, voices: [] })
          const used = await voicesInUse(projectFile)
          if (!used) return unknownUse()
          const voices = freeableVoices(added, used)
          return Response.json({
            ok: true,
            voices: voices.map(({ voice, name, character }) => ({ voice, name, character })),
          })
        }),
      },
      '/api/elevenlabs/voices/free': {
        POST: fromOwnPage(async (request) => {
          const body = FreeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { voices }' }, { status: 400 })
          const used = await voicesInUse(projectFile)
          if (!used) return unknownUse()
          const result = await freeVoices(
            projectFile,
            async () => {
              const opened = await openProject(projectFile)
              return opened.ok ? elevenFor(dirname(projectFile), opened.project) : null
            },
            body.data.voices,
            used,
          )
          // Slots were freed: the board asks for the account afresh, and a take or cast of a
          // voice removed adds it again.
          shown = null
          if (result.ok) await voicesRemoved(projectFile, result.libraries)
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/elevenlabs/tts': {
        PUT: fromOwnPage(async (request) => {
          const body = ElevenTtsBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { tts, was }' }, { status: 400 })
          }
          const busy = await busyRefusal('narration.elevenlabs.tts')
          if (busy) return busy
          const result = await setElevenSettings(projectFile, body.data.tts, body.data.was)
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/lines/:key/takes': {
        GET: guard(async (request) => {
          const { part, key } = request.params
          const result = await listLineTakes(projectFile, part, key, languageOf(request))
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
        POST: fromOwnPage(async (request) => {
          const { part, key } = request.params
          const text = await request.text()
          const body = TakeLineBody.safeParse(parseOrNull(text || '{}'))
          if (!body.success) {
            return Response.json({ error: 'expected { confirmedCost? }' }, { status: 400 })
          }
          // Fails closed, as recording does: a take is priced for one request per piece.
          const planned = await planFor(part, undefined, false, 'draft', languageOf(request))
          if (!planned) return notFound()
          if (!planned.ok) return Response.json(planned, { status: 409 })
          const admitted = await admitBoth(planned, [key], body.data, 1)
          if ('problem' in admitted) {
            return Response.json({ ok: false, ...admitted.problem }, { status: 409 })
          }
          try {
            const result = await whileGoing('part', part, () =>
              loggedOne(planned, part, admitted, async () =>
                takeLine(projectFile, part, key, fishFor, {
                  limiter: fishWork,
                  elevenLimiter: elevenWork,
                  transcriber: await transcriberFor(),
                  budget: admitted.budget,
                  credits: admitted.credits,
                  language: languageOf(request),
                  elevenlabs: elevenFor,
                }),
              ),
            )
            if (!result) return notFound()
            return Response.json(result, { status: result.ok ? 200 : 409 })
          } finally {
            admitted.release()
          }
        }),
      },
      '/api/parts/:part/lines/:key/takes/:file': {
        GET: guard(async (request) => {
          const { part, key, file } = request.params
          const id = /^([0-9a-f]{16})\.wav$/.exec(file)?.[1]
          const found = id
            ? await lineTakeFile(projectFile, part, key, id, languageOf(request))
            : null
          return found ? new Response(Bun.file(found)) : notFound()
        }),
        DELETE: fromOwnPage(async (request) => {
          const { part, key, file } = request.params
          if (!/^[0-9a-f]{16}$/.test(file)) return notFound()
          const result = await dropLineTake(projectFile, part, key, file, languageOf(request))
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/lines/:key/takes/:id/use': {
        POST: fromOwnPage(async (request) => {
          const { part, key, id } = request.params
          if (!/^[0-9a-f]{16}$/.test(id)) return notFound()
          const result = await useLineTake(projectFile, part, key, id, {
            encode,
            language: languageOf(request),
          })
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/lines/:key/try': {
        POST: fromOwnPage(async (request) => {
          const body = TryBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { cue }' }, { status: 400 })
          const { part, key } = request.params
          const result = await whileGoing('part', part, () =>
            tryLine(
              projectFile,
              part,
              key,
              body.data.cue,
              fishFor,
              fishWork,
              languageOf(request),
              body.data.at,
              { elevenlabs: elevenFor, elevenLimiter: elevenWork },
            ),
          )
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/cues/:key/inside': {
        PATCH: fromOwnPage(async (request) => {
          const body = InsideCueBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { at, cue, text }' }, { status: 400 })
          }
          const { part, key } = request.params
          const result = await setInsideCue(projectFile, part, key, body.data, languageOf(request))
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/cues/:key': {
        PATCH: fromOwnPage(async (request) => {
          const body = CueBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { cue }' }, { status: 400 })
          const { part, key } = request.params
          const result = await setCue(projectFile, part, key, body.data.cue, languageOf(request))
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/scene-cues': {
        PATCH: fromOwnPage(async (request) => {
          const body = SceneCueBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { scene, cue }' }, { status: 400 })
          }
          const { scene, cue } = body.data
          const result = await setSceneCue(
            projectFile,
            request.params.part,
            scene,
            cue,
            languageOf(request),
          )
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/scene-cues/move': {
        POST: fromOwnPage(async (request) => {
          const body = MoveSceneCueBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { from, to }' }, { status: 400 })
          }
          const { from, to } = body.data
          const result = await moveSceneCue(
            projectFile,
            request.params.part,
            from,
            to,
            languageOf(request),
          )
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/characters/:id/takes': {
        POST: fromOwnPage(async (request) => {
          const body = AuditionTakeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { voice, board? }' }, { status: 400 })
          }
          const { id } = request.params
          const { voice, board } = body.data
          const sitting = await sittingKey(id, request)
          const budget = board ? sittings.get(sitting) : undefined
          // An ElevenLabs voice's board take is paid from the sitting's credits instead.
          const credits =
            board && providerOf(voice) === 'elevenlabs' ? creditSittings.get(sitting) : undefined
          // A voice of ElevenLabs' library is added to the user's voices at its first take.
          const onBoard = credits
            ? await boardVoice(projectFile, id, voice, languageOf(request))
            : undefined
          const result = await whileGoing('character', id, () =>
            recordTake(
              projectFile,
              id,
              voice,
              fishFor,
              fishWork,
              {
                board,
                budget,
                open: () => budget !== undefined && sittings.get(sitting) === budget,
                flight: (dollars) =>
                  budget ? flightIn(inFlight, budget, dollars) : () => undefined,
                charged: async (dollars) =>
                  void (await recordSpent(projectFile, id, dollars, languageOf(request))),
                elevenlabs: elevenFor,
                elevenLimiter: elevenWork,
                ...(onBoard?.library && {
                  speakAs: async (client: ElevenLabsClient) => {
                    const spoken = await voiceToSpeak(projectFile, async () => client, onBoard, id)
                    await voiceAdded(projectFile, id, voice, languageOf(request))
                    // It may have taken a voice slot: the board asks for the account afresh.
                    shown = null
                    return spoken
                  },
                }),
                ...(credits && {
                  credits,
                  open: () => creditSittings.get(sitting) === credits,
                  flight: (spent: number) => flightIn(creditsInFlight, credits, spent),
                }),
              },
              languageOf(request),
            ),
          )
          if (!result) return notFound()
          return Response.json(result, { status: 'problems' in result ? 409 : 200 })
        }),
      },
      '/api/auditions/:id': {
        GET: guard(async (request) => {
          const { id } = request.params
          const language = languageOf(request)
          const result = await sessionFor(projectFile, id, language)
          return result
            ? Response.json(await viewOf(projectFile, id, result, { language }))
            : notFound()
        }),
        DELETE: fromOwnPage(async (request) => {
          const { id } = request.params
          const language = languageOf(request)
          const discarded = await discardSession(projectFile, id, language)
          if (!discarded) return notFound()
          if (discarded !== true) return Response.json(discarded, { status: 409 })
          endSitting(await sittingKey(id, request))
          return Response.json(
            await viewOf(projectFile, id, { ok: true, session: null }, { language }),
          )
        }),
      },
      '/api/auditions/:id/start': {
        POST: fromOwnPage(async (request) => {
          const body = StartBody.safeParse(await request.json().catch(() => ({})))
          if (!body.success)
            return Response.json(
              { error: 'expected { spendUpTo?, creditsUpTo? }' },
              { status: 400 },
            )
          const { id } = request.params
          const money = await auditionMoney(projectFile, id, languageOf(request))
          if (!money) return notFound()
          if (!money.ok) return Response.json(money, { status: 409 })
          // A paid audition model starts with a sitting: no amount, no audition. Credits for
          // ElevenLabs voices' takes are the sitting's other half, given when asked for.
          const key = await sittingKey(id, request)
          const { spendUpTo, creditsUpTo } = body.data
          let given: Given = {}
          if (isPaid(money.model, new Date()) || creditsUpTo !== undefined) {
            const fresh = await freshSitting(key, money, {
              amount: spendUpTo,
              credits: creditsUpTo,
            })
            if ('problem' in fresh) return sittingAnswer(request, id, fresh.problem)
            given = fresh
          }
          const started = await whileGoing('character', id, () =>
            startAudition(projectFile, id, fishFor, languageOf(request), elevenFor),
          )
          // An audition that did not start has no sitting: this start's, not one set since.
          if (!started?.ok) endGiven(key, given)
          return answer(id, Promise.resolve(started), { language: languageOf(request) })
        }),
      },
      '/api/auditions/:id/sitting': {
        GET: guard((request) => sittingAnswer(request, request.params.id)),
        POST: fromOwnPage(async (request) => {
          const body = AmountBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { amount?, credits? }' }, { status: 400 })
          }
          const { id } = request.params
          const money = await auditionMoney(projectFile, id, languageOf(request))
          if (!money) return notFound()
          if (!money.ok) return Response.json(money, { status: 409 })
          const fresh = await freshSitting(await sittingKey(id, request), money, body.data)
          if ('problem' in fresh) return sittingAnswer(request, id, fresh.problem)
          return sittingAnswer(request, id)
        }),
        DELETE: fromOwnPage(async (request) => {
          endSitting(await sittingKey(request.params.id, request))
          return sittingAnswer(request, request.params.id)
        }),
      },
      '/api/auditions/:id/sitting/add': {
        POST: fromOwnPage(async (request) => {
          const body = AddBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { amount } or { credits }' }, { status: 400 })
          }
          const { id } = request.params
          const key = await sittingKey(id, request)
          if ('credits' in body.data) {
            const more = body.data.credits
            const credits = creditSittings.get(key)
            if (credits) {
              const problem = await holdCredits(more, () => credits.add(more))
              return sittingAnswer(request, id, problem)
            }
            // None yet: the board gives the sitting its credits, beside any dollars it has.
            const money = await auditionMoney(projectFile, id, languageOf(request))
            if (!money) return notFound()
            if (!money.ok) return Response.json(money, { status: 409 })
            if (!money.going) {
              return sittingAnswer(request, id, {
                reason: 'confirm-credits',
                ceiling: 0,
                message: 'There is no audition to give credits to; start one.',
              })
            }
            const got = await admitCredits(money.eleven.model, more, more)
            if ('problem' in got) return sittingAnswer(request, id, got.problem)
            // Two at once: the first given stays, and the second holds nothing.
            if (creditSittings.has(key)) creditBudgets.delete(got.budget)
            else creditSittings.set(key, got.budget)
            return sittingAnswer(request, id)
          }
          const budget = sittings.get(key)
          if (!budget) {
            return sittingAnswer(request, id, {
              reason: 'confirm',
              ceiling: 0,
              message: 'There is no sitting to add to; resume the audition.',
            })
          }
          const heldWhenAsked = new Set(budgets)
          const credit = await creditOf()
          const free = credit.ok ? credit.credit - reserved(heldWhenAsked) : null
          const { amount } = body.data
          const problem = spendProblem({ ceiling: amount, confirmed: amount, credit: free })
          if (problem) return sittingAnswer(request, id, problem)
          budget.add(amount)
          return sittingAnswer(request, id)
        }),
      },
      '/api/auditions/:id/own': {
        POST: fromOwnPage((request) =>
          answer(
            request.params.id,
            refreshOwnVoices(projectFile, request.params.id, fishFor, languageOf(request)),
            { language: languageOf(request) },
          ),
        ),
      },
      '/api/auditions/:id/move': {
        POST: fromOwnPage(async (request) => {
          const body = MoveBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json(
              { error: "expected { voice, move: 'shortlist' | 'unlist' | 'drop' }" },
              { status: 400 },
            )
          }
          const { voice, move } = body.data
          const { id } = request.params
          const language = languageOf(request)
          return answer(id, moveVoice(projectFile, id, voice, move, language), {
            recorded: false,
            language,
          })
        }),
      },
      '/api/auditions/:id/undo': {
        POST: fromOwnPage((request) =>
          answer(
            request.params.id,
            undoLastDrop(projectFile, request.params.id, languageOf(request)),
            { recorded: false, language: languageOf(request) },
          ),
        ),
      },
      '/api/auditions/:id/more': {
        POST: fromOwnPage(async (request) => {
          // No body is Fish's library, as before there was a choice.
          const text = await request.text()
          const body = MoreBody.safeParse(
            text ? await Promise.try(() => JSON.parse(text)).catch(() => null) : {},
          )
          if (!body.success) {
            return Response.json({ error: 'expected { provider? }' }, { status: 400 })
          }
          const { provider } = body.data
          return answer(
            request.params.id,
            whileGoing('character', request.params.id, () =>
              moreVoices(projectFile, request.params.id, fishFor, languageOf(request), {
                provider,
                elevenFor,
              }),
            ),
            { language: languageOf(request) },
          )
        }),
      },
      '/api/auditions/:id/add': {
        POST: fromOwnPage(async (request) => {
          const body = VoiceBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { voice }' }, { status: 400 })
          const { id } = request.params
          const language = languageOf(request)
          return answer(
            id,
            whileGoing('character', id, () =>
              addVoiceById(projectFile, id, body.data.voice, fishFor, language, elevenFor),
            ),
            {
              language,
            },
          )
        }),
      },
      '/api/characters/:id/clone-voice': {
        POST: fromOwnPage(async (request) => {
          const form = await request.formData().catch(() => null)
          const title = form?.get('title')
          if (!form || typeof title !== 'string') {
            return Response.json(
              { error: 'expected a form with title and voices' },
              { status: 400 },
            )
          }
          const voices = form.getAll('voices').filter((v): v is File => v instanceof File)
          const files = await Promise.all(
            voices.map(async (v) => ({
              name: v.name,
              type: v.type || 'application/octet-stream',
              bytes: new Uint8Array(await v.arrayBuffer()),
            })),
          )
          const result = await cloneVoice(projectFile, request.params.id, { title, files }, fishFor)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/characters/:id/designs': {
        GET: guard(async (request) => {
          const result = await designsFor(projectFile, request.params.id, languageOf(request))
          if (!result) return notFound()
          if (!result.ok) return Response.json(result, { status: 409 })
          // What a design with ElevenLabs would say and cost, for its confirm.
          const plan = await elevenDesignFor(projectFile, request.params.id, languageOf(request))
          return Response.json({
            ...result,
            eleven: plan?.ok ? { text: plan.text, credits: plan.credits } : null,
          })
        }),
      },
      '/api/characters/:id/design': {
        POST: fromOwnPage(async (request) => {
          const body = DesignBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { description, spendUpTo? }' }, { status: 400 })
          }
          const { id } = request.params
          if ((await designsFor(projectFile, id, languageOf(request))) === null) return notFound()
          if (body.data.provider === 'elevenlabs') {
            // A description ElevenLabs would refuse costs no account read and holds nothing.
            const state = elevenDescriptionState(body.data.description)
            if (!state.canSend) {
              const message =
                state.tooLong ?? 'Describe the voice you want in 20 characters or more.'
              return Response.json({ ok: false, reason: 'invalid', message }, { status: 409 })
            }
            const plan = await elevenDesignFor(projectFile, id, languageOf(request))
            if (!plan) return notFound()
            if (!plan.ok) return Response.json(plan, { status: 409 })
            // Held back from the plan while ElevenLabs designs, as the credits confirmed.
            const got = await admitCredits(ELEVEN_DESIGN_MODEL, plan.credits, body.data.creditsUpTo)
            if ('problem' in got) {
              return Response.json({ ok: false, ...got.problem }, { status: 409 })
            }
            try {
              const result = await designElevenVoices(
                projectFile,
                id,
                body.data.description,
                elevenFor,
                languageOf(request),
                undefined,
                // The text whose credits were confirmed and held, not one made again since.
                { text: plan.text },
              )
              if (!result) return notFound()
              return Response.json(result, { status: 'added' in result ? 200 : 409 })
            } finally {
              creditBudgets.delete(got.budget)
            }
          }
          // Held back from the credit while Fish designs; Fish bills a request that works.
          const got = await admit(DESIGN_MODEL, DESIGN_PRICE, body.data.spendUpTo)
          if ('problem' in got) return Response.json({ ok: false, ...got.problem }, { status: 409 })
          try {
            const result = await designVoices(
              projectFile,
              id,
              body.data.description,
              fishFor,
              encode,
              languageOf(request),
            )
            if (!result) return notFound()
            return Response.json(result, { status: 'added' in result ? 200 : 409 })
          } finally {
            budgets.delete(got.budget)
          }
        }),
      },
      '/api/characters/:id/cast-voice': {
        POST: fromOwnPage(async (request) => {
          const body = CastOwnBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { voice, name }' }, { status: 400 })
          }
          const { voice, name } = body.data
          const result = await castOwnVoice(
            projectFile,
            request.params.id,
            { id: voice, name },
            languageOf(request),
          )
          if (!result) return notFound()
          if (result.ok) endSitting(await sittingKey(request.params.id, request))
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/auditions/:id/cast': {
        POST: fromOwnPage(async (request) => {
          const body = VoiceBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { voice }' }, { status: 400 })
          const { voice } = body.data
          const language = languageOf(request)
          // A designed voice is saved to the account first; Fish makes no voice from a design.
          const result = isDesignId(voice)
            ? await castDesign(projectFile, request.params.id, voice, fishFor, language, elevenFor)
            : await castVoice(projectFile, request.params.id, voice, language, (shown) =>
                saveToAccount(shown, request.params.id),
              )
          if (!result) return notFound()
          if (result.ok) endSitting(await sittingKey(request.params.id, request))
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/characters/:id/ruled-out': {
        GET: guard(async (request) =>
          ruledOut(ruledOutVoices(projectFile, request.params.id, languageOf(request))),
        ),
        DELETE: fromOwnPage((request) =>
          ruledOut(allowVoices(projectFile, request.params.id, 'all', languageOf(request))),
        ),
      },
      '/api/characters/:id/ruled-out/:voice': {
        DELETE: fromOwnPage(async (request) => {
          const { id, voice } = request.params
          if (!VOICE_ID.test(voice))
            return Response.json({ error: 'not a voice id' }, { status: 400 })
          return ruledOut(allowVoices(projectFile, id, [voice], languageOf(request)))
        }),
      },
      '/api/takes/:file': {
        GET: guard(async (request) => {
          const key = /^([0-9a-f]{16})\.mp3$/.exec(request.params.file)?.[1]
          const file = key ? await takeFile(projectFile, key) : null
          if (!file) return notFound()
          // Fish's takes are MP3; ElevenLabs' are WAV, kept under the same name.
          const head = new Uint8Array(await Bun.file(file).slice(0, 4).arrayBuffer())
          const wav = String.fromCharCode(...head) === 'RIFF'
          return new Response(
            Bun.file(file),
            wav ? { headers: { 'content-type': 'audio/wav' } } : undefined,
          )
        }),
      },
      '/api/characters/:id/voice': {
        GET: guard(async (request) => {
          const result = await characterVoice(
            projectFile,
            request.params.id,
            fishFor,
            languageOf(request),
            elevenFor,
          )
          return result ? Response.json(result) : notFound()
        }),
      },
      '/api/*': guard(notFound),
    },
    fetch: () => new Response('Not found', { status: 404 }),
    error: (error) => {
      console.error(error)
      return Response.json({ error: error.message }, { status: 500 })
    },
  })

  function hosts(): string[] {
    return allowedHosts(server.port!)
  }

  return server
}

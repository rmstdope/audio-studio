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
import { costCeiling, planGeneration } from '../core/generation'
import type { LineState } from '../core/planner'
import { BriefChangeBody } from '../core/music'
import { ChooseTakeBody, MakeTakesBody, seamWav } from '../core/musicTake'
import { readWav, writeWav } from '../core/wav'
import { FishTierSchema } from '../core/project'
import { isPaid, sittingMoney, suggestedAmount, type SittingView } from '../core/sitting'
import { createBudget, spendProblem, type Budget, type SpendProblem } from '../core/spend'
import { planPart } from '../core/planner'
import { SPEED } from '../core/resources'
import { spokenPieces } from '../core/spoken'
import { createJobs } from '../services/jobs'
import { createSpendLog, readSpending } from '../services/spending'
import { outcomeOf, summariseSpending } from '../core/spending'
import { moveCue, setCue } from '../services/cues'
import { gitChanges } from '../services/git'
import { setTrackBrief } from '../services/briefs'
import { isRefreshing, refreshDialog, refreshShared } from '../services/refresh'
import { acceptLine, measureLine, recordLine, removeOrphans } from '../services/narration'
import { setStageModel, switchRetiredModels } from '../services/models'
import { modelsView } from '../services/modelsView'
import type { Busy } from '../core/models'
import { setFishTier } from '../services/fishTier'
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
import { castDesign, designVoices, designsFor } from '../services/designs'
import { allowVoices, ruledOutVoices, type RuledOutResult } from '../services/ruledOut'
import {
  addVoiceById,
  auditionMoney,
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
  type SessionResult,
} from '../services/sessions'
import { fishFromEnv, NO_KEY, type CreditResult, type FishClient } from '../services/fish'
import { heardFor } from '../services/heard'
import { onGpu } from '../services/gpu'
import { createAceStepWorker, type MusicGenerator } from '../services/music'
import { createFakeMusic } from '../services/musicFake'
import { removeOrphan } from '../services/musicOrphans'
import { createMusicTakes } from '../services/musicTakes'
import { createWhisperWorker, type Transcriber } from '../services/transcriber'
import { declaredLanguage } from '../core/project'
import {
  adoptPart,
  cacheNameFor,
  clipFile,
  musicClipFile,
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
}

/**
 * The process's one Whisper worker, kept across `--dev` reloads (which rerun this module) so a
 * reload never leaves a worker and its model behind. It starts on its first take and exits when
 * the studio does.
 */
function sharedWhisper(): Transcriber {
  const state = globalThis as { audioStudioWhisper?: Transcriber }
  state.audioStudioWhisper ??= createWhisperWorker()
  return state.audioStudioWhisper
}

/**
 * The process's one ACE-Step worker, kept across `--dev` reloads like Whisper's. It starts with
 * the first take and exits when the studio does. `AUDIO_STUDIO_FAKE_MUSIC=1` swaps it for a
 * stand-in that makes tones, for working on the pages.
 */
function sharedMusic(): MusicGenerator {
  const state = globalThis as { audioStudioMusic?: MusicGenerator }
  state.audioStudioMusic ??=
    process.env.AUDIO_STUDIO_FAKE_MUSIC === '1' ? createFakeMusic() : createAceStepWorker()
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

/** The model the page chose for a stage, and the one it showed. */
const StageModelBody = z.object({ model: z.string().min(1), was: z.string().min(1) }).strict()

/** Where an orphaned cue goes: a line key, or null to remove it. */
const MoveCueBody = z.object({ to: z.string().min(1).max(200).nullable() }).strict()

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

/** Taking a line again: the most the user agreed to spend on the take, for a paid draft model. */
const TakeLineBody = z.object({ confirmedCost: z.number().nonnegative().optional() }).strict()

/** Recording one line: the most the user agreed to spend on it, for a paid model. */
const RecordBody = z
  .object({
    confirmedCost: z.number().nonnegative().optional(),
    /** Record with the final model (a final clip recorded again), or the draft one (default). */
    stage: z.enum(['draft', 'final']).default('draft'),
  })
  .strict()

/** What a Fish voice id may look like: letters, digits, `_` and `-`. */
const VOICE_ID = /^[\w-]{1,64}$/

const MoveBody = z.object({
  voice: z.string().regex(VOICE_ID),
  move: z.enum(['shortlist', 'unlist', 'drop']),
})

const TakeBody = z.object({ voice: z.string().regex(VOICE_ID) })

/** A take to record: for the board (the audition model, paid from the sitting) or the cast voice's page (free). */
const AuditionTakeBody = TakeBody.extend({ board: z.boolean().default(false) })

/** What a sitting may spend: dollars, from the box. */
const AmountBody = z.object({ amount: z.number().positive().max(10_000) }).strict()

/** Starting an audition; a paid audition model needs the amount its sitting may spend. */
const StartBody = z.object({ spendUpTo: z.number().positive().max(10_000).optional() }).strict()
/** Designing voices: the description, and the most the user agreed to spend on the design. */
const DesignBody = z
  .object({ description: z.string(), spendUpTo: z.number().positive().max(10_000).optional() })
  .strict()
/** What casting a voice made from recordings sends: the voice and the name to cast it under. */
const CastOwnBody = z.object({ voice: z.string().regex(VOICE_ID), name: z.string().trim().min(1) })

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
}: ServerOptions) {
  const musicTakes = createMusicTakes({
    generator: music ?? sharedMusic(),
    ...(encode ? { encode } : {}),
  })
  /** The Fish client: the one given (tests), else made from the project's API key on every use. */
  const fishFor: FishFactory = fish !== undefined ? async () => fish : fishFromEnv
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
  /** What takes sent but not finished cost, per sitting: Fish's credit may not show it yet. */
  const inFlight = new Map<Budget, number>()
  const isSitting = (budget: Budget) => [...sittings.values()].includes(budget)

  /**
   * The sittings of the auditions going on, by character: what each may still spend on the
   * audition model's paid takes. In memory only, so a sitting ends with the studio. Each one is
   * also in `budgets`, so its money is held back from the credit while it lasts.
   */
  const sittings = new Map<string, Budget>()

  /** What a character's sitting is kept under: its id and the language of the audition it is for. */
  const sittingKey = (characterId: string, request: Request) =>
    cacheNameFor(projectFile, characterId, languageOf(request))

  /** Ends a character's sitting: what was left is not kept, and the credit is free again. */
  function endSitting(characterId: string) {
    const budget = sittings.get(characterId)
    if (budget) {
      budgets.delete(budget)
      inFlight.delete(budget)
    }
    sittings.delete(characterId)
  }

  /** The money of a character's audition for the page; null for an unknown character. */
  async function sittingView(characterId: string, key: string, language?: string) {
    const money = await auditionMoney(projectFile, characterId, language)
    if (!money || !money.ok) return money
    const paid = isPaid(money.model, new Date())
    const budget = paid ? sittings.get(key) : undefined
    const view: SittingView = {
      model: money.model,
      paid,
      perTake: money.perTake,
      suggested: paid ? suggestedAmount(money.perTake) : 0,
      spentBefore: money.spentBefore,
      sitting: budget ? sittingMoney(budget.dollars, budget.left, money.perTake) : null,
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
    // With one model for both, there is no final step: the final plan is the draft one.
    const stage: 'draft' | 'final' =
      asked === 'final' && narration.models.final !== narration.models.draft ? 'final' : 'draft'
    const { pronounce } = read.input.cast
    const state = planPart(read.input)
    const pricing = {
      at: new Date(),
      model: narration.models[stage],
      // What is sent: each piece of a line with its cue and the cast's pronunciations.
      sent: (line: LineState) =>
        spokenPieces(line.text, line.cue, pronounce, narration.quality.chunkLimit),
      takes: narration.quality.transcriber === 'none' ? 1 : narration.quality.takes,
    }
    const plan = planGeneration(state, {
      ...pricing,
      speaker,
      checked: narration.quality.transcriber !== 'none',
      includeWeak,
      final: stage === 'final',
    })
    // The most recording these lines can cost, priced as the plan was.
    const ceilingOf = (keys: string[], takes = pricing.takes) =>
      costCeiling(state, keys, { ...pricing, takes })
    return {
      ok: true as const,
      plan,
      model: pricing.model,
      ceilingOf,
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
    budget: Budget,
    run: () => Promise<T>,
  ): Promise<T> {
    const followed = spendLog.follow({
      part,
      ...planned,
      planned: 1,
      budget,
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
          const admitted = await admit(
            planned.model,
            planned.ceilingOf([key]),
            body.data.confirmedCost,
          )
          if ('problem' in admitted) {
            return Response.json({ ok: false, ...admitted.problem }, { status: 409 })
          }
          try {
            const result = await whileGoing('part', part, () =>
              loggedOne(planned, part, admitted.budget, async () =>
                recordLine(projectFile, part, key, fishFor, {
                  encode,
                  limiter: fishWork,
                  transcriber: await transcriberFor(),
                  stage: body.data.stage,
                  budget: admitted.budget,
                  language: languageOf(request),
                }),
              ),
            )
            if (!result) return notFound()
            return Response.json(result, { status: result.ok ? 200 : 409 })
          } finally {
            budgets.delete(admitted.budget)
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
          return plan ? Response.json(plan) : notFound()
        }),
      },
      '/api/parts/:part/jobs': {
        POST: fromOwnPage(async (request) => {
          const body = JobBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json(
              {
                error:
                  'expected { kind, stage, speaker, keys, orphans, retakeWeak, confirmedCost }',
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
            ? { budget: createBudget({ model: planned.model, dollars: 0 }) }
            : await admit(planned.model, planned.ceilingOf(keys), body.data.confirmedCost)
          if ('problem' in admitted) {
            const { problem } = admitted
            return Response.json({ error: problem.message, ...problem }, { status: 409 })
          }
          const { budget } = admitted
          // Checked with no await before the job starts, so a refresh cannot slip in between.
          if (isRefreshing(projectFile, part)) {
            budgets.delete(budget)
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
                    onlyIfNeeded: true,
                    retakeWeak,
                    stage,
                    budget,
                    transcriber: await transcriberFor(),
                    language,
                  }),
            removeOrphans: (keys) => removeOrphans(projectFile, part, keys, language),
            onEnd: () => {
              budgets.delete(budget)
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
            budgets.delete(budget)
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
          const parts = project.ok
            ? project.summary.parts.map((p) => ({ id: p.id, title: p.title }))
            : []
          return Response.json({
            ok: true,
            ...summariseSpending(saved.recordings, spendLog.running(), parts),
            languages: project.ok ? project.summary.languages.length : 1,
          })
        }),
      },
      '/api/credit': {
        GET: guard(async () => Response.json(await creditOf())),
      },
      '/api/setup': {
        GET: guard(async () => Response.json(await checkSetup(projectFile, creditOf))),
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
      '/api/models': {
        GET: guard(async () => {
          const view = await modelsView(projectFile)
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
      '/api/models/:stage': {
        PUT: fromOwnPage(async (request) => {
          const stage = StageParam.safeParse(request.params.stage)
          if (!stage.success) return notFound()
          const body = StageModelBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { model, was }' }, { status: 400 })
          }
          const busy = await busyNow()
          if (busy) {
            return Response.json(
              {
                ok: false,
                problems: [
                  {
                    file: basename(projectFile),
                    path: `narration.models.${stage.data}`,
                    message: `${busy.name} is ${busy.kind}`,
                  },
                ],
              },
              { status: 409 },
            )
          }
          const result = await setStageModel(
            projectFile,
            stage.data,
            body.data.model,
            body.data.was,
          )
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
          const admitted = await admit(
            planned.model,
            planned.ceilingOf([key], 1),
            body.data.confirmedCost,
          )
          if ('problem' in admitted) {
            return Response.json({ ok: false, ...admitted.problem }, { status: 409 })
          }
          try {
            const result = await whileGoing('part', part, () =>
              loggedOne(planned, part, admitted.budget, async () =>
                takeLine(projectFile, part, key, fishFor, {
                  limiter: fishWork,
                  transcriber: await transcriberFor(),
                  budget: admitted.budget,
                  language: languageOf(request),
                }),
              ),
            )
            if (!result) return notFound()
            return Response.json(result, { status: result.ok ? 200 : 409 })
          } finally {
            budgets.delete(admitted.budget)
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
          const body = CueBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { cue }' }, { status: 400 })
          const { part, key } = request.params
          const result = await whileGoing('part', part, () =>
            tryLine(projectFile, part, key, body.data.cue, fishFor, fishWork, languageOf(request)),
          )
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
                flight: (dollars) => {
                  if (!budget) return () => undefined
                  inFlight.set(budget, (inFlight.get(budget) ?? 0) + dollars)
                  return () => {
                    const now = inFlight.get(budget)
                    if (now !== undefined) inFlight.set(budget, Math.max(now - dollars, 0))
                  }
                },
                charged: async (dollars) =>
                  void (await recordSpent(projectFile, id, dollars, languageOf(request))),
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
            return Response.json({ error: 'expected { spendUpTo? }' }, { status: 400 })
          const { id } = request.params
          const money = await auditionMoney(projectFile, id, languageOf(request))
          if (!money) return notFound()
          if (!money.ok) return Response.json(money, { status: 409 })
          // A paid audition model starts with a sitting: no amount, no audition.
          const paid = isPaid(money.model, new Date())
          let admitted: Budget | null = null
          if (paid) {
            const { spendUpTo } = body.data
            if (spendUpTo === undefined) {
              return sittingAnswer(request, id, {
                reason: 'confirm',
                ceiling: 0,
                message: `Takes with ${money.model} are paid; say how much the audition may spend.`,
              })
            }
            const got = await admit(money.model, spendUpTo, spendUpTo)
            if ('problem' in got) return sittingAnswer(request, id, got.problem)
            admitted = got.budget
            // After the credit was read, so two starts at once cannot leave a budget behind.
            endSitting(await sittingKey(id, request))
            sittings.set(await sittingKey(id, request), admitted)
          }
          const started = await whileGoing('character', id, () =>
            startAudition(projectFile, id, fishFor, languageOf(request)),
          )
          // An audition that did not start has no sitting.
          if (admitted && !started?.ok) endSitting(await sittingKey(id, request))
          return answer(id, Promise.resolve(started), { language: languageOf(request) })
        }),
      },
      '/api/auditions/:id/sitting': {
        GET: guard((request) => sittingAnswer(request, request.params.id)),
        POST: fromOwnPage(async (request) => {
          const body = AmountBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { amount }' }, { status: 400 })
          const { id } = request.params
          const money = await auditionMoney(projectFile, id, languageOf(request))
          if (!money) return notFound()
          if (!money.ok) return Response.json(money, { status: 409 })
          if (isPaid(money.model, new Date())) {
            const got = await admit(money.model, body.data.amount, body.data.amount)
            if ('problem' in got) return sittingAnswer(request, id, got.problem)
            // Resuming is a fresh sitting; what the last one had left is not kept. It was held
            // while the new amount was checked, which is less than one take (a used-up sitting).
            endSitting(await sittingKey(id, request))
            sittings.set(await sittingKey(id, request), got.budget)
          }
          return sittingAnswer(request, id)
        }),
        DELETE: fromOwnPage(async (request) => {
          endSitting(await sittingKey(request.params.id, request))
          return sittingAnswer(request, request.params.id)
        }),
      },
      '/api/auditions/:id/sitting/add': {
        POST: fromOwnPage(async (request) => {
          const body = AmountBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { amount }' }, { status: 400 })
          const { id } = request.params
          const budget = sittings.get(await sittingKey(id, request))
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
          const problem = spendProblem({
            ceiling: body.data.amount,
            confirmed: body.data.amount,
            credit: free,
          })
          if (problem) return sittingAnswer(request, id, problem)
          budget.add(body.data.amount)
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
        POST: fromOwnPage((request) =>
          answer(
            request.params.id,
            whileGoing('character', request.params.id, () =>
              moreVoices(projectFile, request.params.id, fishFor, languageOf(request)),
            ),
            { language: languageOf(request) },
          ),
        ),
      },
      '/api/auditions/:id/add': {
        POST: fromOwnPage(async (request) => {
          const body = TakeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { voice }' }, { status: 400 })
          const { id } = request.params
          const language = languageOf(request)
          return answer(
            id,
            whileGoing('character', id, () =>
              addVoiceById(projectFile, id, body.data.voice, fishFor, language),
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
          return Response.json(result, { status: result.ok ? 200 : 409 })
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
          const body = TakeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { voice }' }, { status: 400 })
          const { voice } = body.data
          const language = languageOf(request)
          // A designed voice is saved to the account first; Fish makes no voice from a design.
          const result = isDesignId(voice)
            ? await castDesign(projectFile, request.params.id, voice, fishFor, language)
            : await castVoice(projectFile, request.params.id, voice, language)
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
          return file ? new Response(Bun.file(file)) : notFound()
        }),
      },
      '/api/characters/:id/voice': {
        GET: guard(async (request) => {
          const result = await characterVoice(
            projectFile,
            request.params.id,
            fishFor,
            languageOf(request),
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

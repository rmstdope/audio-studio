import { dirname } from 'node:path'
import { z } from 'zod'
import {
  findCandidates,
  setKeywords,
  setPhrase,
  setPronunciations,
  setStyle,
  type FishFactory,
} from '../services/auditions'
import type { Encoder } from '../services/audio'
import { createLimiter } from '../services/limit'
import { costCeiling, planGeneration } from '../core/generation'
import type { LineState } from '../core/planner'
import { createBudget, spendProblem, type Budget, type SpendProblem } from '../core/spend'
import { planPart } from '../core/planner'
import { spokenPieces } from '../core/spoken'
import { createJobs } from '../services/jobs'
import { moveCue, setCue } from '../services/cues'
import { gitChanges } from '../services/git'
import { isRefreshing, refreshDialog } from '../services/refresh'
import { measureLine, recordLine, removeOrphans } from '../services/narration'
import { auditionTakes, recordTake, takeFile } from '../services/takes'
import { nextRound, setVerdict } from '../core/audition'
import {
  addVoiceById,
  castFinalist,
  changeSession,
  discardSession,
  moreVoices,
  sessionFor,
  startAudition,
  viewOf,
  type SessionResult,
} from '../services/sessions'
import { fishFromEnv, NO_KEY, type CreditResult, type FishClient } from '../services/fish'
import { createWhisperWorker, type Transcriber } from '../services/transcriber'
import {
  adoptPart,
  clipFile,
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

/** A change to a character: its keywords, or its own audition phrase (null for the standard one). */
const CharacterBody = z.union([
  z.object({ keywords: z.array(z.string()).max(20) }).strict(),
  z.object({ phrase: z.string().max(10_000).nullable() }).strict(),
  z.object({ style: z.string().max(1_000) }).strict(),
])

/** The whole pronunciation table, and the one the page showed (to refuse a stale page). */
const Table = z.array(z.tuple([z.string().max(1_000), z.string().max(1_000)])).max(2_000)
const PronounceBody = z.object({ table: Table, was: Table }).strict()

/** Where an orphaned cue goes: a line key, or null to remove it. */
const MoveCueBody = z.object({ to: z.string().min(1).max(200).nullable() }).strict()

/** A line's own cue; empty to go back to the character's style. */
const CueBody = z.object({ cue: z.string().max(1_000) }).strict()

/**
 * A generation to start: the scope, and the lines and orphans the page showed. Only those, and
 * only as far as they are still in the server's own fresh plan, are recorded or removed.
 */
const JobBody = z
  .object({
    /** Record lines (default), or measure clips with Whisper without new audio. */
    kind: z.enum(['record', 'measure']).default('record'),
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

/** Recording one line: the most the user agreed to spend on it, for a paid model. */
const RecordBody = z.object({ confirmedCost: z.number().nonnegative().optional() }).strict()

const VerdictBody = z.object({
  voice: z.string().regex(/^[\w-]{1,64}$/),
  verdict: z.enum(['keep', 'drop']).nullable(),
})

const TakeBody = z.object({ voice: z.string().regex(/^[\w-]{1,64}$/) })

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
}: ServerOptions) {
  /** The Fish client: the one given (tests), else made from the project's API key on every use. */
  const fishFor: FishFactory = fish !== undefined ? async () => fish : fishFromEnv
  /** A session action's answer: the session as the page shows it; 404 for an unknown character. */
  async function answer(
    characterId: string,
    pending: Promise<SessionResult>,
    options: { recorded?: boolean } = {},
  ): Promise<Response> {
    const result = await pending
    if (!result) return notFound()
    const view = await viewOf(projectFile, characterId, result, options)
    return Response.json(view, { status: view.ok ? 200 : 409 })
  }

  /** Fish TTS requests (audition takes and lines alike): `quality.parallel` at a time, each once. */
  const fishWork = createLimiter()
  /** Generation jobs, one per part at a time. */
  const jobs = createJobs()

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
    [...new Set([...budgets, ...also])].reduce((sum, budget) => sum + budget.dollars, 0)

  /** The take checker: the one given (tests), else the process's one Whisper worker. */
  async function transcriberFor(): Promise<Transcriber | null> {
    return transcriber !== undefined ? transcriber : sharedWhisper()
  }

  /** What generating a part (or one speaker in it) would do, or why it can't be planned. */
  /** Saves the one field of a character a PATCH changes. */
  function changeCharacter(id: string, change: z.infer<typeof CharacterBody>) {
    if ('keywords' in change) return setKeywords(projectFile, id, change.keywords)
    if ('style' in change) return setStyle(projectFile, id, change.style)
    return setPhrase(projectFile, id, change.phrase)
  }

  async function planFor(
    part: string,
    speaker?: string,
    includeWeak = false,
    stage: 'draft' | 'final' = 'draft',
  ) {
    const read = await readPart(projectFile, part)
    if (!read) return null
    if (!read.ok) return read
    if (read.problems.length) return { ok: false as const, problems: read.problems }
    const { narration } = read.project
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
    const ceilingOf = (keys: string[]) => costCeiling(state, keys, pricing)
    return {
      ok: true as const,
      plan,
      model: pricing.model,
      ceilingOf,
      parallel: narration.quality.parallel,
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
    development: development ? { hmr: true, console: true } : false,
    routes: {
      '/': index,
      '/api/project': {
        GET: guard(async () => Response.json(await loadProject(projectFile))),
      },
      '/api/parts/:part': {
        GET: guard(async (request) => {
          const result = await loadPart(projectFile, request.params.part)
          return result ? Response.json(result) : notFound()
        }),
      },
      '/api/parts/:part/adopt': {
        POST: fromOwnPage(async (request) => {
          const result = await adoptPart(projectFile, request.params.part)
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
            return Response.json({ error: 'expected { confirmedCost? }' }, { status: 400 })
          }
          // Fails closed: without a plan, nothing is priced, so nothing is recorded.
          const planned = await planFor(part, undefined, true)
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
            const result = await recordLine(projectFile, part, key, fishFor, {
              encode,
              limiter: fishWork,
              transcriber: await transcriberFor(),
              budget: admitted.budget,
            })
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
          const plan = await planFor(request.params.part, speaker, query.get('weak') === '1', stage)
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
          const planned = await planFor(part, body.data.speaker ?? undefined, retakeWeak, stage)
          if (!planned) return notFound()
          if (!planned.ok) return Response.json(planned, { status: 409 })
          const { plan, parallel } = planned
          const shownKeys = new Set(body.data.keys)
          const shownOrphans = new Set(body.data.orphans)
          const measuring = body.data.kind === 'measure'
          const keys = (measuring ? plan.unmeasured : plan.keys).filter((key) => shownKeys.has(key))
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
          const job = jobs.start({
            kind: body.data.kind,
            part,
            speaker: body.data.speaker,
            keys,
            orphans,
            parallel,
            record: async (key) =>
              measuring
                ? measureLine(projectFile, part, key, { transcriber: await transcriberFor() })
                : recordLine(projectFile, part, key, fishFor, {
                    encode,
                    limiter: fishWork,
                    onlyIfNeeded: true,
                    retakeWeak,
                    stage,
                    budget,
                    transcriber: await transcriberFor(),
                  }),
            removeOrphans: (keys) => removeOrphans(projectFile, part, keys),
            onEnd: () => budgets.delete(budget),
          })
          // Not started (another job runs for the part): nothing is held back for it.
          if ('error' in job) budgets.delete(budget)
          return Response.json(job, { status: 'error' in job ? 409 : 200 })
        }),
      },
      '/api/parts/:part/jobs/latest': {
        GET: guard((request) => Response.json(jobs.latest(request.params.part))),
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
          const file = await clipFile(projectFile, request.params.part, request.params.file)
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
                  'expected { keywords: string[] }, { phrase: string | null } or { style: string }',
              },
              { status: 400 },
            )
          }
          const { id } = request.params
          const result = await changeCharacter(id, body.data)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/refresh': {
        POST: fromOwnPage(async (request) => {
          // A job reads the dialog as it records: refreshing under it would fail its lines.
          const job = jobs.latest(request.params.part)
          if (job && (job.status === 'running' || job.status === 'cancelling')) {
            const message = 'A generation is running for this part; refresh when it is done.'
            return Response.json({ ok: false, reason: 'busy', message }, { status: 409 })
          }
          const result = await refreshDialog(projectFile, request.params.part)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/cues/:key/move': {
        POST: fromOwnPage(async (request) => {
          const body = MoveCueBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { to }' }, { status: 400 })
          const { part, key } = request.params
          const result = await moveCue(projectFile, part, key, body.data.to)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/credit': {
        GET: guard(async () => Response.json(await creditOf())),
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
          const result = await setPronunciations(projectFile, body.data.table, body.data.was)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/cues/:key': {
        PATCH: fromOwnPage(async (request) => {
          const body = CueBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { cue }' }, { status: 400 })
          const { part, key } = request.params
          const result = await setCue(projectFile, part, key, body.data.cue)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/characters/:id/takes': {
        POST: fromOwnPage(async (request) => {
          const body = TakeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { voice }' }, { status: 400 })
          const { id } = request.params
          const result = await recordTake(projectFile, id, body.data.voice, fishFor, fishWork)
          if (!result) return notFound()
          return Response.json(result, { status: 'problems' in result ? 409 : 200 })
        }),
      },
      '/api/characters/:id/audition': {
        GET: guard(async (request) => {
          const voices = (new URL(request.url).searchParams.get('voices') ?? '')
            .split(',')
            .filter((voice) => /^[\w-]{1,64}$/.test(voice))
            .slice(0, 50)
          const result = await auditionTakes(projectFile, request.params.id, voices)
          return result ? Response.json(result) : notFound()
        }),
      },
      '/api/auditions/:id': {
        GET: guard(async (request) => {
          const { id } = request.params
          const result = await sessionFor(projectFile, id)
          return result ? Response.json(await viewOf(projectFile, id, result)) : notFound()
        }),
        DELETE: fromOwnPage(async (request) => {
          const { id } = request.params
          const discarded = await discardSession(projectFile, id)
          if (!discarded) return notFound()
          if (discarded !== true) return Response.json(discarded, { status: 409 })
          return Response.json(await viewOf(projectFile, id, { ok: true, session: null }))
        }),
      },
      '/api/auditions/:id/start': {
        POST: fromOwnPage((request) =>
          answer(request.params.id, startAudition(projectFile, request.params.id, fishFor)),
        ),
      },
      '/api/auditions/:id/verdict': {
        POST: fromOwnPage(async (request) => {
          const body = VerdictBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json(
              { error: "expected { voice, verdict: 'keep' | 'drop' | null }" },
              { status: 400 },
            )
          }
          const { voice, verdict } = body.data
          const { id } = request.params
          return answer(
            id,
            changeSession(projectFile, id, (s) => setVerdict(s, voice, verdict)),
          )
        }),
      },
      '/api/auditions/:id/next': {
        POST: fromOwnPage((request) =>
          answer(request.params.id, changeSession(projectFile, request.params.id, nextRound), {
            recorded: false,
          }),
        ),
      },
      '/api/auditions/:id/more': {
        POST: fromOwnPage((request) =>
          answer(request.params.id, moreVoices(projectFile, request.params.id, fishFor)),
        ),
      },
      '/api/auditions/:id/add': {
        POST: fromOwnPage(async (request) => {
          const body = TakeBody.safeParse(await request.json().catch(() => null))
          if (!body.success) return Response.json({ error: 'expected { voice }' }, { status: 400 })
          const { id } = request.params
          return answer(id, addVoiceById(projectFile, id, body.data.voice, fishFor))
        }),
      },
      '/api/auditions/:id/cast': {
        POST: fromOwnPage(async (request) => {
          const result = await castFinalist(projectFile, request.params.id)
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/takes/:file': {
        GET: guard(async (request) => {
          const key = /^([0-9a-f]{16})\.mp3$/.exec(request.params.file)?.[1]
          const file = key ? await takeFile(projectFile, key) : null
          return file ? new Response(Bun.file(file)) : notFound()
        }),
      },
      '/api/characters/:id/candidates': {
        GET: guard(async (request) => {
          const result = await findCandidates(projectFile, request.params.id, fishFor)
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

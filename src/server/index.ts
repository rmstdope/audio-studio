import { z } from 'zod'
import {
  findCandidates,
  setKeywords,
  setPhrase,
  setStyle,
  type FishFactory,
} from '../services/auditions'
import type { Encoder } from '../services/audio'
import { createLimiter } from '../services/limit'
import { planGeneration } from '../core/generation'
import { planPart } from '../core/planner'
import { spokenPieces } from '../core/spoken'
import { createJobs } from '../services/jobs'
import { setCue } from '../services/cues'
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
import { fishFromEnv, type FishClient } from '../services/fish'
import { createWhisperWorker, type Transcriber } from '../services/transcriber'
import { adoptPart, clipFile, loadPart, loadProject, readPart } from '../services/workspace'
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
    /** Retake the weak lines among `keys` (only when the user ticked it). */
    retakeWeak: z.boolean().default(false),
    speaker: z.string().min(1).max(200).nullable(),
    keys: z.array(z.string()).max(100_000),
    orphans: z.array(z.string()).max(100_000),
  })
  .strict()

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

  /** The take checker: the one given (tests), else the process's one Whisper worker. */
  async function transcriberFor(): Promise<Transcriber | null> {
    return transcriber !== undefined ? transcriber : sharedWhisper()
  }

  /** What generating a part (or one speaker in it) would do, or why it can't be planned. */
  async function planFor(part: string, speaker?: string, includeWeak = false) {
    const read = await readPart(projectFile, part)
    if (!read) return null
    if (!read.ok) return read
    if (read.problems.length) return { ok: false as const, problems: read.problems }
    const { narration } = read.project
    const { pronounce } = read.input.cast
    const plan = planGeneration(planPart(read.input), {
      model: narration.models.draft,
      speaker,
      // What is sent: each piece of a line with its cue and the cast's pronunciations.
      sent: (line) => spokenPieces(line.text, line.cue, pronounce, narration.quality.chunkLimit),
      takes: narration.quality.transcriber === 'none' ? 1 : narration.quality.takes,
      checked: narration.quality.transcriber !== 'none',
      includeWeak,
    })
    return { ok: true as const, plan, parallel: narration.quality.parallel }
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
          const result = await recordLine(projectFile, part, key, fishFor, {
            encode,
            limiter: fishWork,
            transcriber: await transcriberFor(),
          })
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/plan': {
        GET: guard(async (request) => {
          const query = new URL(request.url).searchParams
          const speaker = query.get('speaker') || undefined
          const plan = await planFor(request.params.part, speaker, query.get('weak') === '1')
          return plan ? Response.json(plan) : notFound()
        }),
      },
      '/api/parts/:part/jobs': {
        POST: fromOwnPage(async (request) => {
          const body = JobBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json(
              { error: 'expected { kind, speaker, keys, orphans, retakeWeak }' },
              { status: 400 },
            )
          }
          const { part } = request.params
          const { retakeWeak } = body.data
          const planned = await planFor(part, body.data.speaker ?? undefined, retakeWeak)
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
                    transcriber: await transcriberFor(),
                  }),
            removeOrphans: (keys) => removeOrphans(projectFile, part, keys),
          })
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
          const change = body.data
          const result =
            'keywords' in change
              ? await setKeywords(projectFile, id, change.keywords)
              : 'style' in change
                ? await setStyle(projectFile, id, change.style)
                : await setPhrase(projectFile, id, change.phrase)
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

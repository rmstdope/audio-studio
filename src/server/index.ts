import { z } from 'zod'
import { findCandidates, setKeywords, setPhrase, type FishFactory } from '../services/auditions'
import type { Encoder } from '../services/audio'
import { createLimiter } from '../services/limit'
import { planGeneration } from '../core/generation'
import { createJobs } from '../services/jobs'
import { recordLine, removeOrphans } from '../services/narration'
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
import { adoptPart, clipFile, loadPart, loadProject, openProject } from '../services/workspace'
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
}

/** A change to a character: its keywords, or its own audition phrase (null for the standard one). */
const CharacterBody = z.union([
  z.object({ keywords: z.array(z.string()).max(20) }).strict(),
  z.object({ phrase: z.string().max(10_000).nullable() }).strict(),
])

const JobBody = z.object({
  speaker: z.string().min(1).nullable(),
  removeOrphans: z.boolean(),
})

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

  /** What generating a part (or one speaker in it) would do, or why it can't be planned. */
  async function planFor(part: string, speaker?: string) {
    const loaded = await loadPart(projectFile, part)
    if (!loaded) return null
    if (!loaded.ok) return loaded
    if (loaded.part.problems.length) return { ok: false as const, problems: loaded.part.problems }
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { narration } = opened.project
    const plan = planGeneration(loaded.part, { model: narration.models.draft, speaker })
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
          })
          if (!result) return notFound()
          return Response.json(result, { status: result.ok ? 200 : 409 })
        }),
      },
      '/api/parts/:part/plan': {
        GET: guard(async (request) => {
          const speaker = new URL(request.url).searchParams.get('speaker') || undefined
          const plan = await planFor(request.params.part, speaker)
          return plan ? Response.json(plan) : notFound()
        }),
      },
      '/api/parts/:part/jobs': {
        POST: fromOwnPage(async (request) => {
          const body = JobBody.safeParse(await request.json().catch(() => null))
          if (!body.success) {
            return Response.json({ error: 'expected { speaker, removeOrphans }' }, { status: 400 })
          }
          const { part } = request.params
          const planned = await planFor(part, body.data.speaker ?? undefined)
          if (!planned) return notFound()
          if (!planned.ok) return Response.json(planned, { status: 409 })
          const { plan, parallel } = planned
          const orphans = body.data.removeOrphans ? plan.orphans : []
          if (!plan.keys.length && !orphans.length) {
            return Response.json({ error: 'There is nothing to generate.' }, { status: 409 })
          }
          const job = jobs.start({
            part,
            speaker: body.data.speaker,
            keys: plan.keys,
            orphans,
            parallel,
            record: (key) =>
              recordLine(projectFile, part, key, fishFor, { encode, limiter: fishWork }),
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
              { error: 'expected { keywords: string[] } or { phrase: string | null }' },
              { status: 400 },
            )
          }
          const { id } = request.params
          const result =
            'keywords' in body.data
              ? await setKeywords(projectFile, id, body.data.keywords)
              : await setPhrase(projectFile, id, body.data.phrase)
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

import { BriefChangeBody } from '../../core/music'
import {
  ChooseTakeBody,
  MakeTakesBody,
  MoveTakeBody,
  SetFadesBody,
  TrimTakeBody,
} from '../../core/musicTake'
import { keepMyBrief, setTrackBrief } from '../../services/briefs'
import { refreshShared } from '../../services/refresh'
import { setMusicModel } from '../../services/models'
import { removeOrphan } from '../../services/musicOrphans'
import { musicClipFile, musicCurrentFile } from '../../services/workspace'
import type { RouteContext } from '../context'
import { takeRoutes } from '../takeRoutes'
import { StageModelBody, fileResponse, notFound } from '../shared'

/** The music routes. */
export function musicRoutes(c: RouteContext) {
  const { fromOwnPage, guard, musicTakes, projectFile } = c
  return {
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
    '/api/music/tracks/:id/keep-mine': {
      POST: fromOwnPage(async (request) => {
        const result = await keepMyBrief(projectFile, request.params.id)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    ...takeRoutes(c, {
      base: '/api/music/tracks',
      service: musicTakes,
      bodies: {
        make: MakeTakesBody,
        fades: SetFadesBody,
        choose: ChooseTakeBody,
        trim: TrimTakeBody,
      },
    }),
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
        return fileResponse(file)
      }),
    },
    '/api/music/tracks/:id/current': {
      GET: guard(async (request) => {
        const file = await musicCurrentFile(projectFile, request.params.id)
        return fileResponse(file)
      }),
    },
    '/api/music/model-state': {
      GET: guard(async () => {
        const state = await musicTakes.modelState(projectFile)
        return state ? Response.json(state) : notFound()
      }),
    },
    '/api/music/lists/:id/make-all': {
      POST: fromOwnPage(async (request) => {
        const result = await musicTakes.makeAll(projectFile, request.params.id)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/music/lists/:id/batch': {
      GET: guard(async (request) =>
        Response.json(await musicTakes.batch(projectFile, request.params.id)),
      ),
    },
    '/api/music/lists/:id/batch/close': {
      POST: fromOwnPage(async (request) =>
        Response.json(await musicTakes.closeBatch(projectFile, request.params.id)),
      ),
    },
    '/api/music/lists/:id/stop': {
      POST: fromOwnPage(async (request) => {
        const result = await musicTakes.stopAll(projectFile, request.params.id)
        return result ? Response.json(result) : notFound()
      }),
    },
    '/api/music/making': {
      GET: guard(async () => Response.json(await musicTakes.making(projectFile))),
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
  }
}

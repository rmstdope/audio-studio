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
import { makeAllRoutes } from '../makeAllRoutes'
import { takeRoutes } from '../takeRoutes'
import { StageModelBody, fileRoute, notFound } from '../shared'

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
      GET: fileRoute(guard, async (request) => {
        return musicClipFile(projectFile, request.params.file)
      }),
    },
    '/api/music/tracks/:id/current': {
      GET: fileRoute(guard, async (request) => {
        return musicCurrentFile(projectFile, request.params.id)
      }),
    },
    '/api/music/model-state': {
      GET: guard(async () => {
        const state = await musicTakes.modelState(projectFile)
        return state ? Response.json(state) : notFound()
      }),
    },
    ...makeAllRoutes(c, {
      base: '/api/music/lists/:id',
      stop: 'stop',
      service: {
        makeAll: (file, request) => musicTakes.makeAll(file, request.params.id),
        batch: (file, request) => musicTakes.batch(file, request.params.id),
        closeBatch: (file, request) => musicTakes.closeBatch(file, request.params.id),
        stopAll: (file, request) => musicTakes.stopAll(file, request.params.id),
      },
    }),
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

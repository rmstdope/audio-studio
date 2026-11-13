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
import { StageModelBody, notFound, takeResponse } from '../shared'

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
        const file = await musicTakes.takeFile(projectFile, request.params.id, request.params.file)
        if (!file) return notFound()
        // `?trimmed=1`: only the part between a trimmed take's cuts (the whole sound if not trimmed),
        // with any fades asked for in the address over it.
        const part =
          new URL(request.url).searchParams.get('trimmed') === '1'
            ? await musicTakes.trimmedSound(projectFile, request.params.id, request.params.file)
            : null
        return takeResponse(request, file, part ?? undefined)
      }),
      DELETE: fromOwnPage(async (request) => {
        const result = await musicTakes.drop(projectFile, request.params.id, request.params.file)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/music/tracks/:id/takes/:file/fades': {
      PUT: fromOwnPage(async (request) => {
        const body = SetFadesBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { in, out, shape }' }, { status: 400 })
        }
        const result = await musicTakes.setFades(
          projectFile,
          request.params.id,
          request.params.file,
          body.data,
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
      DELETE: fromOwnPage(async (request) => {
        const result = await musicTakes.setFades(
          projectFile,
          request.params.id,
          request.params.file,
          null,
        )
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
    '/api/music/tracks/:id/trim': {
      POST: fromOwnPage(async (request) => {
        const body = TrimTakeBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { file, undo? }' }, { status: 400 })
        }
        const result = await musicTakes.trim(
          projectFile,
          request.params.id,
          body.data.file,
          body.data.undo ?? false,
        )
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
    '/api/music/tracks/:id/accept': {
      POST: fromOwnPage(async (request) => {
        const result = await musicTakes.accept(projectFile, request.params.id)
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

import { refreshEffects } from '../../services/refresh'
import { forgetEffect, keepMineEffect, setEffectDescription } from '../../services/effectWords'
import {
  ChooseEffectTakeBody,
  MakeEffectTakesBody,
  SetEffectFadesBody,
  TrimEffectTakeBody,
} from '../../core/effectTakes'
import { MakeAllBody } from '../../core/effectsMakeAll'
import { effectClipFile, effectCurrentFile } from '../../services/workspace'
import type { RouteContext } from '../context'
import { EffectDescriptionBody, effectAnswer, notFound, takeResponse } from '../shared'

/** The effects routes. */
export function effectsRoutes(c: RouteContext) {
  const { effectTakes, fromOwnPage, guard, projectFile } = c
  return {
    '/api/effects/refresh': {
      POST: fromOwnPage(async () => {
        const result = await refreshEffects(projectFile)
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/effects/making': {
      GET: guard(async () => Response.json(await effectTakes.making(projectFile))),
    },
    '/api/effects/models': {
      GET: guard(async () => {
        const view = await effectTakes.models(projectFile)
        return view ? Response.json(view) : notFound()
      }),
    },
    '/api/effects/batch': {
      GET: guard(async () => Response.json(await effectTakes.batch(projectFile))),
    },
    '/api/effects/batch/close': {
      POST: fromOwnPage(async () => Response.json(await effectTakes.closeBatch(projectFile))),
    },
    '/api/effects/make-all': {
      POST: fromOwnPage(async (request) => {
        const body = MakeAllBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { ids }' }, { status: 400 })
        const result = await effectTakes.makeAll(projectFile, body.data.ids)
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/effects/stop-all': {
      POST: fromOwnPage(async () => Response.json(await effectTakes.stopAll(projectFile))),
    },
    '/api/effects/clips/:file': {
      GET: guard(async (request) => {
        const file = await effectClipFile(projectFile, request.params.file)
        return file ? new Response(Bun.file(file)) : notFound()
      }),
    },
    '/api/effects/:id/current': {
      GET: guard(async (request) => {
        const file = await effectCurrentFile(projectFile, request.params.id)
        return file ? new Response(Bun.file(file)) : notFound()
      }),
    },
    '/api/effects/:id/takes': {
      GET: guard(async (request) => {
        const view = await effectTakes.view(projectFile, request.params.id)
        return view ? Response.json(view) : notFound()
      }),
      POST: fromOwnPage(async (request) => {
        const body = MakeEffectTakesBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { count } or { retry }' }, { status: 400 })
        }
        const result = await effectTakes.make(projectFile, request.params.id, body.data)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/effects/:id/takes/:file': {
      GET: guard(async (request) => {
        const file = await effectTakes.takeFile(projectFile, request.params.id, request.params.file)
        if (!file) return notFound()
        // `?trimmed=1`: only the part between a trimmed take's cuts (the whole sound if not trimmed).
        const part =
          new URL(request.url).searchParams.get('trimmed') === '1'
            ? await effectTakes.trimmedSound(projectFile, request.params.id, request.params.file)
            : null
        return takeResponse(request, file, part ?? undefined)
      }),
      DELETE: fromOwnPage(async (request) => {
        const result = await effectTakes.drop(projectFile, request.params.id, request.params.file)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/effects/:id/takes/:file/fades': {
      PUT: fromOwnPage(async (request) => {
        const body = SetEffectFadesBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { in, out, shape }' }, { status: 400 })
        }
        const result = await effectTakes.setFades(
          projectFile,
          request.params.id,
          request.params.file,
          body.data,
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
      DELETE: fromOwnPage(async (request) => {
        const result = await effectTakes.setFades(
          projectFile,
          request.params.id,
          request.params.file,
          null,
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/effects/:id/choose': {
      POST: fromOwnPage(async (request) => {
        const body = ChooseEffectTakeBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { file }' }, { status: 400 })
        const result = await effectTakes.choose(projectFile, request.params.id, body.data.file)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/effects/:id/trim': {
      POST: fromOwnPage(async (request) => {
        const body = TrimEffectTakeBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { file, undo? }' }, { status: 400 })
        }
        const result = await effectTakes.trim(
          projectFile,
          request.params.id,
          body.data.file,
          body.data.undo ?? false,
        )
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/effects/:id/unchoose': {
      POST: fromOwnPage(async (request) => {
        const result = await effectTakes.unchoose(projectFile, request.params.id)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/effects/:id/accept': {
      POST: fromOwnPage(async (request) => {
        const result = await effectTakes.accept(projectFile, request.params.id)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/effects/:id/stop': {
      POST: fromOwnPage(async (request) => {
        const result = await effectTakes.stop(projectFile, request.params.id)
        return result ? Response.json(result) : notFound()
      }),
    },
    '/api/effects/:id': {
      PATCH: fromOwnPage(async (request) => {
        const body = EffectDescriptionBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json(
            { error: 'expected { description: string | null }' },
            { status: 400 },
          )
        }
        return effectAnswer(
          await setEffectDescription(projectFile, request.params.id, body.data.description),
        )
      }),
    },
    '/api/effects/:id/keep-mine': {
      POST: fromOwnPage(async (request) =>
        effectAnswer(await keepMineEffect(projectFile, request.params.id)),
      ),
    },
    '/api/effects/:id/forget': {
      POST: fromOwnPage(async (request) =>
        effectAnswer(await forgetEffect(projectFile, request.params.id)),
      ),
    },
  }
}

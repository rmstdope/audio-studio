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
import { takeRoutes } from '../takeRoutes'
import { EffectDescriptionBody, effectAnswer, fileRoute, notFound } from '../shared'

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
      GET: fileRoute(guard, async (request) => {
        return effectClipFile(projectFile, request.params.file)
      }),
    },
    '/api/effects/:id/current': {
      GET: fileRoute(guard, async (request) => {
        return effectCurrentFile(projectFile, request.params.id)
      }),
    },
    ...takeRoutes(c, {
      base: '/api/effects',
      service: effectTakes,
      bodies: {
        make: MakeEffectTakesBody,
        fades: SetEffectFadesBody,
        choose: ChooseEffectTakeBody,
        trim: TrimEffectTakeBody,
      },
    }),
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

import { saveScene } from '../../services/scenes'
import { making as measuring, startMeasure } from '../../services/sceneLoudness'
import type { RouteContext } from '../context'
import { MeasureBody, SceneBody, notFound } from '../shared'

/** The scenes routes. */
export function scenesRoutes(c: RouteContext) {
  const { fromOwnPage, guard, projectFile } = c
  return {
    '/api/scene-loudness': {
      GET: guard(async () => Response.json(measuring(projectFile))),
    },
    '/api/scene-loudness/:part': {
      POST: fromOwnPage(async (request) => {
        const body = MeasureBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { open?: { scene, entry } }' }, { status: 400 })
        }
        const result = await startMeasure(projectFile, request.params.part, body.data.open ?? null)
        if (result.ok) return Response.json({ ok: true })
        if (result.kind === 'unknown') return notFound()
        return Response.json({ ok: false, message: result.message }, { status: 409 })
      }),
    },
    '/api/scenes/:part/:id': {
      PUT: fromOwnPage(async (request) => {
        const body = SceneBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { scene, was }' }, { status: 400 })
        }
        const result = await saveScene(
          projectFile,
          request.params.part,
          request.params.id,
          body.data.scene,
          body.data.was,
          body.data.moved,
        )
        if (!result.ok && result.kind === 'unknown') return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
  }
}

import { gitChanges } from '../../services/git'
import {
  setElevenModel,
  setEffectModel,
  setImageModel,
  setStageModel,
  switchRetiredModels,
} from '../../services/models'
import { modelsView } from '../../services/modelsView'
import { setFishTier } from '../../services/fishTier'
import { setTakeFade } from '../../services/takeFade'
import { checkSetup } from '../../services/setup'
import { loadProject } from '../../services/workspace'
import type { RouteContext } from '../context'
import { FishTierBody, ModelsBody, StageModelBody, TakeFadeBody, notFound } from '../shared'

/** The setup routes. */
export function setupRoutes(c: RouteContext) {
  const {
    busyNow,
    creditOf,
    effectGenerator,
    effectHealth,
    elevenAccountOf,
    fromOwnPage,
    guard,
    imageGenerator,
    imageHealth,
    jobs,
    musicGenerator,
    projectFile,
    putStageModel,
  } = c
  return {
    '/api/project': {
      GET: guard(async () => Response.json(await loadProject(projectFile))),
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
    '/api/setup': {
      GET: guard(async () =>
        Response.json(
          await checkSetup(
            projectFile,
            creditOf,
            undefined,
            undefined,
            undefined,
            elevenAccountOf,
            imageGenerator,
            imageHealth,
            effectHealth,
            effectGenerator,
          ),
        ),
      ),
    },
    '/api/changes': {
      GET: guard(async () => Response.json(await gitChanges(projectFile))),
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
    '/api/take-fade': {
      PATCH: fromOwnPage(async (request) => {
        const body = TakeFadeBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { seconds }' }, { status: 400 })
        }
        const result = await setTakeFade(projectFile, body.data.seconds)
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/models': {
      GET: guard(async () => {
        const view = await modelsView(
          projectFile,
          musicGenerator.installed,
          imageGenerator,
          imageHealth,
          effectGenerator,
          effectHealth,
        )
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
    '/api/image-model': {
      PUT: fromOwnPage(async (request) => {
        const body = StageModelBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { model, was }' }, { status: 400 })
        }
        const result = await setImageModel(projectFile, body.data.model, body.data.was)
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/effect-model': {
      PUT: fromOwnPage(async (request) => {
        const body = StageModelBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { model, was }' }, { status: 400 })
        }
        const result = await setEffectModel(projectFile, body.data.model, body.data.was)
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/models/:stage': {
      PUT: fromOwnPage((request) =>
        putStageModel(request, request.params.stage, 'narration.models', setStageModel),
      ),
    },
    '/api/models/elevenlabs/:stage': {
      PUT: fromOwnPage((request) =>
        putStageModel(request, request.params.stage, 'narration.models.elevenlabs', setElevenModel),
      ),
    },
    // The plan's account and what running recordings and auditions hold of it, for the board.
  }
}

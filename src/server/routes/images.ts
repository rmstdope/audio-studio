import { MakeFineTunesBody, UseFineTuneBody } from '../../core/imageFineTunes'
import { ChoosePatchTakeBody, MakePatchTakesBody, RemakePatchesBody } from '../../core/imagePatches'
import { ChooseImageTakeBody, MakeImageTakesBody } from '../../core/imageTakes'
import {
  resolveImageCompare,
  resolveImagePatchCompare,
  setImageActStyle,
  setImageActStylePick,
  setImageAreaBox,
  setImagePatchWords,
  setImageWords,
  setStyleField,
} from '../../services/imageEdits'
import { ActStyleBody, CompareBody, StyleFieldBody, WordsBody } from '../../core/images'
import { figuresOf } from '../../core/takeTimes'
import { readTakeTimes } from '../../services/takeTimes'
import type { RouteContext } from '../context'
import { makeAllRoutes } from '../makeAllRoutes'
import { AreaBoxBody, imageAnswer, fileRoute, notFound } from '../shared'

/** The images routes. */
export function imagesRoutes(c: RouteContext) {
  const { fromOwnPage, guard, imageFineTunes, imagePatches, imageTakes, projectFile } = c
  return {
    '/api/images/:id': {
      PATCH: fromOwnPage(async (request) => {
        const body = WordsBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { words: string | null }' }, { status: 400 })
        }
        return imageAnswer(await setImageWords(projectFile, request.params.id, body.data.words))
      }),
    },
    '/api/images/:id/act-style': {
      PATCH: fromOwnPage(async (request) => {
        const body = ActStyleBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json(
            { error: 'expected { on: boolean } or { from: string | null }' },
            { status: 400 },
          )
        }
        return imageAnswer(
          'on' in body.data
            ? await setImageActStyle(projectFile, request.params.id, body.data.on)
            : await setImageActStylePick(projectFile, request.params.id, body.data.from),
        )
      }),
    },
    '/api/images/:id/compare': {
      POST: fromOwnPage(async (request) => {
        const body = CompareBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: "expected { choice: 'keep' | 'game' }" }, { status: 400 })
        }
        return imageAnswer(
          await resolveImageCompare(projectFile, request.params.id, body.data.choice),
        )
      }),
    },
    '/api/images/:id/game-patches/:patch': {
      PATCH: fromOwnPage(async (request) => {
        const body = WordsBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { words: string | null }' }, { status: 400 })
        }
        const { id, patch } = request.params
        return imageAnswer(await setImagePatchWords(projectFile, id, patch, body.data.words))
      }),
    },
    '/api/images/:id/areas/:area': {
      PUT: fromOwnPage(async (request) => {
        const body = AreaBoxBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json(
            { error: 'expected { box: {x,y,width,height} | null }' },
            { status: 400 },
          )
        }
        const { id, area } = request.params
        return imageAnswer(await setImageAreaBox(projectFile, id, area, body.data.box))
      }),
    },
    '/api/images/:id/game-patches/:patch/compare': {
      POST: fromOwnPage(async (request) => {
        const body = CompareBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: "expected { choice: 'keep' | 'game' }" }, { status: 400 })
        }
        const { id, patch } = request.params
        return imageAnswer(await resolveImagePatchCompare(projectFile, id, patch, body.data.choice))
      }),
    },
    '/api/images/making': {
      GET: guard(async () => Response.json(await imageTakes.making(projectFile))),
    },
    '/api/images/take-times': {
      GET: guard(async () => Response.json(figuresOf(await readTakeTimes(projectFile)))),
    },
    '/api/images/model-state': {
      GET: guard(async () => Response.json(await imageTakes.modelState(projectFile))),
    },
    ...makeAllRoutes(c, {
      base: '/api/image-acts/:id',
      stop: 'stop',
      stopRefuses: true,
      service: {
        makeAll: (file, request) => imageTakes.makeAll(file, request.params.id),
        batch: (file, request) => imageTakes.batch(file, request.params.id),
        closeBatch: (file, request) => imageTakes.closeBatch(file, request.params.id),
        stopAll: (file, request) => imageTakes.stopAll(file, request.params.id),
      },
    }),
    '/api/images/bring-all': {
      GET: guard(async () => Response.json(imageTakes.lookRun(projectFile))),
      POST: fromOwnPage(async () => imageAnswer(await imageTakes.bringAll(projectFile))),
    },
    '/api/images/:id/patches': {
      GET: guard(async (request) => {
        const view = await imagePatches.view(
          projectFile,
          request.params.id,
          new URL(request.url).searchParams.has('fresh'),
        )
        return view ? Response.json(view) : notFound()
      }),
    },
    '/api/images/:id/patches/remake': {
      POST: fromOwnPage(async (request) => {
        const body = RemakePatchesBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { count, marks, model? }' }, { status: 400 })
        }
        return imageAnswer(await imagePatches.remake(projectFile, request.params.id, body.data))
      }),
    },
    '/api/images/:id/patches/remake/stop': {
      POST: fromOwnPage(async (request) => {
        const result = await imagePatches.stopRemake(projectFile, request.params.id)
        return result ? Response.json(result) : notFound()
      }),
    },
    '/api/images/:id/patches/remake/close': {
      POST: fromOwnPage(async (request) =>
        Response.json(await imagePatches.closeRemake(projectFile, request.params.id)),
      ),
    },
    '/api/images/:id/patches/:patch/takes': {
      POST: fromOwnPage(async (request) => {
        const body = MakePatchTakesBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json(
            { error: 'expected { count, area, model? } or { retry }' },
            { status: 400 },
          )
        }
        const { id, patch } = request.params
        return imageAnswer(await imagePatches.make(projectFile, id, patch, body.data))
      }),
    },
    '/api/images/:id/patches/:patch/takes/:n': {
      GET: fileRoute(guard, async (request) => {
        const { id, patch, n } = request.params
        return imagePatches.takeFile(projectFile, id, patch, n)
      }),
      DELETE: fromOwnPage(async (request) => {
        const { id, patch, n } = request.params
        return imageAnswer(await imagePatches.drop(projectFile, id, patch, Number(n)))
      }),
    },
    '/api/images/:id/patches/:patch/takes/:n/game': {
      GET: fileRoute(guard, async (request) => {
        const { id, patch, n } = request.params
        return imagePatches.gameFile(projectFile, id, patch, n)
      }),
    },
    '/api/images/:id/patches/:patch/takes/:n/seen': {
      POST: fromOwnPage(async (request) => {
        const { id, patch, n } = request.params
        return imageAnswer(await imagePatches.markSeen(projectFile, id, patch, Number(n)))
      }),
    },
    '/api/images/:id/patches/:patch/choose': {
      POST: fromOwnPage(async (request) => {
        const body = ChoosePatchTakeBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { n }' }, { status: 400 })
        const { id, patch } = request.params
        return imageAnswer(await imagePatches.choose(projectFile, id, patch, body.data.n))
      }),
    },
    '/api/images/:id/patches/:patch/unchoose': {
      POST: fromOwnPage(async (request) => {
        const { id, patch } = request.params
        return imageAnswer(await imagePatches.unchoose(projectFile, id, patch))
      }),
    },
    '/api/images/:id/patches/:patch/stop': {
      POST: fromOwnPage(async (request) => {
        const { id, patch } = request.params
        const result = await imagePatches.stop(projectFile, id, patch)
        return result ? Response.json(result) : notFound()
      }),
    },
    '/api/images/:id/fine-tunes': {
      GET: guard(async (request) => {
        const view = await imageFineTunes.view(projectFile, request.params.id)
        return view ? Response.json(view) : notFound()
      }),
      POST: fromOwnPage(async (request) => {
        const body = MakeFineTunesBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json(
            { error: 'expected { count, words, area, model? } or { retry }' },
            { status: 400 },
          )
        }
        return imageAnswer(await imageFineTunes.make(projectFile, request.params.id, body.data))
      }),
    },
    '/api/images/:id/fine-tunes/base': {
      GET: guard(async (request) => {
        const png = await imageFineTunes.base(projectFile, request.params.id)
        return png
          ? new Response(Buffer.from(png), { headers: { 'content-type': 'image/png' } })
          : notFound()
      }),
    },
    '/api/images/:id/fine-tunes/stop': {
      POST: fromOwnPage(async (request) => {
        const result = await imageFineTunes.stop(projectFile, request.params.id)
        return result ? Response.json(result) : notFound()
      }),
    },
    '/api/images/:id/fine-tunes/use': {
      POST: fromOwnPage(async (request) => {
        const body = UseFineTuneBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { n }' }, { status: 400 })
        const result = await imageFineTunes.use(projectFile, request.params.id, body.data.n)
        if (!result) return notFound()
        return Response.json(result, { status: result.ok ? 200 : 409 })
      }),
    },
    '/api/images/:id/fine-tunes/:n': {
      GET: fileRoute(guard, async (request) => {
        const { id, n } = request.params
        return imageFineTunes.file(projectFile, id, n)
      }),
      DELETE: fromOwnPage(async (request) => {
        const { id, n } = request.params
        return imageAnswer(await imageFineTunes.drop(projectFile, id, Number(n)))
      }),
    },
    '/api/images/:id/fine-tunes/:n/seen': {
      POST: fromOwnPage(async (request) => {
        const { id, n } = request.params
        return imageAnswer(await imageFineTunes.markSeen(projectFile, id, Number(n)))
      }),
    },
    '/api/images/:id/takes': {
      GET: guard(async (request) => {
        const view = await imageTakes.view(projectFile, request.params.id)
        return view ? Response.json(view) : notFound()
      }),
      POST: fromOwnPage(async (request) => {
        const body = MakeImageTakesBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json({ error: 'expected { count } or { retry }' }, { status: 400 })
        }
        return imageAnswer(await imageTakes.make(projectFile, request.params.id, body.data))
      }),
    },
    '/api/images/:id/takes/:n': {
      GET: fileRoute(guard, async (request) => {
        return imageTakes.takeFile(projectFile, request.params.id, request.params.n)
      }),
      DELETE: fromOwnPage(async (request) =>
        imageAnswer(
          await imageTakes.drop(projectFile, request.params.id, Number(request.params.n)),
        ),
      ),
    },
    '/api/images/:id/takes/:n/game': {
      GET: fileRoute(guard, async (request) => {
        return imageTakes.gameFile(projectFile, request.params.id, request.params.n)
      }),
    },
    '/api/images/:id/takes/:n/seen': {
      POST: fromOwnPage(async (request) =>
        imageAnswer(
          await imageTakes.markSeen(projectFile, request.params.id, Number(request.params.n)),
        ),
      ),
    },
    '/api/images/:id/choose': {
      POST: fromOwnPage(async (request) => {
        const body = ChooseImageTakeBody.safeParse(await request.json().catch(() => null))
        if (!body.success) return Response.json({ error: 'expected { n }' }, { status: 400 })
        return imageAnswer(await imageTakes.choose(projectFile, request.params.id, body.data.n))
      }),
    },
    '/api/images/:id/accept': {
      POST: fromOwnPage(async (request) =>
        imageAnswer(await imageTakes.accept(projectFile, request.params.id)),
      ),
    },
    '/api/images/:id/unchoose': {
      POST: fromOwnPage(async (request) =>
        imageAnswer(await imageTakes.unchoose(projectFile, request.params.id)),
      ),
    },
    '/api/images/:id/stop': {
      POST: fromOwnPage(async (request) => {
        const result = await imageTakes.stop(projectFile, request.params.id)
        return result ? Response.json(result) : notFound()
      }),
    },
    '/api/images/:id/current': {
      GET: fileRoute(guard, async (request) => {
        return imageTakes.currentFile(projectFile, request.params.id)
      }),
    },
    '/api/image-style': {
      PATCH: fromOwnPage(async (request) => {
        const body = StyleFieldBody.safeParse(await request.json().catch(() => null))
        if (!body.success) {
          return Response.json(
            { error: 'expected { look: string | null } or { keepOut: string | null }' },
            { status: 400 },
          )
        }
        const [field, text] = Object.entries(body.data)[0] as ['look' | 'keepOut', string | null]
        return imageAnswer(await setStyleField(projectFile, field, text))
      }),
    },
  }
}

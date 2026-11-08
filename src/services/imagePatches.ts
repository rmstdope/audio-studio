import { dirname } from 'node:path'
import { imageModel } from '../core/imageModels'
import {
  checkPatchArea,
  keepArea,
  PatchBoardSchema,
  type ImagePatchesView,
  type PatchArea,
  type PatchBoard,
} from '../core/imagePatches'
import { resolveInRoot } from '../core/paths'
import { CACHE_DIR, type Problem } from '../core/project'
import { readResource, writeAtomic } from './files'
import { freeGpu, gpuQueue } from './gpu'
import { IMAGE_TAKES_DIR, readImages } from './imageLists'
import { makeImageTake, type ImageGenerator } from './images'
import { boardQueue, isSafeId } from './musicTakes'
import { describeFailure } from './imageTakes'
import { decodePng, encodeTransparentPng, pngSize } from './png'
import type { Serial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** The folder of an image's patches: the studio's cache, never committed and never read by the game. */
const patchFolder = (id: string) => `${CACHE_DIR}/image-patches/${id}`

/** The model patches are made with, the one mflux can edit a picture with. */
const EDIT_MODEL = 'klein'

/** What asking for a patch answered: started, refused with a reason, or a file that cannot be used. */
export type ImagePatchAnswer = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** The patches of an image, in an experiment nothing of the game reads. */
export interface ImagePatches {
  /** The patches of the chosen take, a project failure, or null for an image the project does not list. */
  view(projectFile: string, id: string): Promise<ImagePatchesView | ProjectFailure | null>
  /** Queues a patch of the chosen take on the GPU queue and returns at once. */
  make(
    projectFile: string,
    id: string,
    request: { area: PatchArea; instruction: string },
  ): Promise<ImagePatchAnswer>
  /** The path of a patch's picture, or null for an image not listed or a name that is not a patch's number. */
  patchFile(projectFile: string, id: string, name: string): Promise<string | null>
}

/** What is going on with an image's patch, kept in memory for the page to poll. */
type Activity =
  | { state: 'making'; take: number; instruction: string; area: PatchArea }
  | { state: 'failed'; take: number; instruction: string; message: string }

/**
 * In-context patches of an image's chosen take: the whole take is edited from an instruction and
 * only the marked area is kept, with a soft edge. Each is `<folder>/<n>.png`, as big as the take
 * and transparent outside the area, on a `<folder>/board.json` in the studio's cache; the image
 * list, the lock and the manifest are not touched.
 */
export function createImagePatches({
  generator,
  queue = gpuQueue(),
  free = freeGpu,
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
}: {
  generator: ImageGenerator
  queue?: Serial
  /** Frees the GPU of the other workers before an edit (tests). */
  free?: () => void | Promise<void>
  newSeed?: () => number
}): ImagePatches {
  const shared = globalThis as { contentStudioImagePatches?: Map<string, Activity> }
  // Kept across `--dev` reloads, as the takes being made are.
  const activity = (shared.contentStudioImagePatches ??= new Map())
  const boards = boardQueue()

  async function resolve(projectFile: string, id: string) {
    if (!isSafeId(id)) return null
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    if (!opened.project.images) return null
    const root = dirname(projectFile)
    const summary = await readImages(root, opened.project, [])
    const row = summary?.acts.flatMap((act) => act.rows).find((r) => r.id === id)
    if (!row) return null
    return {
      root,
      id,
      chosen: row.chosenTake,
      key: `${projectFile}\0${id}`,
      folder: patchFolder(id),
      board: `${patchFolder(id)}/board.json`,
    }
  }
  type Found = Exclude<Awaited<ReturnType<typeof resolve>>, ProjectFailure | null>

  async function readBoard(found: Found): Promise<PatchBoard | ProjectFailure> {
    const problems: Problem[] = []
    const board = await readResource(found.root, found.board, PatchBoardSchema, problems)
    if (board === 'missing') return { next: 1, patches: [] }
    if (board === 'invalid') return { ok: false, file: found.board, problems }
    return board
  }

  /** The chosen take's picture and size, or null when it is not there or is no picture. */
  async function takePicture(found: Found, n: number) {
    const path = resolveInRoot(found.root, `${IMAGE_TAKES_DIR}/${found.id}/${n}.png`)
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    try {
      return { path, ...pngSize(new Uint8Array(await file.slice(0, 33).arrayBuffer())) }
    } catch {
      return null
    }
  }

  /** Edits the whole take and saves the marked area as the next patch. */
  async function run(
    found: Found,
    take: { n: number; path: string; width: number; height: number },
    request: { area: PatchArea; instruction: string },
  ): Promise<void> {
    try {
      const made = await makeImageTake(
        { generator, queue, free },
        {
          prompt: request.instruction,
          width: take.width,
          height: take.height,
          seed: newSeed(),
          model: EDIT_MODEL,
          editing: take.path,
        },
      )
      const edited = decodePng(made.png)
      if (edited.width !== take.width || edited.height !== take.height) {
        throw new Error(
          `The edited picture came back at ${edited.width} × ${edited.height} instead of ${take.width} × ${take.height}.`,
        )
      }
      const png = encodeTransparentPng(keepArea(edited, request.area))
      const failure = await boards.run(found.key, async () => {
        const board = await readBoard(found)
        if ('ok' in board) return board
        const n = board.next
        // The picture first: a patch is on the board only once its file is there.
        await writeAtomic(found.root, `${found.folder}/${n}.png`, png)
        const patch = {
          n,
          take: take.n,
          seed: made.seed,
          instruction: request.instruction,
          area: request.area,
        }
        const after = { next: n + 1, patches: [...board.patches, patch] }
        await writeAtomic(found.root, found.board, `${JSON.stringify(after, null, 2)}\n`)
        return null
      })
      if (failure) throw new Error(`${failure.file} cannot be used`)
      activity.delete(found.key)
    } catch (error) {
      activity.set(found.key, {
        state: 'failed',
        take: take.n,
        instruction: request.instruction,
        message: describeFailure(error),
      })
    }
  }

  return {
    async view(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || 'ok' in found) return found
      // Before the board: a patch that lands in between then shows as made, never as neither.
      const latest = activity.get(found.key)
      const now = latest?.take === found.chosen ? latest : undefined
      const board = await readBoard(found)
      if ('ok' in board) return board
      const picture = found.chosen === null ? null : await takePicture(found, found.chosen)
      return {
        take: picture && { n: found.chosen!, width: picture.width, height: picture.height },
        pictureGone: found.chosen !== null && picture === null,
        patches: board.patches.filter((p) => p.take === found.chosen),
        making: now?.state === 'making' ? { instruction: now.instruction, area: now.area } : null,
        failed:
          now?.state === 'failed' ? { instruction: now.instruction, message: now.message } : null,
        folder: found.folder,
      }
    },

    async make(projectFile, id, request) {
      const found = await resolve(projectFile, id)
      if (!found || 'ok' in found) return found
      const before = activity.get(found.key)
      if (before?.state === 'making') {
        return {
          ok: false,
          message: 'A patch of this image is being made. Wait for it, then try again.',
        }
      }
      if (found.chosen === null) {
        return { ok: false, message: 'Choose a take first: a patch is made from the chosen take.' }
      }
      const n = found.chosen
      // Taken before the first wait, so that of two requests at once only one goes on.
      activity.set(found.key, { state: 'making', take: n, ...request })
      const refuse = (message: string) => {
        if (before) activity.set(found.key, before)
        else activity.delete(found.key)
        return { ok: false as const, message }
      }
      const ready = await generator.ready()
      if (!ready.ok) return refuse(ready.message)
      if (!(await generator.installed(EDIT_MODEL))) {
        return refuse(
          `${imageModel(EDIT_MODEL).name} is not on this computer, and patches are made with it.`,
        )
      }
      if (generator.canEdit && !(await generator.canEdit())) {
        return refuse(
          'This mflux cannot edit pictures. Update it with uv tool install --upgrade mflux, then start the studio again.',
        )
      }
      const picture = await takePicture(found, n)
      if (!picture) {
        return refuse(
          "The chosen take's picture is missing or cannot be read, so it cannot be edited.",
        )
      }
      const problem = checkPatchArea(request.area, picture)
      if (problem) return refuse(problem)
      void run(found, { n, ...picture }, request)
      return { ok: true }
    },

    async patchFile(projectFile, id, name) {
      if (!/^[1-9]\d*$/.test(name)) return null
      const found = await resolve(projectFile, id)
      if (!found || 'ok' in found) return null
      const file = resolveInRoot(found.root, `${found.folder}/${name}.png`)
      return (await Bun.file(file).exists()) ? file : null
    },
  }
}

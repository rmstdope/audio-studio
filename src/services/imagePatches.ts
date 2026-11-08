import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { imageModel } from '../core/imageModels'
import {
  checkPatchArea,
  keepArea,
  matchToTake,
  PatchBoardSchema,
  type ImagePatchesView,
  type PatchArea,
  type PatchBoard,
  type PatchTake,
  type PatchWorkView,
} from '../core/imagePatches'
import type { PatchRow } from '../core/images'
import { resolveInRoot } from '../core/paths'
import { CACHE_DIR, type Problem } from '../core/project'
import { readResource, writeAtomic } from './files'
import { freeGpu, gpuQueue } from './gpu'
import { IMAGE_TAKES_DIR, readImages } from './imageLists'
import { makeImageTake, type ImageGenerator } from './images'
import { describeFailure } from './imageTakes'
import { boardQueue, isSafeId } from './musicTakes'
import { decodePng, encodeTransparentPng, pngSize } from './png'
import type { Serial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** The folder of a patch's takes: the studio's cache, never committed and never read by the game. */
const patchFolder = (image: string, patch: string) => `${CACHE_DIR}/image-patches/${image}/${patch}`

/** The model patches are made with, the one mflux can edit a picture with. */
const EDIT_MODEL = 'klein'

/** What a change to a patch's takes answered: done, refused with a reason, or a file that cannot be used. */
export type ImagePatchAnswer = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** What to make: this many new takes of an area, or the failed take with this number again. */
export type PatchMakeRequest = { count: number; area: PatchArea } | { retry: number }

/** The takes of the patches the game asks for on an image. */
export interface ImagePatches {
  /** The image's patches with their takes on the chosen take, a project failure, or null for an image not listed. */
  view(projectFile: string, id: string): Promise<ImagePatchesView | ProjectFailure | null>
  /** Queues takes of a patch on the GPU queue and returns at once; null for an image or patch not listed. */
  make(
    projectFile: string,
    id: string,
    patch: string,
    request: PatchMakeRequest,
  ): Promise<ImagePatchAnswer>
  /** Stops the patch's takes: the one being made ends and is discarded, the waiting ones never start. */
  stop(
    projectFile: string,
    id: string,
    patch: string,
  ): Promise<{ ok: true; stopped: number } | ProjectFailure | null>
  /** Chooses a take of the patch on the take it was made on, in place of another chosen one. */
  choose(projectFile: string, id: string, patch: string, n: number): Promise<ImagePatchAnswer>
  /** Takes back the patch's chosen take on the image's chosen take; the take stays. */
  unchoose(projectFile: string, id: string, patch: string): Promise<ImagePatchAnswer>
  /** Takes a take that is not chosen off the board and deletes its picture. */
  drop(projectFile: string, id: string, patch: string, n: number): Promise<ImagePatchAnswer>
  /** Records that a take has been laid over the picture once. */
  markSeen(projectFile: string, id: string, patch: string, n: number): Promise<ImagePatchAnswer>
  /** The path of a take's picture, or null for a patch not listed or a name that is not a take's number. */
  takeFile(projectFile: string, id: string, patch: string, name: string): Promise<string | null>
}

/** A take waiting, being made, or failed, until it is made. */
interface Entry {
  n: number
  state: 'waiting' | 'making' | 'failed'
  startedAt: number
  message: string
  /** The image's take it is painted on, and that take's picture. */
  base: number
  /** The area and words it is made with, kept for making it again. */
  area: PatchArea
  words: string
  /** Ends the take while it is being made (Stop). */
  stop?: AbortController
}

/**
 * The takes of the patches the game asks for on an image: the chosen take of the image is edited
 * whole from the patch's words and only the marked area is kept, with a soft edge. A take is
 * `<folder>/<n>.png`, as big as the image's take and transparent outside its area, on a
 * `<folder>/board.json` per patch in the studio's cache, with the choice made on each take of the
 * image; the image list, the lock and the manifest are not touched. What is waiting, being made or
 * failed is kept in memory.
 */
export function createImagePatches({
  generator,
  queue = gpuQueue(),
  free = freeGpu,
  now = Date.now,
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
}: {
  generator: ImageGenerator
  queue?: Serial
  /** Frees the GPU of the other workers before an edit (tests). */
  free?: () => void | Promise<void>
  now?: () => number
  newSeed?: () => number
}): ImagePatches {
  const shared = globalThis as { contentStudioPatchTakes?: Map<string, Map<number, Entry>> }
  // Kept across `--dev` reloads, as the takes being made are.
  const active = (shared.contentStudioPatchTakes ??= new Map())
  const boards = boardQueue()
  /** Patches whose new takes are being checked and queued, so a second press at once is refused. */
  const starting = new Set<string>()

  async function resolve(projectFile: string, id: string) {
    if (!isSafeId(id)) return null
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    if (!opened.project.images) return null
    const root = dirname(projectFile)
    const summary = await readImages(root, opened.project, [])
    const row = summary?.acts.flatMap((act) => act.rows).find((r) => r.id === id)
    return row ? { projectFile, root, id, row, chosen: row.chosenTake } : null
  }
  type Image = Exclude<Awaited<ReturnType<typeof resolve>>, ProjectFailure | null>

  /** An image with one of the patches the game lists on it, and where the patch keeps its takes. */
  const patchOf = (image: Image, patch: PatchRow) => ({
    ...image,
    patch,
    key: `${image.projectFile}\0${image.id}\0${patch.id}`,
    folder: patchFolder(image.id, patch.id),
    board: `${patchFolder(image.id, patch.id)}/board.json`,
  })

  /** The image and one of the patches the game lists on it, or null / a failure. */
  async function resolvePatch(projectFile: string, id: string, patch: string) {
    const image = await resolve(projectFile, id)
    if (!image || 'ok' in image) return image
    const row = image.row.patches.find((p) => p.id === patch)
    return row && isSafeId(patch) ? patchOf(image, row) : null
  }
  type Found = Exclude<Awaited<ReturnType<typeof resolvePatch>>, ProjectFailure | null>

  async function readBoard(
    found: Pick<Found, 'root' | 'board'>,
  ): Promise<PatchBoard | ProjectFailure> {
    const problems: Problem[] = []
    const board = await readResource(found.root, found.board, PatchBoardSchema, problems)
    if (board === 'missing') return { next: 1, takes: [], chosen: {} }
    if (board === 'invalid') return { ok: false, file: found.board, problems }
    return board
  }

  /** Reads the board in its turn, lets `change` alter it and writes it back if it differs. */
  function changeBoard<T>(
    found: Pick<Found, 'root' | 'board' | 'key'>,
    change: (board: PatchBoard) => T | Promise<T>,
  ): Promise<T | ProjectFailure> {
    return boards.run(`patch\0${found.key}`, async () => {
      const board = await readBoard(found)
      if ('ok' in board) return board
      const before = JSON.stringify(board, null, 2)
      const answer = await change(board)
      const after = JSON.stringify(board, null, 2)
      if (after !== before) await writeAtomic(found.root, found.board, `${after}\n`)
      return answer
    })
  }

  /** The image take's picture and size, or null when it is not there or is no picture. */
  async function takePicture(image: Image, n: number) {
    const path = resolveInRoot(image.root, `${IMAGE_TAKES_DIR}/${image.id}/${n}.png`)
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    try {
      return { path, ...pngSize(new Uint8Array(await file.slice(0, 33).arrayBuffer())) }
    } catch {
      return null
    }
  }

  /** Why takes cannot be made on this computer, or null when they can. */
  async function makerProblem(): Promise<string | null> {
    const ready = await generator.ready()
    if (!ready.ok) return ready.message
    if (!(await generator.installed(EDIT_MODEL))) {
      return `${imageModel(EDIT_MODEL).name} is not on this computer, and patches are made with it.`
    }
    if (generator.canEdit && !(await generator.canEdit())) {
      return 'This mflux cannot edit pictures. Update it with uv tool install --upgrade mflux, then start the studio again.'
    }
    return null
  }

  const entriesOf = (key: string) =>
    [...(active.get(key)?.values() ?? [])].sort((a, b) => a.n - b.n)

  /** Edits the whole image take and saves the marked area as take `entry.n`. */
  async function run(
    found: Found,
    entry: Entry,
    take: { path: string; width: number; height: number },
    entries: Map<number, Entry>,
  ): Promise<void> {
    if (entries.get(entry.n) !== entry || entry.state !== 'waiting') return
    const stop = new AbortController()
    entry.stop = stop
    try {
      const made = await makeImageTake(
        { generator, queue, free },
        {
          prompt: entry.words,
          width: take.width,
          height: take.height,
          seed: newSeed(),
          model: EDIT_MODEL,
          editing: take.path,
        },
        stop.signal,
        () => {
          entry.state = 'making'
          entry.startedAt = now()
        },
      )
      if (stop.signal.aborted) return
      const edited = decodePng(made.png)
      if (edited.width !== take.width || edited.height !== take.height) {
        throw new Error(
          `The edited picture came back at ${edited.width} × ${edited.height} instead of ${take.width} × ${take.height}.`,
        )
      }
      const around = decodePng(new Uint8Array(await Bun.file(take.path).arrayBuffer()))
      const png = encodeTransparentPng(
        keepArea(matchToTake(edited, around, entry.area), entry.area),
      )
      const saved: PatchTake = {
        n: entry.n,
        base: entry.base,
        seed: made.seed,
        words: entry.words,
        area: entry.area,
        seen: false,
      }
      // The picture first: a take is on the board only once its file is there.
      await writeAtomic(found.root, `${found.folder}/${entry.n}.png`, png)
      const failure = await changeBoard(found, (board) => {
        if (stop.signal.aborted) return
        board.takes = [...board.takes.filter((t) => t.n !== saved.n), saved].sort(
          (a, b) => a.n - b.n,
        )
      })
      if (stop.signal.aborted || (failure && 'ok' in failure)) {
        await rm(resolveInRoot(found.root, `${found.folder}/${entry.n}.png`), { force: true })
        if (failure && 'ok' in failure) throw new Error(`${failure.file} cannot be used`)
        return
      }
      entries.delete(entry.n)
    } catch (error) {
      if (stop.signal.aborted) return
      entry.state = 'failed'
      entry.message = describeFailure(error)
    }
  }

  /** Checks the request and queues its takes. */
  async function start(
    found: Found,
    entries: Map<number, Entry>,
    request: PatchMakeRequest,
  ): Promise<ImagePatchAnswer> {
    const failed = 'retry' in request ? entries.get(request.retry) : undefined
    if ('retry' in request && failed?.state !== 'failed') {
      return {
        ok: false,
        message: `Take ${request.retry} did not fail, so it is not made again.`,
      }
    }
    if (found.chosen === null) {
      return {
        ok: false,
        message:
          'Choose a take of the image first. Patches are painted onto the take the game shows.',
      }
    }
    if (failed && failed.base !== found.chosen) {
      return {
        ok: false,
        message: `Take ${failed.n} was made on another take of the image, so it is not made again here.`,
      }
    }
    const picture = await takePicture(found, found.chosen)
    if (!picture) {
      return {
        ok: false,
        message: "The chosen take's picture is missing or cannot be read, so it cannot be patched.",
      }
    }
    if ('count' in request) {
      const problem = checkPatchArea(request.area, picture)
      if (problem) return { ok: false, message: problem }
    }
    const problem = await makerProblem()
    if (problem) return { ok: false, message: problem }
    const queued: Entry[] = []
    if (failed) {
      failed.state = 'waiting'
      queued.push(failed)
    } else if ('count' in request) {
      // The entries are added before the first wait, so a second request at once is refused above.
      const first = Math.max(...[...entries.values()].map((e) => e.n + 1), 1)
      const reserved = await changeBoard(found, (board) => {
        const at = Math.max(board.next, first)
        board.next = at + request.count
        return at
      })
      if (typeof reserved !== 'number') return reserved
      for (let i = 0; i < request.count; i++) {
        const entry: Entry = {
          n: reserved + i,
          state: 'waiting',
          startedAt: 0,
          message: '',
          base: found.chosen,
          area: request.area,
          words: found.patch.words,
        }
        entries.set(entry.n, entry)
        queued.push(entry)
      }
    }
    for (const entry of queued) void run(found, entry, picture, entries)
    return { ok: true }
  }

  return {
    async view(projectFile, id) {
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return image
      const picture = image.chosen === null ? null : await takePicture(image, image.chosen)
      const patches: PatchWorkView[] = []
      for (const patch of image.row.patches) {
        const found = patchOf(image, patch)
        // Before the board: a take that lands in between then shows as made, never as neither.
        const entries = entriesOf(found.key).filter((e) => e.base === image.chosen)
        const board = await readBoard(found)
        if ('ok' in board) return board
        const chosen = image.chosen === null ? undefined : board.chosen[String(image.chosen)]
        patches.push({
          id: patch.id,
          takes: board.takes
            .filter((t) => t.base === image.chosen)
            .map((t) => ({
              n: t.n,
              area: t.area,
              earlier: t.words !== patch.words,
              chosen: t.n === chosen,
              isNew: !t.seen,
            })),
          making: entries
            .filter((e) => e.state !== 'failed')
            .map((e) => ({
              n: e.n,
              state: e.state as 'waiting' | 'making',
              elapsed: e.state === 'making' ? Math.max(0, (now() - e.startedAt) / 1000) : 0,
              expected: imageModel(EDIT_MODEL).seconds,
              area: e.area,
            })),
          failed: entries
            .filter((e) => e.state === 'failed')
            .map((e) => ({ n: e.n, message: e.message, area: e.area })),
        })
      }
      const problem = await makerProblem()
      return {
        ok: true,
        take: picture && { n: image.chosen!, width: picture.width, height: picture.height },
        pictureGone: image.chosen !== null && picture === null,
        maker: problem === null ? { ok: true } : { ok: false, message: problem },
        patches,
      }
    },

    async make(projectFile, id, patch, request) {
      const found = await resolvePatch(projectFile, id, patch)
      if (!found || 'ok' in found) return found
      const entries = active.get(found.key) ?? new Map<number, Entry>()
      active.set(found.key, entries)
      // Taken before the first wait, so that of two requests at once only one goes on.
      const guard = 'count' in request ? found.key : `${found.key}\0${request.retry}`
      const busy = [...entries.values()].some(
        (e) => e.state !== 'failed' && e.base === found.chosen,
      )
      if (starting.has(guard) || ('count' in request && busy)) {
        return {
          ok: false,
          message: 'Takes of this patch are being made. Wait for them, or stop them.',
        }
      }
      starting.add(guard)
      try {
        return await start(found, entries, request)
      } finally {
        starting.delete(guard)
      }
    },

    async stop(projectFile, id, patch) {
      const found = await resolvePatch(projectFile, id, patch)
      if (!found || 'ok' in found) return found
      const entries = active.get(found.key)
      let stopped = 0
      for (const [n, entry] of entries ?? []) {
        if (entry.state === 'failed') continue
        entry.stop?.abort()
        entries!.delete(n)
        stopped++
      }
      return { ok: true, stopped }
    },

    async choose(projectFile, id, patch, n) {
      const found = await resolvePatch(projectFile, id, patch)
      if (!found || 'ok' in found) return found
      const outcome = await changeBoard(found, (board): ImagePatchAnswer => {
        const take = board.takes.find((t) => t.n === n)
        if (!take) return { ok: false, message: 'That take is not on the board.' }
        board.chosen[String(take.base)] = n
        take.seen = true
        return { ok: true }
      })
      return outcome
    },

    async unchoose(projectFile, id, patch) {
      const found = await resolvePatch(projectFile, id, patch)
      if (!found || 'ok' in found) return found
      if (found.chosen === null) return { ok: false, message: 'No take of the image is chosen.' }
      const base = String(found.chosen)
      return changeBoard(found, (board): ImagePatchAnswer => {
        if (!(base in board.chosen))
          return { ok: false, message: 'No take of this patch is chosen.' }
        delete board.chosen[base]
        return { ok: true }
      })
    },

    async drop(projectFile, id, patch, n) {
      const found = await resolvePatch(projectFile, id, patch)
      if (!found || 'ok' in found) return found
      const outcome = await changeBoard(found, (board): ImagePatchAnswer | { dropped: true } => {
        const take = board.takes.find((t) => t.n === n)
        if (!take) return { ok: false, message: 'That take is not on the board.' }
        if (board.chosen[String(take.base)] === n) {
          return { ok: false, message: 'That take is chosen; un-choose it first.' }
        }
        board.takes = board.takes.filter((t) => t !== take)
        return { dropped: true }
      })
      if (!outcome || !('dropped' in outcome)) return outcome
      await rm(resolveInRoot(found.root, `${found.folder}/${n}.png`), { force: true })
      return { ok: true }
    },

    async markSeen(projectFile, id, patch, n) {
      const found = await resolvePatch(projectFile, id, patch)
      if (!found || 'ok' in found) return found
      return changeBoard(found, (board): ImagePatchAnswer => {
        const take = board.takes.find((t) => t.n === n)
        if (!take) return { ok: false, message: 'That take is not on the board.' }
        take.seen = true
        return { ok: true }
      })
    },

    async takeFile(projectFile, id, patch, name) {
      if (!/^[1-9]\d*$/.test(name)) return null
      const found = await resolvePatch(projectFile, id, patch)
      if (!found || 'ok' in found) return null
      const file = resolveInRoot(found.root, `${found.folder}/${name}.png`)
      return (await Bun.file(file).exists()) ? file : null
    },
  }
}

import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  FineTuneBoardSchema,
  type FineTune,
  type FineTuneBoard,
  type FineTunesView,
  type UseFineTuneAnswer,
} from '../core/imageFineTunes'
import {
  DEFAULT_EDIT_MODEL,
  EDIT_MODEL_IDS,
  editModel,
  type EditModelId,
  type ImageDownload,
} from '../core/imageModels'
import { checkPatchArea, type PatchArea } from '../core/imagePatches'
import { fitToSize, layOver, type Pixels } from '../core/imagePixels'
import { takeSize } from '../core/imageTakes'
import { resolveInRoot } from '../core/paths'
import { CACHE_DIR, type Problem } from '../core/project'
import { figuresOf, timeKeyOfEdit } from '../core/takeTimes'
import { readResource, writeOrRefuse } from './files'
import { freeGpu, gpuQueue } from './gpu'
import { IMAGE_TAKES_DIR, readImages } from './imageLists'
import { carryImageAreas } from './imageEdits'
import { editStep } from './imageEditStep'
import { changePatchBoard, patchGameOf, patchPictureOf } from './imagePatchGame'
import { downloadOf, type ImageGenerator } from './images'
import { describeFailure, type ImageTakes } from './imageTakes'
import { gameFilePath } from './musicLists'
import { boardQueue, isSafeId } from './musicTakes'
import { decodePng, encodePng, pngSize } from './png'
import type { Serial } from './serial'
import { recordTakeTime, readTakeTimes } from './takeTimes'
import { openProject, type ProjectFailure } from './workspace'

/** What a change to an image's fine-tunes answered: done, refused with a reason, or a file that cannot be used. */
export type FineTuneAnswer = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** What to make: this many fine-tunes of the words and mark, or the failed one with this number again. */
export type FineTuneRequest =
  { count: number; words: string; area: PatchArea | null; model?: EditModelId } | { retry: number }

/** The fine-tunes of an image: pictures edited from the picture in the game, until one is used or dropped. */
export interface ImageFineTunes {
  /** What the panel shows, a project failure, or null for an image not listed. */
  view(projectFile: string, id: string): Promise<FineTunesView | ProjectFailure | null>
  /** Queues fine-tunes on the GPU queue and returns at once; null for an image not listed. */
  make(projectFile: string, id: string, request: FineTuneRequest): Promise<FineTuneAnswer>
  /** Stops the fine-tunes of the picture in the game that are waiting or being made. */
  stop(
    projectFile: string,
    id: string,
  ): Promise<{ ok: true; stopped: number } | ProjectFailure | null>
  /** Takes a fine-tune off the board (a failed one too) and deletes its picture; one waiting or being made is stopped and removed. */
  drop(projectFile: string, id: string, n: number): Promise<FineTuneAnswer>
  /** Records that a fine-tune has been laid over the picture once. */
  markSeen(projectFile: string, id: string, n: number): Promise<FineTuneAnswer>
  /** The path of a fine-tune's picture, or null for an image not listed or a name that is not a number. */
  file(projectFile: string, id: string, name: string): Promise<string | null>
  /** The picture the fine-tunes are made from, as a PNG (the game's own image fitted to the take size); null when there is none. */
  base(projectFile: string, id: string): Promise<Uint8Array | null>
  /**
   * Makes a fine-tune a new take of the image, chosen, with the named areas and chosen patches of
   * the picture it came from, and drops every fine-tune of the image.
   */
  use(
    projectFile: string,
    id: string,
    n: number,
  ): Promise<UseFineTuneAnswer | ProjectFailure | null>
}

/** A fine-tune waiting, being made, or failed, until it is made. */
interface Entry {
  n: number
  state: 'waiting' | 'making' | 'failed'
  startedAt: number
  message: string
  /** The picture it is made from: a take's number, 0 for the game's own image. */
  base: number
  model: EditModelId
  words: string
  area: PatchArea | null
  /** Ends it while it is being made (Stop). */
  stop?: AbortController
}

/** The folder of an image's fine-tunes: the studio's cache, never committed and never read by the game. */
const folderOf = (image: string) => `${CACHE_DIR}/image-fine-tunes/${image}`

/**
 * The fine-tunes of an image: the picture in the game (the chosen take, or the game's own image) is
 * edited from words, a marked area or the whole picture, with an edit model on the GPU queue, and
 * each result waits as `<folder>/<n>.png` on `<folder>/board.json` in the studio's cache until it is
 * used (it becomes a new chosen take) or dropped. What is waiting, being made or failed is kept in
 * memory.
 */
export function createImageFineTunes({
  generator,
  takes,
  queue = gpuQueue(),
  free = freeGpu,
  now = Date.now,
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
}: {
  generator: ImageGenerator
  /** The image's takes, where a used fine-tune is added and chosen. */
  takes: Pick<ImageTakes, 'addTake' | 'choose' | 'drop'>
  queue?: Serial
  /** Frees the GPU of the other workers before an edit (tests). */
  free?: () => void | Promise<void>
  now?: () => number
  newSeed?: () => number
}): ImageFineTunes {
  const shared = globalThis as { contentStudioFineTunes?: Map<string, Map<number, Entry>> }
  // Kept across `--dev` reloads, as the takes being made are.
  const active = (shared.contentStudioFineTunes ??= new Map())
  const failedModels = new Map<string, Set<EditModelId>>()
  /** Images whose new fine-tunes are being checked and queued, so a second press at once is refused. */
  const starting = new Set<string>()

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
      projectFile,
      root,
      id,
      row,
      key: `${projectFile}\0${id}`,
      folder: folderOf(id),
      board: `${folderOf(id)}/board.json`,
      /** The picture in the game: a take's number, or 0 for the game's own image. */
      base: row.chosenTake ?? 0,
    }
  }
  type Image = Exclude<Awaited<ReturnType<typeof resolve>>, ProjectFailure | null>

  async function readBoard(
    image: Pick<Image, 'root' | 'board'>,
  ): Promise<FineTuneBoard | ProjectFailure> {
    const problems: Problem[] = []
    const board = await readResource(image.root, image.board, FineTuneBoardSchema, problems)
    if (board === 'missing') return FineTuneBoardSchema.parse({})
    if (board === 'invalid') return { ok: false, file: image.board, problems }
    return board
  }

  /** Reads the board in its turn, lets `change` alter it and writes it back if it differs. */
  function changeBoard<T>(
    image: Pick<Image, 'projectFile' | 'root' | 'board' | 'id'>,
    change: (board: FineTuneBoard) => T | Promise<T>,
  ): Promise<T | ProjectFailure> {
    return boardQueue().run(`fine-tune\0${image.projectFile}\0${image.id}`, async () => {
      const board = await readBoard(image)
      if ('ok' in board) return board
      const before = JSON.stringify(board, null, 2)
      const answer = await change(board)
      const after = JSON.stringify(board, null, 2)
      if (after !== before) await writeOrRefuse(image.root, image.board, `${after}\n`)
      return answer
    })
  }

  /** The picture in the game, in the pixels fine-tunes are made in; the game's own image scaled to the take size. */
  async function pictureOf(image: Image): Promise<Pixels | null> {
    try {
      if (image.row.chosenTake !== null) {
        const path = resolveInRoot(
          image.root,
          `${IMAGE_TAKES_DIR}/${image.id}/${image.row.chosenTake}.png`,
        )
        return decodePng(new Uint8Array(await Bun.file(path).arrayBuffer()))
      }
      const own = image.row.gameFile
        ? await gameFilePath(image.root, image.row.gameFile.file)
        : null
      if (!own) return null
      return fitToSize(
        decodePng(new Uint8Array(await Bun.file(own).arrayBuffer())),
        takeSize(image.row),
      )
    } catch {
      return null
    }
  }

  /** The size of the picture in the game as `pictureOf` gives it, without decoding it; null when it cannot be read. */
  async function pictureSize(image: Image): Promise<{ width: number; height: number } | null> {
    try {
      if (image.row.chosenTake !== null) {
        const path = resolveInRoot(
          image.root,
          `${IMAGE_TAKES_DIR}/${image.id}/${image.row.chosenTake}.png`,
        )
        return pngSize(new Uint8Array(await Bun.file(path).slice(0, 33).arrayBuffer()))
      }
      const own = image.row.gameFile
        ? await gameFilePath(image.root, image.row.gameFile.file)
        : null
      return own ? takeSize(image.row) : null
    } catch {
      return null
    }
  }

  /** Why fine-tunes cannot be made on this computer, or null when they can. */
  async function makerProblem(model?: EditModelId): Promise<string | null> {
    const ready = await generator.ready()
    if (!ready.ok) return ready.message
    if (model && !(await generator.installed(model))) {
      return `${editModel(model).name} is not on this computer, and fine-tunes are made with it.`
    }
    if (generator.canEdit && !(await generator.canEdit(model))) {
      return 'This mflux cannot edit pictures. Update it with uv tool install --upgrade mflux, then start the studio again.'
    }
    return null
  }

  const entriesOf = (key: string) =>
    [...(active.get(key)?.values() ?? [])].sort((a, b) => a.n - b.n)

  /** Edits the picture and saves the result as fine-tune `entry.n`. */
  async function run(
    image: Image,
    entry: Entry,
    source: Pixels,
    entries: Map<number, Entry>,
  ): Promise<void> {
    if (entries.get(entry.n) !== entry || entry.state !== 'waiting') return
    const stop = new AbortController()
    entry.stop = stop
    const seed = newSeed() // before any await, so the fine-tunes of one press take their seeds in order
    try {
      let began: number | null = null
      const made = await editStep(
        { generator, queue, free },
        {
          root: image.root,
          cropFile: `${image.folder}/editing-${entry.n}.png`,
          source,
          area: entry.area,
          words: entry.words,
          model: entry.model,
          seed,
        },
        stop.signal,
        () => {
          entry.state = 'making'
          entry.startedAt = now()
          began = entry.startedAt
        },
      )
      if (!made) return
      // Timed from when it started making, so its wait for the GPU is not counted.
      const took = began === null ? null : (now() - began) / 1000
      const saved: FineTune = {
        n: entry.n,
        base: entry.base,
        seed: made.seed,
        words: entry.words,
        area: entry.area,
        seen: false,
        model: entry.model,
      }
      // The picture first: a fine-tune is on the board only once its file is there.
      await writeOrRefuse(image.root, `${image.folder}/${entry.n}.png`, made.png)
      const failure = await changeBoard(image, (board) => {
        if (stop.signal.aborted) return
        board.tunes = [...board.tunes.filter((t) => t.n !== saved.n), saved].sort(
          (a, b) => a.n - b.n,
        )
      })
      if (stop.signal.aborted || (failure && 'ok' in failure)) {
        await rm(resolveInRoot(image.root, `${image.folder}/${entry.n}.png`), { force: true })
        if (failure && 'ok' in failure) throw new Error(`${failure.file} cannot be used`)
        return
      }
      entries.delete(entry.n)
      failedModels.get(image.key)?.delete(entry.model)
      // A whole-picture edit takes far longer than a patch's window, so only marked ones are timed under the edit keys.
      if (took !== null && entry.area)
        await recordTakeTime(image.projectFile, timeKeyOfEdit(entry.model), took)
    } catch (error) {
      if (stop.signal.aborted) return
      const failed = failedModels.get(image.key) ?? new Set<EditModelId>()
      failed.add(entry.model)
      failedModels.set(image.key, failed)
      entry.message = describeFailure(error)
      entry.state = 'failed'
    }
  }

  /** Checks the request and queues its fine-tunes. */
  async function start(
    image: Image,
    entries: Map<number, Entry>,
    request: FineTuneRequest,
  ): Promise<FineTuneAnswer> {
    const failed = 'retry' in request ? entries.get(request.retry) : undefined
    if ('retry' in request && (failed?.state !== 'failed' || failed.base !== image.base)) {
      return {
        ok: false,
        message: `Fine-tune ${request.retry} did not fail, so it is not made again.`,
      }
    }
    const source = await pictureOf(image)
    if (!source) {
      return {
        ok: false,
        message:
          image.row.chosenTake === null
            ? "There's no picture to fine-tune yet. Make takes and choose one, then change it here."
            : "The chosen take's picture is missing or cannot be read, so it cannot be fine-tuned.",
      }
    }
    if ('count' in request && request.area) {
      const problem = checkPatchArea(request.area, source)
      if (problem) return { ok: false, message: problem }
    }
    const model = failed
      ? failed.model
      : 'model' in request && request.model
        ? request.model
        : DEFAULT_EDIT_MODEL
    const problem = await makerProblem(model)
    if (problem) return { ok: false, message: problem }
    const queued: Entry[] = []
    if (failed) {
      failed.state = 'waiting'
      queued.push(failed)
    } else if ('count' in request) {
      const first = Math.max(...[...entries.values()].map((e) => e.n + 1), 1)
      const reserved = await changeBoard(image, (board) => {
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
          base: image.base,
          model,
          words: request.words,
          area: request.area,
        }
        entries.set(entry.n, entry)
        queued.push(entry)
      }
    }
    for (const entry of queued) void run(image, entry, source, entries)
    return { ok: true }
  }

  /** Forgets every fine-tune of the image: stops what is waiting or being made, empties the board and deletes the pictures. */
  async function clear(image: Image): Promise<void> {
    const entries = active.get(image.key)
    for (const entry of entries?.values() ?? []) entry.stop?.abort()
    entries?.clear()
    const board = await changeBoard(image, (b) => {
      const gone = b.tunes.map((t) => t.n)
      b.tunes = []
      return gone
    })
    if (Array.isArray(board)) {
      for (const n of board)
        await rm(resolveInRoot(image.root, `${image.folder}/${n}.png`), { force: true })
    }
  }

  return {
    async view(projectFile, id) {
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return image
      // Before the board: a fine-tune that lands in between then shows as made, never as neither.
      const entries = entriesOf(image.key).filter((e) => e.base === image.base)
      const board = await readBoard(image)
      if ('ok' in board) return board
      const picture = await pictureSize(image)
      const figures = figuresOf(await readTakeTimes(projectFile))
      const problem = await makerProblem()
      const downloads = Object.fromEntries(
        await Promise.all(
          EDIT_MODEL_IDS.map(async (m) => [m, await downloadOf(generator, m)] as const),
        ),
      ) as Record<EditModelId, ImageDownload>
      return {
        ok: true,
        picture: !picture
          ? { kind: 'none' }
          : image.row.chosenTake !== null
            ? {
                kind: 'take',
                n: image.row.chosenTake,
                width: picture.width,
                height: picture.height,
              }
            : { kind: 'game', width: picture.width, height: picture.height },
        maker: problem === null ? { ok: true } : { ok: false, message: problem },
        models: downloads,
        tunes: board.tunes
          .filter((t) => t.base === image.base)
          .map((t) => ({ n: t.n, words: t.words, area: t.area, model: t.model, isNew: !t.seen })),
        making: entries
          .filter((e) => e.state !== 'failed')
          .map((e) => ({
            n: e.n,
            state: e.state as 'waiting' | 'making',
            elapsed: e.state === 'making' ? Math.max(0, (now() - e.startedAt) / 1000) : 0,
            expected: figures[timeKeyOfEdit(e.model)].seconds,
            model: e.model,
          })),
        failed: entries
          .filter((e) => e.state === 'failed')
          .map((e) => ({
            n: e.n,
            message: e.message,
            words: e.words,
            area: e.area,
            model: e.model,
          })),
        failedModels: EDIT_MODEL_IDS.filter((m) => failedModels.get(image.key)?.has(m)),
      } satisfies FineTunesView
    },

    async make(projectFile, id, request) {
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return image
      const entries = active.get(image.key) ?? new Map<number, Entry>()
      active.set(image.key, entries)
      // Taken before the first wait, so that of two requests at once only one goes on.
      const guard = 'count' in request ? image.key : `${image.key}\0${request.retry}`
      const busy = [...entries.values()].some((e) => e.state !== 'failed' && e.base === image.base)
      if (starting.has(guard) || ('count' in request && busy)) {
        return { ok: false, message: 'Fine-tunes are being made. Wait for them, or stop them.' }
      }
      starting.add(guard)
      try {
        return await start(image, entries, request)
      } finally {
        starting.delete(guard)
      }
    },

    async stop(projectFile, id) {
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return image
      const entries = active.get(image.key)
      let stopped = 0
      for (const [n, entry] of entries ?? []) {
        if (entry.state === 'failed' || entry.base !== image.base) continue
        entry.stop?.abort()
        entries!.delete(n)
        stopped++
      }
      return { ok: true, stopped }
    },

    async drop(projectFile, id, n) {
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return image
      const entries = active.get(image.key)
      const entry = entries?.get(n)
      // A failed one is only forgotten; one waiting or being made is stopped first, and the next waiting one starts.
      if (entry && (entry.state === 'failed' || entry.base === image.base)) {
        entry.stop?.abort()
        entries!.delete(n)
        return { ok: true }
      }
      const outcome = await changeBoard(image, (board): FineTuneAnswer | { dropped: true } => {
        const tune = board.tunes.find((t) => t.n === n)
        if (!tune) return { ok: false, message: 'That fine-tune is not on the board.' }
        board.tunes = board.tunes.filter((t) => t !== tune)
        return { dropped: true }
      })
      if (!outcome || !('dropped' in outcome)) return outcome
      await rm(resolveInRoot(image.root, `${image.folder}/${n}.png`), { force: true })
      return { ok: true }
    },

    async markSeen(projectFile, id, n) {
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return image
      return changeBoard(image, (board): FineTuneAnswer => {
        const tune = board.tunes.find((t) => t.n === n)
        if (!tune) return { ok: false, message: 'That fine-tune is not on the board.' }
        tune.seen = true
        return { ok: true }
      })
    },

    async file(projectFile, id, name) {
      if (!/^[1-9]\d*$/.test(name)) return null
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return null
      const file = resolveInRoot(image.root, `${image.folder}/${name}.png`)
      return (await Bun.file(file).exists()) ? file : null
    },

    async base(projectFile, id) {
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return null
      const pixels = await pictureOf(image)
      return pixels ? encodePng(pixels) : null
    },

    use(projectFile, id, n) {
      // One use at a time per image: a second, at once, finds the board already emptied.
      return boardQueue().run(`fine-tune-use\0${projectFile}\0${id}`, () =>
        useOne(projectFile, id, n),
      )
    },
  }

  /**
   * Gives patch `patch` its chosen take on picture `from` also on the new take `to`: the patch
   * take is copied (the picture and its game version) as a take painted on `to`, so the patch's
   * workbench shows and can choose it there. Null when the patch has none chosen on `from`.
   */
  async function carryPatch(image: Image, patch: string, from: number, to: number) {
    const where = { projectFile: image.projectFile, root: image.root, image: image.id, patch }
    const made = await changePatchBoard(where, async (b) => {
      const chosen = b.chosen[String(from)]
      const old = b.takes.find((t) => t.n === chosen)
      if (chosen === undefined || !old) return null
      const n = b.next
      for (const [source, copy] of [
        [patchPictureOf(image.id, patch, old.n), patchPictureOf(image.id, patch, n)],
        [patchGameOf(image.id, patch, old.n), patchGameOf(image.id, patch, n)],
      ] as const) {
        const bytes = await Bun.file(resolveInRoot(image.root, source))
          .bytes()
          .catch(() => null)
        if (bytes) await writeOrRefuse(image.root, copy, bytes)
      }
      b.next = n + 1
      b.takes = [...b.takes, { ...old, n, base: to }]
      b.chosen[String(to)] = n
      if (b.inGame[String(from)] !== undefined) b.inGame[String(to)] = n
      return n
    })
    return typeof made === 'number' ? { patch, n: made } : null
  }

  /** Undoes `carryPatch` for the take `to`: the copied patch take, its files and its choices. */
  async function uncarryPatch(image: Image, patch: string, n: number, to: number) {
    const where = { projectFile: image.projectFile, root: image.root, image: image.id, patch }
    await changePatchBoard(where, (b) => {
      b.takes = b.takes.filter((t) => t.n !== n)
      delete b.chosen[String(to)]
      delete b.inGame[String(to)]
    })
    for (const file of [patchPictureOf(image.id, patch, n), patchGameOf(image.id, patch, n)]) {
      await rm(resolveInRoot(image.root, file), { force: true })
    }
  }

  async function useOne(
    projectFile: string,
    id: string,
    n: number,
  ): Promise<UseFineTuneAnswer | ProjectFailure | null> {
    const image = await resolve(projectFile, id)
    if (!image || 'ok' in image) return image
    const board = await readBoard(image)
    if ('ok' in board) return board
    const tune = board.tunes.find((t) => t.n === n)
    if (!tune) return { ok: false, message: 'That fine-tune is not on the board.' }
    if (tune.base !== image.base) {
      return { ok: false, message: 'That fine-tune was made from another picture.' }
    }
    const source = await pictureOf(image)
    const part = await Bun.file(resolveInRoot(image.root, `${image.folder}/${n}.png`))
      .bytes()
      .catch(() => null)
    if (!source || !part) {
      return {
        ok: false,
        message: 'The picture of that fine-tune or the one it came from is gone.',
      }
    }
    const edited = decodePng(part)
    // A marked fine-tune keeps only what changed: the rest is the picture it was made from.
    const png = encodePng(tune.area ? layOver(source, edited) : edited)
    const from = image.row.chosenTake
    const added = await takes.addTake(projectFile, id, {
      png,
      model: editModel(tune.model).mflux,
      seed: tune.seed,
      words: tune.words,
      from,
    })
    if (!added || !added.ok) return added
    // What the picture had comes along to the new take before it is chosen, so the game gets it in the same save.
    let areas = 0
    let patches = 0
    const carriedPatches: { patch: string; n: number }[] = []
    if (from !== null) {
      const carried = await carryImageAreas(projectFile, id, from, added.n)
      if (!carried.ok) {
        await takes.drop(projectFile, id, added.n)
        return {
          ok: false,
          message: `The named areas could not be carried over: ${carried.problems[0]?.message ?? ''}`,
        }
      }
      areas = carried.areas
      for (const patch of image.row.patches) {
        const copy = await carryPatch(image, patch.id, from, added.n)
        if (copy) {
          patches++
          carriedPatches.push(copy)
        }
      }
    }
    const chosen = await takes.choose(projectFile, id, added.n)
    if (!chosen || !chosen.ok) {
      // The take is not left behind: the fine-tunes stay, and pressing again makes it once more.
      // The patch takes copied for it go too; its named-area boxes stay on the dropped take, as those of any dropped take do.
      for (const copy of carriedPatches) await uncarryPatch(image, copy.patch, copy.n, added.n)
      await takes.drop(projectFile, id, added.n)
      return chosen
    }
    await clear(image)
    return { ok: true, take: added.n, from, carried: { areas, patches } }
  }
}

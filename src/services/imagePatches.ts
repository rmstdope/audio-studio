import { rm } from 'node:fs/promises'
import { figuresOf, timeKeyOfEdit } from '../core/takeTimes'
import { readTakeTimes, recordTakeTime } from './takeTimes'
import { dirname, join } from 'node:path'
import {
  DEFAULT_EDIT_MODEL,
  EDIT_MODEL_IDS,
  editModel,
  type EditModelId,
  type ImageDownload,
} from '../core/imageModels'
import { cropPixels, editWindow, isCropped, pastePixels } from '../core/imagePixels'
import { ImageLockSchema } from '../core/images'
import { ImageManifestSchema, type ImageManifest } from '../core/imageTakes'
import {
  checkPatchArea,
  keepArea,
  matchToTake,
  planRemake,
  remakeCovered,
  tieOf,
  type ImagePatchesView,
  type RemakePressView,
  type PatchArea,
  type PatchBoard,
  type PatchTake,
  type PatchWorkView,
} from '../core/imagePatches'
import type { PatchRow } from '../core/images'
import { resolveInRoot } from '../core/paths'
import { IMAGES_LOCK_FILE } from '../core/project'
import { readResource, writeAtomic } from './files'
import { freeGpu, gpuQueue } from './gpu'
import { IMAGE_TAKES_DIR, readImages, readStyleLook } from './imageLists'
import {
  changePatchBoard,
  patchBoardKey,
  patchClipName,
  patchFolder,
  patchGameOf,
  readPatchBoard,
  renderPatchGame,
} from './imagePatchGame'
import { downloadOf, makeImageTake, type ImageGenerator } from './images'
import { describeFailure } from './imageTakes'
import { choices, sorted } from './musicClips'
import { isSafeId } from './musicTakes'
import { decodePng, encodePng, encodeTransparentPng, pngSize } from './png'
import type { Serial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** The model that made every take before there was a choice, so a board take without `model` reads as this. */
const BEFORE_CHOICE: EditModelId = 'klein'

/** The sentence saying a model's weights are not on this computer. */
const notHere = (model: EditModelId) =>
  `${editModel(model).name} is not on this computer, and patches are made with it.`

/** What a change to a patch's takes answered: done, refused with a reason, or a file that cannot be used. */
export type ImagePatchAnswer = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** What to make: this many new takes of an area, or the failed take with this number again. */
export type PatchMakeRequest =
  { count: number; area: PatchArea; model?: EditModelId } | { retry: number }

/** What a press of "Remake patches on this take" answered: the patches and takes queued, or why not. */
export type RemakeAnswer =
  | { ok: true; patches: string[]; takes: number }
  | { ok: false; message: string }
  | ProjectFailure
  | null

/** The takes of the patches the game asks for on an image. */
export interface ImagePatches {
  /** The image's patches with their takes on the chosen take, a project failure, or null for an image not listed. */
  view(
    projectFile: string,
    id: string,
    fresh?: boolean,
  ): Promise<ImagePatchesView | ProjectFailure | null>
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
  /**
   * Queues takes (1 to 4 each) for every patch that needs making again and has none on the take in
   * the game, each from the person's mark, its named area's place or the area it was chosen with.
   */
  remake(
    projectFile: string,
    id: string,
    request: { count: number; marks: Record<string, PatchArea>; model?: EditModelId },
  ): Promise<RemakeAnswer>
  /** Stops the takes of the latest press that are waiting or being made; those made stay. */
  stopRemake(
    projectFile: string,
    id: string,
  ): Promise<{ ok: true; stopped: number } | ProjectFailure | null>
  /** Forgets the latest press's summary once it has ended (Close). */
  closeRemake(projectFile: string, id: string): Promise<{ ok: true }>
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
  /** The path of a take's game version, or null for a patch not listed, a bad number or a take not brought. */
  gameFile(projectFile: string, id: string, patch: string, name: string): Promise<string | null>
}

/** A take waiting, being made, or failed, until it is made. */
interface Entry {
  n: number
  state: 'waiting' | 'making' | 'failed'
  startedAt: number
  message: string
  /** The image's take it is painted on, and that take's picture. */
  base: number
  /** The edit model it is made with, kept for making it again. */
  model: EditModelId
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
  // Takes being brought to the look right now (`<patch key>\0<n>`), kept across `--dev` reloads.
  const bringing = ((
    globalThis as { contentStudioPatchBringing?: Set<string> }
  ).contentStudioPatchBringing ??= new Set())
  // The latest press of each image (`<project file>\0<image>`): the takes it queued, by patch.
  const presses = ((
    globalThis as {
      contentStudioPatchRemakes?: Map<
        string,
        { base: number; model: EditModelId; takes: Map<string, number[]> }
      >
    }
  ).contentStudioPatchRemakes ??= new Map())
  // The edit models whose last take of a patch failed (`<patch key>`), until one of theirs works.
  const failedModels = ((
    globalThis as { contentStudioPatchFailedModels?: Map<string, Set<EditModelId>> }
  ).contentStudioPatchFailedModels ??= new Map())
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
    if (!row) return null
    const style = await readStyleLook(root)
    return {
      projectFile,
      root,
      id,
      row,
      chosen: row.chosenTake,
      look: style.look,
      config: opened.project.images,
    }
  }
  type Image = Exclude<Awaited<ReturnType<typeof resolve>>, ProjectFailure | null>

  /** An image with one of the patches the game lists on it, and where the patch keeps its takes. */
  const patchOf = (image: Image, patch: PatchRow) => ({
    ...image,
    patch,
    key: patchBoardKey(image.projectFile, image.id, patch.id),
    folder: patchFolder(image.id, patch.id),
    board: `${patchFolder(image.id, patch.id)}/board.json`,
    patchId: patch.id,
  })

  /** The image and one of the patches the game lists on it, or null / a failure. */
  async function resolvePatch(projectFile: string, id: string, patch: string) {
    const image = await resolve(projectFile, id)
    if (!image || 'ok' in image) return image
    const row = image.row.patches.find((p) => p.id === patch)
    return row && isSafeId(patch) ? patchOf(image, row) : null
  }
  type Found = Exclude<Awaited<ReturnType<typeof resolvePatch>>, ProjectFailure | null>

  const readBoard = (found: Pick<Found, 'root' | 'id' | 'patchId'>) =>
    readPatchBoard(found.root, found.id, found.patchId)

  const changeBoard = <T>(
    found: Pick<Found, 'projectFile' | 'root' | 'id' | 'patchId'>,
    change: (board: PatchBoard) => T | Promise<T>,
  ) =>
    changePatchBoard(
      { projectFile: found.projectFile, root: found.root, image: found.id, patch: found.patchId },
      change,
    )

  /** The images manifest as it is: empty if there is none; null if it cannot be read. */
  async function manifestNow(found: Pick<Found, 'root' | 'config'>): Promise<ImageManifest | null> {
    const read = await readResource(found.root, found.config.manifest, ImageManifestSchema, [])
    return read === 'invalid' ? null : read === 'missing' ? {} : read
  }

  const writeManifest = (found: Pick<Found, 'root' | 'config'>, manifest: ImageManifest) =>
    writeAtomic(found.root, found.config.manifest, `${JSON.stringify(sorted(manifest), null, 2)}\n`)

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
  async function makerProblem(model?: EditModelId): Promise<string | null> {
    const ready = await generator.ready()
    if (!ready.ok) return ready.message
    if (model && !(await generator.installed(model))) return notHere(model)
    if (generator.canEdit && !(await generator.canEdit(model))) {
      return 'This mflux cannot edit pictures. Update it with uv tool install --upgrade mflux, then start the studio again.'
    }
    return null
  }

  const entriesOf = (key: string) =>
    [...(active.get(key)?.values() ?? [])].sort((a, b) => a.n - b.n)

  /** Brings a take just made to the look and notes it on the board; a take that cannot be stays as the model made it. */
  async function bringTake(found: Found, n: number, base: number): Promise<void> {
    const mark = `${found.key}\0${n}`
    try {
      const key = found.row.look.key
      if (!key || !found.look) return
      const made = await renderPatchGame(
        { root: found.root, image: found.id, patch: found.patchId, base, n },
        found.look,
        found.row,
      )
      if ('error' in made) return
      await changeBoard(found, (board) => {
        const take = board.takes.find((t) => t.n === n)
        if (take) take.look = key
      })
    } finally {
      bringing.delete(mark)
    }
  }

  /** Edits a window of the image take around the marked area and saves the marked area as take `entry.n`. */
  async function run(
    found: Found,
    entry: Entry,
    take: { path: string; width: number; height: number },
    entries: Map<number, Entry>,
  ): Promise<void> {
    if (entries.get(entry.n) !== entry || entry.state !== 'waiting') return
    const stop = new AbortController()
    entry.stop = stop
    const seed = newSeed() // before any await, so the takes of one press take their seeds in order
    const window = editWindow(entry.area, take)
    const cropFile = `${found.folder}/editing-${entry.n}.png`
    try {
      const around = decodePng(new Uint8Array(await Bun.file(take.path).arrayBuffer()))
      // The model gets the marked area with some context, not the whole picture: faster, and the
      // thing to change is larger in its view.
      await writeAtomic(found.root, cropFile, encodePng(cropPixels(around, window)))
      let began: number | null = null
      const made = await makeImageTake(
        { generator, queue, free },
        {
          prompt: entry.words,
          width: window.width,
          height: window.height,
          seed,
          model: entry.model,
          editing: resolveInRoot(found.root, cropFile),
        },
        stop.signal,
        () => {
          entry.state = 'making'
          entry.startedAt = now()
          began = entry.startedAt
        },
      )
      if (stop.signal.aborted) return
      // Timed from when the take started making, so its wait for the GPU is not counted.
      const took = began === null ? null : (now() - began) / 1000
      const part = decodePng(made.png)
      if (part.width !== window.width || part.height !== window.height) {
        throw new Error(
          `The edited picture came back at ${part.width} × ${part.height} instead of ${window.width} × ${window.height}.`,
        )
      }
      // The colours are matched in the window, where the model's drift is all there is to see:
      // laid into the whole take, everything outside the window would read as no drift at all.
      const inside = { ...entry.area, x: entry.area.x - window.x, y: entry.area.y - window.y }
      const kept = keepArea(matchToTake(part, cropPixels(around, window), inside), inside)
      const blank = {
        width: take.width,
        height: take.height,
        data: new Uint8Array(take.width * take.height * 4),
      }
      const png = encodeTransparentPng(pastePixels(blank, kept, window))
      const saved: PatchTake = {
        n: entry.n,
        base: entry.base,
        seed: made.seed,
        words: entry.words,
        area: entry.area,
        seen: false,
        model: entry.model,
      }
      // The picture first: a take is on the board only once its file is there.
      await writeAtomic(found.root, `${found.folder}/${entry.n}.png`, png)
      // Marked before it is on the board, so the page never sees it between made and brought.
      bringing.add(`${found.key}\0${entry.n}`)
      const failure = await changeBoard(found, (board) => {
        if (stop.signal.aborted) return
        board.takes = [...board.takes.filter((t) => t.n !== saved.n), saved].sort(
          (a, b) => a.n - b.n,
        )
      })
      if (stop.signal.aborted || (failure && 'ok' in failure)) {
        bringing.delete(`${found.key}\0${entry.n}`)
        await rm(resolveInRoot(found.root, `${found.folder}/${entry.n}.png`), { force: true })
        if (failure && 'ok' in failure) throw new Error(`${failure.file} cannot be used`)
        return
      }
      entries.delete(entry.n)
      failedModels.get(found.key)?.delete(entry.model)
      if (took !== null) await recordTakeTime(found.projectFile, timeKeyOfEdit(entry.model), took)
      await bringTake(found, entry.n, entry.base)
    } catch (error) {
      if (stop.signal.aborted) return
      // The model is marked first, so a view never shows the failed take without its model's warning.
      const failed = failedModels.get(found.key) ?? new Set<EditModelId>()
      failed.add(entry.model)
      failedModels.set(found.key, failed)
      entry.message = describeFailure(error)
      entry.state = 'failed'
    } finally {
      await rm(resolveInRoot(found.root, cropFile), { force: true })
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
          model,
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

  /** Each patch's takes on the chosen take, and the area of its earlier choice; a failure when a board cannot be read. */
  async function workOf(image: Image) {
    const figures = figuresOf(await readTakeTimes(image.projectFile))
    const patches: PatchWorkView[] = []
    const earlier: Record<string, PatchArea> = {}
    for (const patch of image.row.patches) {
      const found = patchOf(image, patch)
      // Before the board: a take that lands in between then shows as made, never as neither.
      const entries = entriesOf(found.key).filter((e) => e.base === image.chosen)
      const board = await readBoard(found)
      if ('ok' in board) return board
      // The take chosen on the newest other take of the image that is still on the board.
      const was = Object.keys(board.chosen)
        .map(Number)
        .filter((base) => base !== image.chosen)
        .sort((a, b) => b - a)
        .map((base) => board.takes.find((t) => t.n === board.chosen[String(base)]))
        .find((t) => t !== undefined)
      if (was) earlier[patch.id] = was.area
      const chosen = image.chosen === null ? undefined : board.chosen[String(image.chosen)]
      const key = image.row.look.key
      const takes: PatchWorkView['takes'] = []
      for (const t of board.takes.filter((t) => t.base === image.chosen)) {
        takes.push({
          n: t.n,
          area: t.area,
          earlier: t.words !== patch.words,
          chosen: t.n === chosen,
          isNew: !t.seen,
          model: t.model ?? BEFORE_CHOICE,
          look: bringing.has(`${found.key}\0${t.n}`)
            ? 'bringing'
            : !(await Bun.file(
                  resolveInRoot(image.root, patchGameOf(image.id, patch.id, t.n)),
                ).exists())
              ? 'missing'
              : t.look === key
                ? 'ready'
                : 'old',
        })
      }
      const inGame = image.chosen === null ? undefined : board.inGame[String(image.chosen)]
      patches.push({
        id: patch.id,
        takes,
        oldLook:
          key !== null &&
          inGame !== undefined &&
          board.takes.find((t) => t.n === inGame)?.look !== key,
        making: entries
          .filter((e) => e.state !== 'failed')
          .map((e) => ({
            n: e.n,
            state: e.state as 'waiting' | 'making',
            elapsed: e.state === 'making' ? Math.max(0, (now() - e.startedAt) / 1000) : 0,
            expected: figures[timeKeyOfEdit(e.model)].seconds,
            area: e.area,
            model: e.model,
          })),
        failed: entries
          .filter((e) => e.state === 'failed')
          .map((e) => ({ n: e.n, message: e.message, area: e.area, model: e.model })),
        failedModels: EDIT_MODEL_IDS.filter((m) => failedModels.get(found.key)?.has(m)),
      })
    }
    return { work: patches, earlier }
  }

  /** The latest press of the image as the page shows it; null when there is none. */
  async function pressOf(
    image: Pick<Image, 'projectFile' | 'id' | 'root'>,
  ): Promise<RemakePressView | ProjectFailure | null> {
    const press = presses.get(`${image.projectFile}\0${image.id}`)
    if (!press) return null
    const figures = figuresOf(await readTakeTimes(image.projectFile))
    let total = 0
    let made = 0
    let running = 0
    let left = 0
    let failedTakes = 0
    const failed: string[] = []
    for (const [patch, ns] of press.takes) {
      const entries = active.get(patchBoardKey(image.projectFile, image.id, patch))
      const board = await readPatchBoard(image.root, image.id, patch)
      if ('ok' in board) return board
      total += ns.length
      for (const n of ns) {
        const entry = entries?.get(n)
        if (entry?.state === 'failed') {
          failedTakes++
          if (!failed.includes(patch)) failed.push(patch)
        } else if (entry) {
          running++
          const { seconds } = figures[timeKeyOfEdit(entry.model)]
          left +=
            entry.state === 'making'
              ? Math.max(0, seconds - (now() - entry.startedAt) / 1000)
              : seconds
        } else if (board.takes.some((t) => t.n === n && t.base === press.base)) made++
      }
    }
    return {
      total,
      ids: [...press.takes.keys()],
      failedTakes,
      made,
      stopped: total - made - running - failedTakes,
      failed,
      running: running > 0,
      left: Math.round(left),
      model: press.model,
    }
  }

  return {
    async view(projectFile, id, fresh = false) {
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return image
      // A page that has just loaded does not get a finished summary back (only Close keeps it until then).
      if (fresh && !(await pressOf(image).then((p) => !!p && 'running' in p && p.running))) {
        presses.delete(`${projectFile}\0${id}`)
      }
      const picture = image.chosen === null ? null : await takePicture(image, image.chosen)
      const got = await workOf(image)
      if ('ok' in got) return got
      const press = await pressOf(image)
      if (press && 'ok' in press) return press
      const problem = await makerProblem()
      const downloads = Object.fromEntries(
        await Promise.all(
          EDIT_MODEL_IDS.map(async (id) => [id, await downloadOf(generator, id)] as const),
        ),
      ) as Record<EditModelId, ImageDownload>
      const lock = await readResource(image.root, IMAGES_LOCK_FILE, ImageLockSchema, [])
      return {
        ok: true,
        take: picture && {
          n: image.chosen!,
          width: picture.width,
          height: picture.height,
          cropped: isCropped(picture, image.row),
        },
        game: { width: image.row.width, height: image.row.height },
        lookError: image.row.look.error,
        lookKey: image.row.look.key,
        lockUnread: lock === 'invalid',
        pictureGone: image.chosen !== null && picture === null,
        maker: problem === null ? { ok: true } : { ok: false, message: problem },
        models: downloads,
        patches: got.work,
        remake: {
          earlier: got.earlier,
          press,
          failedModels: EDIT_MODEL_IDS.filter((m) =>
            got.work.some((p) => p.failedModels.includes(m)),
          ),
        },
      }
    },

    async remake(projectFile, id, request) {
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return image
      const got = await workOf(image)
      if ('ok' in got) return got
      const covered = remakeCovered(image.row, got.work)
      if (covered.length === 0) {
        return { ok: false, message: 'No patch needs making again on this take.' }
      }
      const picture = image.chosen === null ? null : await takePicture(image, image.chosen)
      if (!picture) {
        return {
          ok: false,
          message:
            "The chosen take's picture is missing or cannot be read, so it cannot be patched.",
        }
      }
      const plan = planRemake(
        covered.map((patch) => ({
          id: patch.id,
          title: patch.title,
          mark: request.marks[patch.id] ?? null,
          tie: tieOf(image.row, patch),
          earlier: got.earlier[patch.id] ?? null,
        })),
        image.row,
        picture,
      )
      if (plan.make.length === 0) {
        return { ok: false, message: 'None of the patches has an area to make it from.' }
      }
      const base = image.chosen!
      const model = request.model ?? DEFAULT_EDIT_MODEL
      const takes = new Map<string, number[]>()
      const undo = () => {
        for (const [patch, ns] of takes) {
          const entries = active.get(patchOf(image, { id: patch } as PatchRow).key)
          for (const n of ns) {
            entries?.get(n)?.stop?.abort()
            entries?.delete(n)
          }
        }
      }
      for (const { id: patch, area } of plan.make) {
        const found = patchOf(
          image,
          image.row.patches.find((p) => p.id === patch)!,
        )
        const entries = active.get(found.key) ?? new Map<number, Entry>()
        active.set(found.key, entries)
        if (starting.has(found.key)) {
          undo()
          return {
            ok: false,
            message: 'Takes of this patch are being made. Wait for them, or stop them.',
          }
        }
        starting.add(found.key)
        const before = new Set(entries.keys())
        try {
          const answer = await start(found, entries, { count: request.count, area, model })
          if (!answer || !answer.ok) {
            undo()
            return answer
          }
        } catch (error) {
          // A board that cannot be written leaves nothing of this press queued.
          undo()
          throw error
        } finally {
          starting.delete(found.key)
        }
        takes.set(
          patch,
          [...entries.keys()].filter((n) => !before.has(n)),
        )
      }
      presses.set(`${projectFile}\0${id}`, { base, model, takes })
      return {
        ok: true,
        patches: plan.make.map((m) => m.id),
        takes: plan.make.length * request.count,
      }
    },

    async stopRemake(projectFile, id) {
      const image = await resolve(projectFile, id)
      if (!image || 'ok' in image) return image
      const press = presses.get(`${projectFile}\0${id}`)
      let stopped = 0
      for (const [patch, ns] of press?.takes ?? []) {
        const entries = active.get(patchBoardKey(projectFile, id, patch))
        for (const n of ns) {
          const entry = entries?.get(n)
          if (!entry || entry.state === 'failed') continue
          entry.stop?.abort()
          entries!.delete(n)
          stopped++
        }
      }
      return { ok: true, stopped }
    },

    async closeRemake(projectFile, id) {
      const key = `${projectFile}\0${id}`
      const press = presses.get(key)
      const now = press ? await pressOf({ projectFile, id, root: dirname(projectFile) }) : null
      if (press && !(now && !('ok' in now) && now.running)) presses.delete(key)
      return { ok: true }
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
      return changeBoard(found, async (board): Promise<ImagePatchAnswer> => {
        const take = board.takes.find((t) => t.n === n)
        if (!take) return { ok: false, message: 'That take is not on the board.' }
        if (take.base !== found.chosen) {
          return { ok: false, message: 'That take was made on another take of the image.' }
        }
        const key = found.row.look.key
        if (!key || !found.look) {
          return { ok: false, message: found.row.look.error ?? "The game's look cannot be used." }
        }
        // The game gets the take brought to the look: the stored version, or made now when its look is old.
        const stored =
          take.look === key
            ? await Bun.file(resolveInRoot(found.root, patchGameOf(id, patch, n)))
                .bytes()
                .catch(() => null)
            : null
        const png =
          stored ??
          (await renderPatchGame(
            { root: found.root, image: id, patch, base: take.base, n },
            found.look,
            found.row,
          ))
        if ('error' in png) {
          return {
            ok: false,
            message:
              png.error === 'missing'
                ? 'That take’s picture is gone, so it cannot be chosen.'
                : `Take ${n} could not be brought to the game's look: ${png.error}`,
          }
        }
        const answer = await choices().run(
          `image-choice\0${projectFile}`,
          async (): Promise<ImagePatchAnswer> => {
            const manifest = await manifestNow(found)
            if (!manifest) {
              return {
                ok: false,
                message: `The game's picture for ${id} could not be changed: the images manifest could not be read. Nothing was changed.`,
              }
            }
            const entry = manifest[id]
            if (!entry) {
              return {
                ok: false,
                message: `The game has no picture for ${id} yet. Choose a take of the image first.`,
              }
            }
            const file = patchClipName(id, patch)
            await writeAtomic(found.root, join(found.config.clips, file), png)
            const listed = { ...(entry.patches as Record<string, unknown> | undefined) }
            listed[patch] = { file, width: found.row.width, height: found.row.height }
            manifest[id] = { ...entry, patches: sorted(listed) }
            await writeManifest(found, manifest)
            return { ok: true }
          },
        )
        if (!answer || !answer.ok) return answer
        board.chosen[String(take.base)] = n
        board.inGame[String(take.base)] = n
        take.seen = true
        take.look = key
        return { ok: true }
      })
    },

    async unchoose(projectFile, id, patch) {
      const found = await resolvePatch(projectFile, id, patch)
      if (!found || 'ok' in found) return found
      if (found.chosen === null) return { ok: false, message: 'No take of the image is chosen.' }
      const base = String(found.chosen)
      return changeBoard(found, async (board): Promise<ImagePatchAnswer> => {
        if (!(base in board.chosen))
          return { ok: false, message: 'No take of this patch is chosen.' }
        // The game first, the board last: pressing again finishes what stopped halfway.
        const answer = await choices().run(
          `image-choice\0${projectFile}`,
          async (): Promise<ImagePatchAnswer> => {
            const manifest = await manifestNow(found)
            if (!manifest) return { ok: false, message: 'The images manifest could not be read.' }
            const entry = manifest[id]
            if (entry?.patches && patch in (entry.patches as Record<string, unknown>)) {
              const { [patch]: _gone, ...rest } = entry.patches as Record<string, unknown>
              const { patches: _all, ...others } = entry
              manifest[id] = Object.keys(rest).length ? { ...others, patches: rest } : others
              await writeManifest(found, manifest)
            }
            await rm(
              resolveInRoot(found.root, join(found.config.clips, patchClipName(id, patch))),
              {
                force: true,
              },
            )
            return { ok: true }
          },
        )
        if (!answer || !answer.ok) return answer
        delete board.chosen[base]
        delete board.inGame[base]
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
      await rm(resolveInRoot(found.root, patchGameOf(id, patch, n)), { force: true })
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

    async gameFile(projectFile, id, patch, name) {
      if (!/^[1-9]\d*$/.test(name)) return null
      const found = await resolvePatch(projectFile, id, patch)
      if (!found || 'ok' in found) return null
      const file = resolveInRoot(found.root, patchGameOf(id, patch, Number(name)))
      return (await Bun.file(file).exists()) ? file : null
    },
  }
}

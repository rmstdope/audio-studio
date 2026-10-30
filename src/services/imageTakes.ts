import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODEL_IDS,
  defaultTakeModel,
  imageByMflux,
  imageModel,
  type ImageModelId,
} from '../core/imageModels'
import { bringToLook, isCropped } from '../core/imagePixels'
import {
  ImageBoardSchema,
  ImageLockFileSchema,
  ImageManifestSchema,
  takeIsEarlier,
  takeSize,
  type ImageBoard,
  type ImageBoardTake,
  type ImageFailedView,
  type ImageLockFile,
  type ImageMakingSummary,
  type ImageMakingView,
  type ImageManifest,
  type ImageTakesView,
  type LookRunView,
  type ImageTakeView,
} from '../core/imageTakes'
import type { ChosenEntry, ImageRow } from '../core/images'
import { resolveInRoot } from '../core/paths'
import type { Problem } from '../core/project'
import { readResource, writeAtomic } from './files'
import { freeGpu, gpuQueue } from './gpu'
import { IMAGE_BOARD_DIR, IMAGE_TAKES_DIR, readImages, readStyleLook } from './imageLists'
import { makeImageTake, type ImageGenerator } from './images'
import { decodePng, encodePng } from './png'
import { choices, sorted } from './musicClips'
import { gameFilePath } from './musicLists'
import { boardQueue, isSafeId } from './musicTakes'
import type { Serial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

export { IMAGE_BOARD_DIR, IMAGE_TAKES_DIR }

/** What a change to takes answered: done, refused with a reason, or a file that cannot be used. */
export type ImageTakesAnswer = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** An image's takes as the page shows them, a project failure, or null for an image the project does not list. */
export type ImageTakesResult = ImageTakesView | ProjectFailure | null

/** What to make: this many new takes, or the failed take with this number again. */
export type ImageMakeRequest = { count: number; model?: ImageModelId } | { retry: number }

/** A take waiting, being made, or failed, until it is made. */
interface Entry {
  n: number
  state: 'waiting' | 'making' | 'failed'
  startedAt: number
  message: string
  /** The model it is made with. */
  model: ImageModelId
  /** Ends the take while it is being made (Stop). */
  stop?: AbortController
}

/** What the takes of an image are made of. */
export interface ImageTakes {
  /** The image's board and the takes being made. */
  view(projectFile: string, id: string): Promise<ImageTakesResult>
  /** Queues takes on the GPU queue and returns at once; they are made one at a time. */
  make(projectFile: string, id: string, request: ImageMakeRequest): Promise<ImageTakesAnswer>
  /** Stops the image's takes: the one being made ends and is discarded, the waiting ones never start. */
  stop(
    projectFile: string,
    id: string,
  ): Promise<{ ok: true; stopped: number } | ProjectFailure | null>
  /** Makes a take the image the game uses: its picture, the manifest entry, then the lock. */
  choose(projectFile: string, id: string, n: number): Promise<ImageTakesAnswer>
  /** Takes the chosen take back: the manifest entry, the picture, then the lock entry; the take stays. */
  unchoose(projectFile: string, id: string): Promise<ImageTakesAnswer>
  /** Takes a take off the board and deletes its picture; the chosen take stays. */
  drop(projectFile: string, id: string, n: number): Promise<ImageTakesAnswer>
  /** Brings every image and take with an old look to the game's look now, from the model's stored pictures. */
  bringAll(projectFile: string): Promise<ImageTakesAnswer>
  /** The run that brings pictures to a new look, as the page polls it; null when none is to be shown. */
  lookRun(projectFile: string): LookRunView | null
  /** Records that a take has been shown on the right once. */
  markSeen(projectFile: string, id: string, n: number): Promise<ImageTakesAnswer>
  /** What is being made in the project, by image, for the lists' status. */
  making(projectFile: string): Promise<Record<string, ImageMakingSummary>>
  /** The path of a take's game version, or null for an image not listed, a bad number or a take not brought. */
  gameFile(projectFile: string, id: string, name: string): Promise<string | null>
  /** The path of a take's picture, or null for an image not listed or a name that is not a take's number. */
  takeFile(projectFile: string, id: string, name: string): Promise<string | null>
  /** The picture the game shows now: the chosen one, else the game's own file, else null. */
  currentFile(projectFile: string, id: string): Promise<string | null>
}

/** A take's picture, relative to the project root. */
const pictureOf = (id: string, n: number) => `${IMAGE_TAKES_DIR}/${id}/${n}.png`

/** The answer to asking for a model whose weights are not on this computer. */
const notHere = (model: ImageModelId): { ok: false; message: string } => ({
  ok: false,
  message: `${imageModel(model).name} is not on this computer. Setup says how to download it.`,
})

/** A take's game version, relative to the project root: the model's picture brought to the look. */
const gameOf = (id: string, n: number) => `${IMAGE_TAKES_DIR}/${id}/${n}.game.png`

/** The reason a generator gave, as a sentence. */
function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/**
 * The takes of the game's images: made by `generator` on the GPU `queue` (shared with music and
 * Whisper), and kept on a board per image in `.content-studio/images/<id>.json`, the pictures in
 * `.content-studio/image-takes/<id>/<n>.png`. Takes waiting, being made and failed are kept in memory
 * per image, for the page to poll; a take made is a file and a board entry. Choosing writes the
 * game's picture, manifest entry and lock entry.
 */
export function createImageTakes({
  generator,
  queue = gpuQueue(),
  free = freeGpu,
  now = Date.now,
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
}: {
  generator: ImageGenerator
  queue?: Serial
  /** Frees the GPU of the other workers before a take (tests). */
  free?: () => void | Promise<void>
  now?: () => number
  newSeed?: () => number
}): ImageTakes {
  const shared = globalThis as {
    audioStudioImageTakes?: Map<string, Map<number, Entry>>
    audioStudioImageBringing?: Set<string>
    audioStudioLookRuns?: Map<string, LookRunView>
  }
  const active = (shared.audioStudioImageTakes ??= new Map())
  /** Takes being brought to the look right now (`<image key>\0<n>`). */
  const bringing = (shared.audioStudioImageBringing ??= new Set())
  const lookRuns = (shared.audioStudioLookRuns ??= new Map())
  const boards = boardQueue()

  async function resolve(projectFile: string, id: string) {
    if (!isSafeId(id)) return null
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { project } = opened
    const root = dirname(projectFile)
    if (!project.images) return null
    const summary = await readImages(root, project, [])
    const row = summary?.acts.flatMap((act) => act.rows).find((r) => r.id === id)
    if (!row) return null
    const style = await readStyleLook(root, project.images.paths.style)
    return {
      projectFile,
      look: style.look,
      root,
      id,
      config: project.images,
      row,
      key: `${projectFile}\0${id}`,
      board: `${IMAGE_BOARD_DIR}/${id}.json`,
    }
  }
  type Found = Exclude<Awaited<ReturnType<typeof resolve>>, ProjectFailure | null>

  const turn = (found: Found) => `image\0${found.key}`

  /** Every image model, and whether this computer has its weights. */
  async function installedModels() {
    return Promise.all(
      IMAGE_MODEL_IDS.map(async (id) => ({ id, installed: await generator.installed(id) })),
    )
  }

  async function readBoard(found: Found): Promise<ImageBoard | ProjectFailure> {
    const problems: Problem[] = []
    const board = await readResource(found.root, found.board, ImageBoardSchema, problems)
    if (board === 'missing') return { next: 1, takes: [] }
    if (board === 'invalid') return { ok: false, file: found.board, problems }
    return board
  }

  function changeBoard<T>(
    found: Found,
    change: (board: ImageBoard) => T | Promise<T>,
  ): Promise<T | ProjectFailure> {
    return boards.run(turn(found), async () => {
      const board = await readBoard(found)
      if ('ok' in board) return board
      const before = JSON.stringify(board, null, 2)
      const answer = await change(board)
      const after = JSON.stringify(board, null, 2)
      if (after !== before) await writeAtomic(found.root, found.board, `${after}\n`)
      return answer
    })
  }

  /** The lock as it is: empty if there is none; null (with the problems added) if broken. */
  async function lockNow(found: Found, problems: Problem[]): Promise<ImageLockFile | null> {
    const read = await readResource(
      found.root,
      found.config.paths.lock,
      ImageLockFileSchema,
      problems,
    )
    return read === 'invalid' ? null : read === 'missing' ? { images: {} } : read
  }

  async function manifestNow(found: Found, problems: Problem[]): Promise<ImageManifest | null> {
    const read = await readResource(
      found.root,
      found.config.paths.manifest,
      ImageManifestSchema,
      problems,
    )
    return read === 'invalid' ? null : read === 'missing' ? {} : read
  }

  /** The lock as text: its keys as they were, the images one per line. */
  function formatLock(lock: ImageLockFile): string {
    const parts = Object.keys(lock)
      .sort()
      .map((key) => [key, lock[key]] as const)
      .map(([key, value]) => {
        if (key !== 'images') return ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`
        const entries = sorted(lock.images)
        const lines = Object.keys(entries).map(
          (id) => `  ${JSON.stringify(id)}: ${JSON.stringify(entries[id])}`,
        )
        return ` "images": ${lines.length ? `{\n${lines.join(',\n')}\n }` : '{}'}`
      })
    return `{\n${parts.join(',\n')}\n}\n`
  }

  const entriesOf = (key: string) =>
    [...(active.get(key)?.values() ?? [])].sort((a, b) => a.n - b.n)

  /**
   * Makes the game show `png` for the image: the picture in the clips folder, the manifest entry
   * (the listed size) and last the lock entry. `entry` makes the lock's chosen entry from the
   * previous one, or returns null when there is nothing to change. Nothing is written when the
   * manifest or the lock cannot be read.
   */
  async function publish(
    found: Found,
    png: Uint8Array,
    entry: (previous: ChosenEntry | undefined) => ChosenEntry | null,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const { id } = found
    return choices().run(`image-choice\0${found.projectFile}`, async () => {
      const problems: Problem[] = []
      const manifest = await manifestNow(found, problems)
      const lock = await lockNow(found, problems)
      if (!manifest || !lock) {
        const unread = !manifest ? 'manifest' : 'lock'
        return {
          ok: false as const,
          message: `The game's picture for ${id} could not be changed: the images ${unread} could not be read. Nothing was changed.`,
        }
      }
      const next = entry(lock.images[id]?.chosen)
      if (!next) return { ok: true as const }
      const file = `${id}.png`
      manifest[id] = { file, width: found.row.width, height: found.row.height }
      lock.images[id] = { ...lock.images[id], chosen: next }
      await writeAtomic(found.root, join(found.config.paths.clips, file), png)
      await writeAtomic(
        found.root,
        found.config.paths.manifest,
        `${JSON.stringify(sorted(manifest), null, 2)}\n`,
      )
      await writeAtomic(found.root, found.config.paths.lock, formatLock(lock))
      return { ok: true as const }
    })
  }

  /**
   * The game's version of take `n`: the model's stored picture brought to the look, written beside
   * it. Returns the PNG, or the sentence saying why it could not be made ('missing' when the model's
   * picture is gone). It changes no board.
   */
  async function renderGame(found: Found, n: number): Promise<Uint8Array | { error: string }> {
    if (!found.look) return { error: found.row.look.error ?? "The game's look cannot be used." }
    let source: Uint8Array
    try {
      source = new Uint8Array(
        await Bun.file(resolveInRoot(found.root, pictureOf(found.id, n))).arrayBuffer(),
      )
    } catch {
      return { error: 'missing' }
    }
    try {
      const png = encodePng(bringToLook(decodePng(source), found.look, found.row))
      await writeAtomic(found.root, gameOf(found.id, n), png)
      return png
    } catch (error) {
      return { error: describeFailure(error) }
    }
  }

  /** Brings a take just made to the look and notes it on the board; a take that cannot be stays as the model made it. */
  async function bringTake(found: Found, n: number): Promise<void> {
    const key = found.row.look.key
    const mark = `${found.key}\0${n}`
    try {
      if (!key) return
      const made = await renderGame(found, n)
      if ('error' in made) return
      await changeBoard(found, (board) => {
        const take = board.takes.find((t) => t.n === n)
        if (take) take.look = key
      })
    } finally {
      bringing.delete(mark)
    }
  }

  async function run(
    found: Found,
    entry: Entry,
    request: { prompt: string; madeFrom: ImageRow['madeFrom'] },
    entries: Map<number, Entry>,
  ): Promise<void> {
    if (entries.get(entry.n) !== entry || entry.state !== 'waiting') return
    const stop = new AbortController()
    entry.stop = stop
    try {
      const size = takeSize(found.row)
      const model = imageModel(entry.model)
      const made = await makeImageTake(
        { generator, queue, free },
        { prompt: request.prompt, ...size, seed: newSeed(), model: entry.model },
        stop.signal,
        () => {
          entry.state = 'making'
          entry.startedAt = now()
        },
      )
      if (stop.signal.aborted) return
      const take: ImageBoardTake = {
        n: entry.n,
        seed: made.seed,
        model: model.mflux,
        ...size,
        madeFrom: request.madeFrom,
        seen: false,
      }
      // The picture first: a take is on the board only once its file is there.
      await writeAtomic(found.root, pictureOf(found.id, take.n), made.png)
      // Marked before it is on the board, so the page never sees it between made and brought.
      bringing.add(`${found.key}\0${take.n}`)
      const saved = await changeBoard(found, (board) => {
        if (stop.signal.aborted) return
        board.takes = [...board.takes.filter((t) => t.n !== take.n), take].sort((a, b) => a.n - b.n)
      })
      if (stop.signal.aborted) {
        bringing.delete(`${found.key}\0${take.n}`)
        await rm(resolveInRoot(found.root, pictureOf(found.id, take.n)), { force: true })
        return
      }
      if (saved && 'ok' in saved) {
        bringing.delete(`${found.key}\0${take.n}`)
        await rm(resolveInRoot(found.root, pictureOf(found.id, take.n)), { force: true })
        throw new Error(`${saved.file} cannot be used`)
      }
      entries.delete(entry.n)
      await bringTake(found, take.n)
    } catch (error) {
      if (stop.signal.aborted) return
      entry.state = 'failed'
      entry.message = describeFailure(error)
    }
  }

  /** Brings one image's takes and its chosen picture to the look now; null when done, else why not. */
  async function bringImage(projectFile: string, id: string): Promise<string | null> {
    const found = await resolve(projectFile, id)
    if (!found || !('row' in found)) return 'the image is not in the game any more'
    const key = found.row.look.key
    if (!key) return found.row.look.error ?? "the game's look cannot be used"
    const outcome = await boards.run(turn(found), async (): Promise<string | null> => {
      const board = await readBoard(found)
      if ('ok' in board) return `${board.file} cannot be used`
      const problems: Problem[] = []
      const lock = await lockNow(found, problems)
      const chosen = lock?.images[id]?.chosen
      // A take that cannot be brought keeps the board's note of those before it, and the image
      // stays old (so is tried again) through its chosen picture or its unbrought take.
      let failure: string | null = null
      let chosenPng: Uint8Array | null = null
      for (const take of board.takes) {
        const exists = await Bun.file(resolveInRoot(found.root, pictureOf(id, take.n))).exists()
        if (!exists && take.n !== chosen?.take) continue
        const there = await Bun.file(resolveInRoot(found.root, gameOf(id, take.n))).exists()
        if (take.look === key && there && take.n !== chosen?.take) continue
        const made = await renderGame(found, take.n)
        if ('error' in made) {
          failure ??= made.error
          continue
        }
        take.look = key
        if (take.n === chosen?.take) chosenPng = made
      }
      await writeAtomic(found.root, found.board, `${JSON.stringify(board, null, 2)}\n`)
      if (failure) return failure
      if (chosen && chosen.look !== key) {
        if (!chosenPng) return 'missing'
        const answer = await publish(found, chosenPng, (previous) =>
          previous && previous.look !== key ? { ...previous, look: key } : null,
        )
        if (!answer.ok) return answer.message
      }
      return null
    })
    return outcome
  }

  return {
    async view(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      const entries = entriesOf(found.key)
      const board = await readBoard(found)
      if ('ok' in board) return board
      const problems: Problem[] = []
      const lock = await lockNow(found, problems)
      const chosen = lock?.images[id]?.chosen?.take
      const takes: ImageTakeView[] = []
      for (const take of board.takes) {
        if (!(await Bun.file(resolveInRoot(found.root, pictureOf(id, take.n))).exists())) continue
        takes.push({
          n: take.n,
          width: take.width,
          height: take.height,
          model: imageByMflux(take.model),
          earlier: takeIsEarlier(take.madeFrom, found.row.words),
          chosen: chosen === take.n,
          isNew: !take.seen,
          look: bringing.has(`${found.key}\0${take.n}`)
            ? 'bringing'
            : !(await Bun.file(resolveInRoot(found.root, gameOf(id, take.n))).exists())
              ? 'missing'
              : take.look === found.row.look.key
                ? 'ready'
                : 'old',
          cropped: isCropped(take, found.row),
        })
      }
      const making: ImageMakingView[] = entries
        .filter((e) => e.state !== 'failed' && !takes.some((t) => t.n === e.n))
        .map((e) => ({
          n: e.n,
          state: e.state as 'waiting' | 'making',
          elapsed: e.state === 'making' ? Math.max(0, (now() - e.startedAt) / 1000) : 0,
          expected: imageModel(e.model).seconds,
        }))
      const failed: ImageFailedView[] = entries
        .filter((e) => e.state === 'failed')
        .map((e) => ({ n: e.n, message: e.message }))
      const models = await installedModels()
      const mflux = await generator.ready()
      return {
        ok: true,
        generator: !mflux.ok
          ? mflux
          : models.some((m) => m.installed)
            ? mflux
            : {
                ok: false,
                message: 'Neither image model is on this computer.',
                fix: 'See Setup for how to download them.',
              },
        projectModel: found.config.model ?? DEFAULT_IMAGE_MODEL,
        models,
        takes,
        making,
        failed,
        lockUnread: lock === null,
        lookError: found.row.look.error,
      }
    },

    async make(projectFile, id, request) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      const ready = await generator.ready()
      if (!ready.ok) return { ok: false, message: ready.message }
      const entries = active.get(found.key) ?? new Map<number, Entry>()
      active.set(found.key, entries)
      const queued: Entry[] = []
      if ('retry' in request) {
        const failed = entries.get(request.retry)
        if (!failed || failed.state !== 'failed') {
          return {
            ok: false,
            message: `Take ${request.retry} did not fail, so it is not made again.`,
          }
        }
        if (!(await generator.installed(failed.model))) return notHere(failed.model)
        failed.state = 'waiting'
        queued.push(failed)
      } else {
        const installed = Object.fromEntries(
          (await installedModels()).map((m) => [m.id, m.installed]),
        ) as Record<ImageModelId, boolean>
        const model =
          request.model ?? defaultTakeModel(found.config.model ?? DEFAULT_IMAGE_MODEL, installed)
        if (!installed[model]) return notHere(model)
        // The numbers are reserved at once, so none is used twice, even by a take that fails or is stopped.
        const reserved = await changeBoard(found, (board) => {
          const first = Math.max(board.next, ...[...entries.values()].map((e) => e.n + 1))
          board.next = first + request.count
          return first
        })
        if (typeof reserved !== 'number') return reserved
        for (let i = 0; i < request.count; i++) {
          const entry: Entry = {
            n: reserved + i,
            state: 'waiting',
            startedAt: 0,
            message: '',
            model,
          }
          entries.set(entry.n, entry)
          queued.push(entry)
        }
      }
      const asked = { prompt: found.row.prompt, madeFrom: found.row.madeFrom }
      for (const entry of queued) void run(found, entry, asked, entries)
      return { ok: true }
    },

    async stop(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
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

    async choose(projectFile, id, n) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      return boards.run(turn(found), async (): Promise<ImageTakesAnswer> => {
        const board = await readBoard(found)
        if ('ok' in board) return board
        const take = board.takes.find((t) => t.n === n)
        if (!take) return { ok: false, message: 'That take is not on the board.' }
        const key = found.row.look.key
        if (!key)
          return { ok: false, message: found.row.look.error ?? "The game's look cannot be used." }
        // The game gets the take brought to the look: the stored version, or made now when its look is old.
        const stored =
          take.look === key
            ? await Bun.file(resolveInRoot(found.root, gameOf(id, n)))
                .bytes()
                .catch(() => null)
            : null
        const png = stored ?? (await renderGame(found, n))
        if ('error' in png) {
          return {
            ok: false,
            message:
              png.error === 'missing'
                ? 'That take’s picture is gone, so it cannot be chosen.'
                : `Take ${n} could not be brought to the game's look: ${png.error}`,
          }
        }
        const answer = await publish(found, png, (previous) =>
          previous?.take === n && previous.look === key
            ? null
            : {
                ...take.madeFrom,
                take: take.n,
                seed: take.seed,
                model: take.model,
                look: key,
                at: new Date(now()).toISOString(),
              },
        )
        if (!answer.ok) return answer
        if (!take.seen || take.look !== key) {
          take.seen = true
          take.look = key
          await writeAtomic(found.root, found.board, `${JSON.stringify(board, null, 2)}\n`)
        }
        return { ok: true }
      })
    },

    async unchoose(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      return boards.run(turn(found), () =>
        choices().run(`image-choice\0${projectFile}`, async (): Promise<ImageTakesAnswer> => {
          const problems: Problem[] = []
          const manifest = await manifestNow(found, problems)
          const lock = await lockNow(found, problems)
          if (!manifest) return { ok: false, message: 'The images manifest could not be read.' }
          if (!lock) return { ok: false, message: 'The images lock could not be read.' }
          if (!lock.images[id]?.chosen)
            return { ok: false, message: 'No take is chosen for this image.' }
          if (id in manifest) {
            delete manifest[id]
            await writeAtomic(
              found.root,
              found.config.paths.manifest,
              `${JSON.stringify(sorted(manifest), null, 2)}\n`,
            )
          }
          await rm(resolveInRoot(found.root, join(found.config.paths.clips, `${id}.png`)), {
            force: true,
          })
          const { chosen: _chosen, ...rest } = lock.images[id]!
          if (Object.keys(rest).length) lock.images[id] = rest
          else delete lock.images[id]
          await writeAtomic(found.root, found.config.paths.lock, formatLock(lock))
          return { ok: true }
        }),
      )
    },

    async drop(projectFile, id, n) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      const outcome = await changeBoard(
        found,
        async (board): Promise<ImageTakesAnswer | { dropped: ImageBoardTake }> => {
          const problems: Problem[] = []
          const lock = await lockNow(found, problems)
          if (!lock) return { ok: false, file: found.config.paths.lock, problems }
          const take = board.takes.find((t) => t.n === n)
          if (!take) return { ok: false, message: 'That take is not on the board.' }
          if (lock.images[id]?.chosen?.take === n) {
            return { ok: false, message: 'That take is the one in the game; choose another first.' }
          }
          board.takes = board.takes.filter((t) => t !== take)
          return { dropped: take }
        },
      )
      if (!outcome || !('dropped' in outcome)) return outcome
      await rm(resolveInRoot(found.root, pictureOf(id, n)), { force: true })
      await rm(resolveInRoot(found.root, gameOf(id, n)), { force: true })
      return { ok: true }
    },

    async markSeen(projectFile, id, n) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      const outcome = await changeBoard(found, (board): ImageTakesAnswer => {
        const take = board.takes.find((t) => t.n === n)
        if (!take) return { ok: false, message: 'That take is not on the board.' }
        take.seen = true
        return { ok: true }
      })
      return outcome
    },

    async making(projectFile) {
      const summary: Record<string, ImageMakingSummary> = {}
      const prefix = `${projectFile}\0`
      for (const [key, entries] of active) {
        if (!key.startsWith(prefix)) continue
        let takes = 0
        let left = 0
        for (const entry of entries.values()) {
          if (entry.state === 'failed') continue
          takes++
          const { seconds } = imageModel(entry.model)
          left +=
            entry.state === 'waiting'
              ? seconds
              : Math.max(0, seconds - (now() - entry.startedAt) / 1000)
        }
        if (takes) summary[key.slice(prefix.length)] = { takes, left }
      }
      return summary
    },

    async gameFile(projectFile, id, name) {
      if (!/^[1-9]\d*$/.test(name)) return null
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return null
      const file = resolveInRoot(found.root, gameOf(id, Number(name)))
      return (await Bun.file(file).exists()) ? file : null
    },

    lookRun(projectFile) {
      return lookRuns.get(projectFile) ?? null
    },

    async bringAll(projectFile) {
      if (lookRuns.get(projectFile)?.running) {
        return { ok: false, message: 'Images are already being brought to the new look.' }
      }
      // The slot is taken before anything is awaited, so a second press cannot start a second run.
      const run: LookRunView = { running: true, total: 0, done: 0, failed: [] }
      lookRuns.set(projectFile, run)
      const release = () => {
        if (lookRuns.get(projectFile) === run) lookRuns.delete(projectFile)
      }
      const opened = await openProject(projectFile).catch((error) => {
        release()
        throw error
      })
      if (!opened.ok || !opened.project.images) {
        release()
        return opened.ok ? null : opened
      }
      const summary = await readImages(dirname(projectFile), opened.project, [])
      const ids = (summary?.acts ?? [])
        .flatMap((act) => act.rows)
        .filter((r) => r.looksOld)
        .map((r) => r.id)
      if (!ids.length) {
        release()
        return { ok: true }
      }
      run.total = ids.length
      void (async () => {
        for (const id of ids) {
          try {
            const failure = await bringImage(projectFile, id)
            if (failure) run.failed.push({ id, reason: failure })
          } catch (error) {
            run.failed.push({ id, reason: describeFailure(error) })
          }
          run.done++
        }
        run.running = false
        if (!run.failed.length) release()
      })()
      return { ok: true }
    },

    async takeFile(projectFile, id, name) {
      if (!/^[1-9]\d*$/.test(name)) return null
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return null
      const file = resolveInRoot(found.root, pictureOf(id, Number(name)))
      return (await Bun.file(file).exists()) ? file : null
    },

    async currentFile(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return null
      const problems: Problem[] = []
      const lock = await lockNow(found, problems)
      if (lock?.images[id]?.chosen) {
        const clip = resolveInRoot(found.root, join(found.config.paths.clips, `${id}.png`))
        return (await Bun.file(clip).exists()) ? clip : null
      }
      // While the lock cannot be read, what the game shows is not known.
      if (!lock) return null
      return found.row.gameFile ? gameFilePath(found.root, found.row.gameFile.file) : null
    },
  }
}

import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DEFAULT_IMAGE_MODEL, imageModel } from '../core/imageModels'
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
  type ImageTakeView,
} from '../core/imageTakes'
import type { ImageRow } from '../core/images'
import { resolveInRoot } from '../core/paths'
import type { Problem } from '../core/project'
import { readResource, writeAtomic } from './files'
import { freeGpu, gpuQueue } from './gpu'
import { readImages } from './imageLists'
import { makeImageTake, type ImageGenerator } from './images'
import { choices, sorted } from './musicClips'
import { gameFilePath } from './musicLists'
import { boardQueue, isSafeId } from './musicTakes'
import type { Serial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** Where an image's takes are cached, one folder per image, `<n>.png` each. */
export const IMAGE_TAKES_DIR = '.audio-studio/image-takes'

/** Where an image's board is saved: one file per image (an id is a slug, so a safe file name). */
export const IMAGE_BOARD_DIR = '.audio-studio/images'

/** What a change to takes answered: done, refused with a reason, or a file that cannot be used. */
export type ImageTakesAnswer = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** An image's takes as the page shows them, a project failure, or null for an image the project does not list. */
export type ImageTakesResult = ImageTakesView | ProjectFailure | null

/** What to make: this many new takes, or the failed take with this number again. */
export type ImageMakeRequest = { count: number } | { retry: number }

/** A take waiting, being made, or failed, until it is made. */
interface Entry {
  n: number
  state: 'waiting' | 'making' | 'failed'
  startedAt: number
  message: string
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
  /** Records that a take has been shown on the right once. */
  markSeen(projectFile: string, id: string, n: number): Promise<ImageTakesAnswer>
  /** What is being made in the project, by image, for the lists' status. */
  making(projectFile: string): Promise<Record<string, ImageMakingSummary>>
  /** The path of a take's picture, or null for an image not listed or a name that is not a take's number. */
  takeFile(projectFile: string, id: string, name: string): Promise<string | null>
  /** The picture the game shows now: the chosen one, else the game's own file, else null. */
  currentFile(projectFile: string, id: string): Promise<string | null>
}

/** A take's picture, relative to the project root. */
const pictureOf = (id: string, n: number) => `${IMAGE_TAKES_DIR}/${id}/${n}.png`

/** The reason a generator gave, as a sentence. */
function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/**
 * The takes of the game's images: made by `generator` on the GPU `queue` (shared with music and
 * Whisper), and kept on a board per image in `.audio-studio/images/<id>.json`, the pictures in
 * `.audio-studio/image-takes/<id>/<n>.png`. Takes waiting, being made and failed are kept in memory
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
  const shared = globalThis as { audioStudioImageTakes?: Map<string, Map<number, Entry>> }
  const active = (shared.audioStudioImageTakes ??= new Map())
  const boards = boardQueue()
  const model = imageModel(DEFAULT_IMAGE_MODEL)

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
    return {
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
    const parts = Object.entries(lock).map(([key, value]) => {
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
      const made = await makeImageTake(
        { generator, queue, free },
        { prompt: request.prompt, ...size, seed: newSeed(), model: DEFAULT_IMAGE_MODEL },
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
      const saved = await changeBoard(found, (board) => {
        if (stop.signal.aborted) return
        board.takes = [...board.takes.filter((t) => t.n !== take.n), take].sort((a, b) => a.n - b.n)
      })
      if (stop.signal.aborted) {
        await rm(resolveInRoot(found.root, pictureOf(found.id, take.n)), { force: true })
        return
      }
      if (saved && 'ok' in saved) throw new Error(`${saved.file} cannot be used`)
      entries.delete(entry.n)
    } catch (error) {
      if (stop.signal.aborted) return
      entry.state = 'failed'
      entry.message = describeFailure(error)
    }
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
        if (!(await Bun.file(join(found.root, pictureOf(id, take.n))).exists())) continue
        takes.push({
          n: take.n,
          width: take.width,
          height: take.height,
          earlier: takeIsEarlier(take.madeFrom, found.row.words),
          chosen: chosen === take.n,
          isNew: !take.seen,
        })
      }
      const making: ImageMakingView[] = entries
        .filter((e) => e.state !== 'failed' && !takes.some((t) => t.n === e.n))
        .map((e) => ({
          n: e.n,
          state: e.state as 'waiting' | 'making',
          elapsed: e.state === 'making' ? Math.max(0, (now() - e.startedAt) / 1000) : 0,
          expected: model.seconds,
        }))
      const failed: ImageFailedView[] = entries
        .filter((e) => e.state === 'failed')
        .map((e) => ({ n: e.n, message: e.message }))
      return {
        ok: true,
        generator: await generator.ready(),
        takes,
        making,
        failed,
        lockUnread: lock === null,
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
        failed.state = 'waiting'
        queued.push(failed)
      } else {
        // The numbers are reserved at once, so none is used twice, even by a take that fails or is stopped.
        const reserved = await changeBoard(found, (board) => {
          const first = Math.max(board.next, ...[...entries.values()].map((e) => e.n + 1))
          board.next = first + request.count
          return first
        })
        if (typeof reserved !== 'number') return reserved
        for (let i = 0; i < request.count; i++) {
          const entry: Entry = { n: reserved + i, state: 'waiting', startedAt: 0, message: '' }
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
        let png: Uint8Array
        try {
          png = new Uint8Array(await Bun.file(join(found.root, pictureOf(id, n))).arrayBuffer())
        } catch {
          return { ok: false, message: 'That take’s picture is gone, so it cannot be chosen.' }
        }
        const file = `${id}.png`
        return choices().run(
          `image-choice\0${projectFile}`,
          async (): Promise<ImageTakesAnswer> => {
            const problems: Problem[] = []
            const manifest = await manifestNow(found, problems)
            const lock = await lockNow(found, problems)
            if (!manifest || !lock) {
              const unread = !manifest ? 'manifest' : 'lock'
              return {
                ok: false,
                message: `Take ${n} could not be chosen: the images ${unread} could not be read. Nothing was changed.`,
              }
            }
            manifest[id] = { file, width: take.width, height: take.height }
            lock.images[id] = {
              ...lock.images[id],
              chosen: {
                ...take.madeFrom,
                take: take.n,
                seed: take.seed,
                model: take.model,
                at: new Date(now()).toISOString(),
              },
            }
            await writeAtomic(found.root, join(found.config.paths.clips, file), png)
            await writeAtomic(
              found.root,
              found.config.paths.manifest,
              `${JSON.stringify(sorted(manifest), null, 2)}\n`,
            )
            await writeAtomic(found.root, found.config.paths.lock, formatLock(lock))
            if (!take.seen) {
              take.seen = true
              await writeAtomic(found.root, found.board, `${JSON.stringify(board, null, 2)}\n`)
            }
            return { ok: true }
          },
        )
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
          left +=
            entry.state === 'waiting'
              ? model.seconds
              : Math.max(0, model.seconds - (now() - entry.startedAt) / 1000)
        }
        if (takes) summary[key.slice(prefix.length)] = { takes, left }
      }
      return summary
    },

    async takeFile(projectFile, id, name) {
      if (!/^[1-9]\d*$/.test(name)) return null
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return null
      const file = join(found.root, pictureOf(id, Number(name)))
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

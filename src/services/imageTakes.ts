import { rm } from 'node:fs/promises'
import { figuresOf } from '../core/takeTimes'
import { readTakeTimes, recordTakeTime } from './takeTimes'
import { dirname, join } from 'node:path'
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODEL_IDS,
  defaultTakeModel,
  imageByMflux,
  imageModel,
  type ImageModelId,
  type ImageModelState,
} from '../core/imageModels'
import { planImagesMakeAll, TAKES_EACH } from '../core/imagesMakeAll'
import { bringToLook, isCropped } from '../core/imagePixels'
import {
  ImageBoardSchema,
  ImageManifestSchema,
  takeIsEarlier,
  takeSize,
  type ImageBoard,
  type ImageBoardTake,
  type ImageFailedView,
  type ImageMakingSummary,
  type ImageMakingView,
  type ImageManifest,
  type ImageTakesView,
  type LookRunView,
  type ImageTakeView,
} from '../core/imageTakes'
import {
  ImageLockSchema,
  acceptableReasons,
  areaFractions,
  areaFractionsOn,
  withAreas,
  formatImageLock,
  outOfDateReasons,
  type ChosenEntry,
  type ImageLock,
  type ImageRow,
} from '../core/images'
import { resolveInRoot } from '../core/paths'
import { IMAGES_LOCK_FILE, type Problem } from '../core/project'
import { readResource, writeAtomic } from './files'
import { freeGpu, gpuQueue } from './gpu'
import { IMAGE_BOARD_DIR, IMAGE_TAKES_DIR, readImages, readStyleLook } from './imageLists'
import { adoptImageAreas } from './imageEdits'
import { createImageHealth, type ImageHealthStore } from './imageHealth'
import { downloadOf, ImageToolError, makeImageTake, type ImageGenerator } from './images'
import {
  patchesInGame,
  type ManifestPatch,
  changePatchBoard,
  patchPictureOf,
  patchGameOf,
  renderPatchGame,
} from './imagePatchGame'
import { decodePng, encodePng, pngSize } from './png'
import { choices, sorted } from './musicClips'
import { gameFilePath } from './musicLists'
import { boardQueue, isSafeId } from './musicTakes'
import type { Serial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

export { IMAGE_BOARD_DIR, IMAGE_TAKES_DIR }

/** The refusal for boxes that could not be moved onto a take: the edits file's own message. */
function notAdopted(
  answer: { ok: false } & ({ problems: Problem[] } | { file: string; problems: Problem[] }),
) {
  return {
    ok: false as const,
    message: `The named areas could not be kept: ${answer.problems[0]?.message ?? 'the images edits cannot be used'}.`,
  }
}

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

/** A fine-tuned take to add to an image's board. */
export interface AddedTake {
  png: Uint8Array
  /** The `--model` name of the model that edited it. */
  model: string
  seed: number
  /** The words of the fine-tune. */
  words: string
  /** The take it was fine-tuned from; null for the game's own image. */
  from: number | null
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
  /**
   * Adds a take that was not made from the prompt, a fine-tune: its picture as the next number
   * and the board entry, made from the same words and style as the take it was fine-tuned from
   * (the image's own now when that is the game's own image). Null for an image not listed.
   */
  addTake(
    projectFile: string,
    id: string,
    made: AddedTake,
  ): Promise<{ ok: true; n: number } | ProjectFailure | null>
  /** Makes a take the image the game uses: its picture, the manifest entry, then the lock. */
  choose(projectFile: string, id: string, n: number): Promise<ImageTakesAnswer>
  /** Takes the chosen take back: the manifest entry, the picture, then the lock entry; the take stays. */
  unchoose(projectFile: string, id: string): Promise<ImageTakesAnswer>
  /**
   * Accepts changed words or style: the chosen take counts as made from the image's words and
   * style now, and the image is up to date with the same picture. A changed size is refused.
   */
  accept(projectFile: string, id: string): Promise<ImageTakesAnswer>
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
  /** Setup's image model, each model's state, and whether images can be made at all. */
  modelState(projectFile: string): Promise<ImageModelStateResult>
  /**
   * Makes four takes for every image of the act with no chosen take that is not making takes, on
   * Setup's model (the other when that is unusable). Nothing is made when any image is refused;
   * null for an act the project does not list.
   */
  makeAll(projectFile: string, actId: string): Promise<ImageMakeAllAnswer>
  /** The latest press on the act, kept until Close, a hand start or a new press; null when none. */
  batch(projectFile: string, actId: string): Promise<ImagesBatch | null>
  /** Forgets the act's finished press (Close); one that still runs is not forgotten. */
  closeBatch(projectFile: string, actId: string): Promise<{ ok: true }>
  /** Stops the takes waiting or being made of every image in the act (how many); null for an act not listed. */
  stopAll(
    projectFile: string,
    actId: string,
  ): Promise<{ ok: true; stopped: number } | ProjectFailure | null>
  /** The path of a take's game version, or null for an image not listed, a bad number or a take not brought. */
  gameFile(projectFile: string, id: string, name: string): Promise<string | null>
  /** The path of a take's picture, or null for an image not listed or a name that is not a take's number. */
  takeFile(projectFile: string, id: string, name: string): Promise<string | null>
  /** The picture the game shows now: the chosen one, else the game's own file, else null. */
  currentFile(projectFile: string, id: string): Promise<string | null>
}

/**
 * What one press of Make takes on an act remembers: how many takes the server queued, for which
 * images, and for each of those how many of its takes had failed and been stopped before the
 * press; `running` while any of them still has a take waiting or being made.
 */
export interface ImagesBatch {
  total: number
  images: string[]
  failedBefore: Record<string, number>
  stoppedBefore: Record<string, number>
  running: boolean
}

/** A press as the studio keeps it: `members` are all the act's images, whose hand starts end it. */
interface StoredBatch extends Omit<ImagesBatch, 'running'> {
  members: string[]
}

/** What a press on an act answered: the images and takes it queued, or why nothing was made. */
export type ImageMakeAllAnswer =
  | { ok: true; images: string[]; takes: number }
  | { ok: false; message: string }
  | ProjectFailure
  | null

/** Setup's image model and the state of each, as the Images pages need them to plan a press. */
export type ImageModelStateResult =
  | {
      ok: true
      main: ImageModelId
      ready: boolean
      states: Record<ImageModelId, ImageModelState>
    }
  | ProjectFailure

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
export function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/**
 * The takes of the game's images: made by `generator` on the GPU `queue` (shared with music and
 * Whisper), and kept on a board per image in `content-studio/cache/images/<id>.json`, the pictures in
 * `content-studio/cache/image-takes/<id>/<n>.png`. Takes waiting, being made and failed are kept in memory
 * per image, for the page to poll; a take made is a file and a board entry. Choosing writes the
 * game's picture, manifest entry and lock entry.
 */
export function createImageTakes({
  generator,
  queue = gpuQueue(),
  free = freeGpu,
  now = Date.now,
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
  health = createImageHealth(),
}: {
  generator: ImageGenerator
  queue?: Serial
  /** Frees the GPU of the other workers before a take (tests). */
  free?: () => void | Promise<void>
  now?: () => number
  newSeed?: () => number
  /** Where the models whose last take failed are remembered (tests). */
  health?: ImageHealthStore
}): ImageTakes {
  const shared = globalThis as {
    contentStudioImageTakes?: Map<string, Map<number, Entry>>
    contentStudioImageBringing?: Set<string>
    contentStudioLookRuns?: Map<string, LookRunView>
    contentStudioImageStopped?: Map<string, number>
    contentStudioImageBatches?: Map<string, StoredBatch>
  }
  const active = (shared.contentStudioImageTakes ??= new Map())
  /** Takes being brought to the look right now (`<image key>\0<n>`). */
  const bringing = (shared.contentStudioImageBringing ??= new Set())
  const lookRuns = (shared.contentStudioLookRuns ??= new Map())
  /** How many takes of each image were stopped since the studio started (`<image key>`). */
  const stoppedCount = (shared.contentStudioImageStopped ??= new Map())
  // The latest press of each act (`<project file>\0<act id>`), so every tab shows its summary.
  const batches = (shared.contentStudioImageBatches ??= new Map())
  // Set while Make all starts its own takes, which are not hand starts.
  let pressing = false
  const boards = boardQueue()

  /** Whether any take of the press is still waiting or being made. */
  const pressRunning = (projectFile: string, press: StoredBatch) =>
    press.images.some((id) =>
      [...(active.get(`${projectFile}\0${id}`)?.values() ?? [])].some((e) => e.state !== 'failed'),
    )

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
    const style = await readStyleLook(root)
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
      IMAGE_MODEL_IDS.map(async (id) => {
        const download = await downloadOf(generator, id)
        return { id, installed: download === 'whole', download }
      }),
    )
  }

  /** Every image model's download and whether its last take failed. */
  async function modelStates(projectFile: string) {
    const failures = await health.read(projectFile)
    const states = {} as Record<ImageModelId, ImageModelState>
    for (const m of await installedModels())
      states[m.id] = { download: m.download, failed: Boolean(failures[m.id]) }
    return states
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
  async function lockNow(found: Found, problems: Problem[]): Promise<ImageLock | null> {
    const read = await readResource(found.root, IMAGES_LOCK_FILE, ImageLockSchema, problems)
    return read === 'invalid' ? null : read === 'missing' ? {} : read
  }

  async function manifestNow(found: Found, problems: Problem[]): Promise<ImageManifest | null> {
    const read = await readResource(
      found.root,
      found.config.manifest,
      ImageManifestSchema,
      problems,
    )
    return read === 'invalid' ? null : read === 'missing' ? {} : read
  }

  /** What a take of a model is expected to take (seconds), as timed on this computer. */
  const secondsFor = async (projectFile: string) => {
    const figures = figuresOf(await readTakeTimes(projectFile))
    return (model: ImageModelId) => figures[model].seconds
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
    png: Uint8Array | null,
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
      const next = entry(lock[id])
      if (!next && !manifest[id]) return { ok: true as const }
      // The patches the game gets are those chosen on the take the game shows: choosing another
      // take takes the others out of the list in this same save (their pictures stay in the folder).
      const take = (next ?? lock[id])?.take
      const patches: Record<string, ManifestPatch> =
        take === undefined
          ? {}
          : await patchesInGame(
              { root: found.root, clips: found.config.clips, row: found.row },
              take,
            )
      // A patch the game stopped asking for stays in the list, as the image's own entry would.
      const declared = new Set(found.row.patches.map((patch) => patch.id))
      for (const [patch, listedPatch] of Object.entries(
        (manifest[id]?.patches ?? {}) as Record<string, ManifestPatch>,
      )) {
        if (!declared.has(patch)) patches[patch] = listedPatch
      }
      const file = `${id}.png`
      // The boxes read again in the turn: one placed since `found` was read is what the game gets.
      const fresh = await resolve(found.projectFile, id)
      const row = fresh && 'row' in fresh ? fresh.row : found.row
      const listed = withAreas(
        {
          file,
          width: found.row.width,
          height: found.row.height,
          ...(Object.keys(patches).length ? { patches } : {}),
        },
        take === undefined ? areaFractions(row.areas, row) : areaFractionsOn(row.areas, take, row),
      )
      if (!next && JSON.stringify(manifest[id]) === JSON.stringify(listed)) {
        return { ok: true as const }
      }
      manifest[id] = listed
      if (next && png) {
        lock[id] = next
        await writeAtomic(found.root, join(found.config.clips, file), png)
      }
      await writeAtomic(
        found.root,
        found.config.manifest,
        `${JSON.stringify(sorted(manifest), null, 2)}\n`,
      )
      if (next && png) await writeAtomic(found.root, IMAGES_LOCK_FILE, formatImageLock(lock))
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
      let began: number | null = null
      const made = await makeImageTake(
        { generator, queue, free },
        { prompt: request.prompt, ...size, seed: newSeed(), model: entry.model },
        stop.signal,
        () => {
          entry.state = 'making'
          entry.startedAt = now()
          began = entry.startedAt
        },
      ).catch(async (error: unknown) => {
        // Only a take the model failed to make is the model's failure; saving it is not.
        if (!stop.signal.aborted) {
          const message = describeFailure(error)
          const line = error instanceof ImageToolError ? error.lastLine.trim() : ''
          await health
            .record(found.projectFile, entry.model, {
              image: found.id,
              take: entry.n,
              error: line || message,
            })
            .catch(() => {})
        }
        throw error
      })
      if (stop.signal.aborted) return
      // Timed from when the take started making, so its wait for the GPU is not counted.
      const took = began === null ? null : (now() - began) / 1000
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
      if (took !== null) await recordTakeTime(found.projectFile, entry.model, took)
      await health.clear(found.projectFile, entry.model).catch(() => {})
      await bringTake(found, take.n)
    } catch (error) {
      if (stop.signal.aborted) return
      entry.state = 'failed'
      entry.message = describeFailure(error)
    }
  }

  /**
   * Brings every take of the image's patches to the look now, from the model's stored pictures (a
   * take whose picture is gone is skipped unless the game has it). The reason the first one could
   * not be brought, naming its patch; null when all were.
   */
  async function bringPatches(found: Found, key: string): Promise<string | null> {
    if (!found.look) return null
    const look = found.look
    let failure: string | null = null
    for (const patch of found.row.patches) {
      const where = {
        projectFile: found.projectFile,
        root: found.root,
        image: found.id,
        patch: patch.id,
      }
      const problem = await changePatchBoard(where, async (board) => {
        const inGame = new Set(Object.values(board.inGame))
        let problem: string | null = null
        for (const take of board.takes) {
          const exists = await Bun.file(
            resolveInRoot(found.root, patchPictureOf(found.id, patch.id, take.n)),
          ).exists()
          if (!exists && !inGame.has(take.n)) continue
          // A take painted on an image take that was dropped has nothing to be brought from.
          const painted = await Bun.file(
            resolveInRoot(found.root, `${IMAGE_TAKES_DIR}/${found.id}/${take.base}.png`),
          ).exists()
          if (!painted && !inGame.has(take.n)) continue
          const there = await Bun.file(
            resolveInRoot(found.root, patchGameOf(found.id, patch.id, take.n)),
          ).exists()
          if (take.look === key && there) continue
          const made = await renderPatchGame(
            { root: found.root, image: found.id, patch: patch.id, base: take.base, n: take.n },
            look,
            found.row,
          )
          if ('error' in made) {
            problem ??=
              made.error === 'missing'
                ? `the model's picture of its patch "${patch.title}" is missing`
                : `its patch "${patch.title}" ${made.error}`
            continue
          }
          take.look = key
        }
        return problem
      })
      if (typeof problem === 'string') failure ??= problem
    }
    return failure
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
      const chosen = lock?.[id]
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
      const patchFailure = await bringPatches(found, key)
      if (chosen && chosen.look !== key) {
        if (!chosenPng) return 'missing'
        const answer = await publish(found, chosenPng, (previous) =>
          previous && previous.look !== key ? { ...previous, look: key } : null,
        )
        if (!answer.ok) return answer.message
      } else if (chosen) {
        // The patches in the game are written again from their new versions.
        const answer = await publish(found, null, () => null)
        if (!answer.ok) return answer.message
      }
      return patchFailure
    })
    return outcome
  }

  /** An act of the project's images with the project's main model, or null when it is not listed. */
  async function actOf(projectFile: string, actId: string) {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { project } = opened
    if (!project.images) return null
    const summary = await readImages(dirname(projectFile), project, [])
    const act = summary?.acts.find((a) => a.id === actId)
    return act ? { act, main: project.images.model ?? DEFAULT_IMAGE_MODEL } : null
  }

  async function modelState(projectFile: string): Promise<ImageModelStateResult> {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const ready = await generator.ready()
    const states = await modelStates(projectFile)
    return {
      ok: true,
      main: opened.project.images?.model ?? DEFAULT_IMAGE_MODEL,
      ready: ready.ok,
      states,
    }
  }

  return {
    modelState,

    async makeAll(projectFile, actId) {
      const found = await actOf(projectFile, actId)
      if (!found || !('act' in found)) return found
      const state = await modelState(projectFile)
      if (!('states' in state)) return state
      const plan = planImagesMakeAll({
        rows: found.act.rows,
        conflicts: found.act.conflicts,
        making: await this.making(projectFile),
        main: state.main,
        states: state.states,
        ready: state.ready,
        figures: figuresOf(await readTakeTimes(projectFile)),
      })
      if (plan.kind === 'not-ready') {
        return { ok: false, message: "Images can't be made yet. Setup says what is missing." }
      }
      if (plan.kind === 'lock-unread') {
        return { ok: false, message: 'The images lock could not be read. Nothing was started.' }
      }
      if (plan.kind === 'all-chosen') return { ok: true, images: [], takes: 0 }
      const started: string[] = []
      const before = await this.making(projectFile)
      for (const image of plan.images) {
        pressing = true
        const answer = await this.make(projectFile, image.id, {
          count: TAKES_EACH,
          model: plan.model,
        }).finally(() => (pressing = false))
        if (!answer || !answer.ok) {
          for (const id of started) await this.stop(projectFile, id)
          return answer ?? { ok: false, message: `${image.title} is not in the game any more.` }
        }
        started.push(image.id)
      }
      batches.set(`${projectFile}\0${actId}`, {
        total: started.length * TAKES_EACH,
        images: started,
        members: found.act.order,
        failedBefore: Object.fromEntries(started.map((id) => [id, before[id]?.failed ?? 0])),
        stoppedBefore: Object.fromEntries(started.map((id) => [id, before[id]?.stopped ?? 0])),
      })
      return { ok: true, images: started, takes: started.length * TAKES_EACH }
    },

    async batch(projectFile, actId) {
      const press = batches.get(`${projectFile}\0${actId}`)
      if (!press) return null
      const { members: _members, ...kept } = press
      return { ...kept, running: pressRunning(projectFile, press) }
    },

    async closeBatch(projectFile, actId) {
      const key = `${projectFile}\0${actId}`
      const press = batches.get(key)
      if (press && !pressRunning(projectFile, press)) batches.delete(key)
      return { ok: true }
    },

    async stopAll(projectFile, actId) {
      const found = await actOf(projectFile, actId)
      if (!found || !('act' in found)) return found
      let stopped = 0
      for (const id of found.act.order) {
        const answer = await this.stop(projectFile, id)
        if (answer && answer.ok && answer.stopped > 0) {
          stopped += answer.stopped
        }
      }
      return { ok: true, stopped }
    },

    async view(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      const entries = entriesOf(found.key)
      const board = await readBoard(found)
      if ('ok' in board) return board
      const problems: Problem[] = []
      const lock = await lockNow(found, problems)
      const chosen = lock?.[id]?.take
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
          ...(take.fineTunedFrom ? { fineTunedFrom: take.fineTunedFrom } : {}),
        })
      }
      const secondsOf = await secondsFor(projectFile)
      const making: ImageMakingView[] = entries
        .filter((e) => e.state !== 'failed' && !takes.some((t) => t.n === e.n))
        .map((e) => ({
          n: e.n,
          state: e.state as 'waiting' | 'making',
          elapsed: e.state === 'making' ? Math.max(0, (now() - e.startedAt) / 1000) : 0,
          expected: secondsOf(e.model),
        }))
      const failed: ImageFailedView[] = entries
        .filter((e) => e.state === 'failed')
        .map((e) => ({ n: e.n, message: e.message }))
      const models = await installedModels()
      const failures = await health.read(projectFile)
      const mflux = await generator.ready()
      return {
        ok: true,
        generator: !mflux.ok
          ? mflux
          : models.some((m) => m.installed)
            ? mflux
            : {
                ok: false,
                message: 'No image model is on this computer.',
                fix: 'See Setup for how to download them.',
              },
        projectModel: found.config.model ?? DEFAULT_IMAGE_MODEL,
        models: models.map((m) => ({ ...m, failed: Boolean(failures[m.id]) })),
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
      // Takes started by hand end the summary of a finished press (read before they are added);
      // one still running goes on.
      const ended = pressing
        ? []
        : [...batches]
            .filter(
              ([at, press]) =>
                at.startsWith(`${projectFile}\0`) &&
                press.members.includes(id) &&
                !pressRunning(projectFile, press),
            )
            .map(([at]) => at)
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
        const states = await modelStates(projectFile)
        const installed = Object.fromEntries(
          IMAGE_MODEL_IDS.map((id) => [id, states[id].download === 'whole']),
        ) as Record<ImageModelId, boolean>
        const model =
          request.model ?? defaultTakeModel(found.config.model ?? DEFAULT_IMAGE_MODEL, states)
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
      for (const key of ended) batches.delete(key)
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
      if (stopped) stoppedCount.set(found.key, (stoppedCount.get(found.key) ?? 0) + stopped)
      return { ok: true, stopped }
    },

    async addTake(projectFile, id, made) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      return changeBoard(found, async (board) => {
        const n = board.next
        const size = pngSize(made.png.subarray(0, 33))
        // The picture first: a take is on the board only once its file is there.
        await writeAtomic(found.root, pictureOf(id, n), made.png)
        board.next = n + 1
        board.takes = [
          ...board.takes,
          {
            n,
            seed: made.seed,
            model: made.model,
            width: size.width,
            height: size.height,
            madeFrom: board.takes.find((t) => t.n === made.from)?.madeFrom ?? found.row.madeFrom,
            seen: false,
            fineTunedFrom: { take: made.from, words: made.words },
          },
        ]
        return { ok: true as const, n }
      })
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
        // The boxes of no take yet belong to the take in the game, else to the one chosen now.
        const adopted = await adoptImageAreas(projectFile, id, found.row.chosenTake ?? n)
        if (adopted && !adopted.ok) return notAdopted(adopted)
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

    async accept(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      return boards.run(turn(found), () =>
        choices().run(`image-choice\0${projectFile}`, async (): Promise<ImageTakesAnswer> => {
          const lock = await lockNow(found, [])
          if (!lock) return { ok: false, message: 'The images lock could not be read.' }
          const chosen = lock[id]
          if (!chosen) return { ok: false, message: 'No take is chosen for this image.' }
          // The image's words and style read again in the turn: one saved since `found` was read
          // is what is accepted, never the one before it.
          const fresh = await resolve(projectFile, id)
          if (!fresh || !('row' in fresh))
            return { ok: false, message: 'The image could not be read again.' }
          const now = fresh.row.madeFrom
          const reasons = outOfDateReasons(now, chosen)
          if (!reasons.length)
            return { ok: false, message: 'Nothing has changed since the take was chosen.' }
          if (!acceptableReasons(reasons)) {
            return {
              ok: false,
              message: 'A changed size cannot be accepted: the image needs a new take.',
            }
          }
          lock[id] = { ...chosen, words: now.words, style: now.style }
          await writeAtomic(found.root, IMAGES_LOCK_FILE, formatImageLock(lock))
          return { ok: true }
        }),
      )
    },

    async unchoose(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      return boards.run(turn(found), async () => {
        // Before the image-choice turn, as in choose: saving a box holds the edits and then waits for it.
        // A lock entry with no take number leaves the boxes of no take yet where they are.
        if (found.row.chosenTake !== null) {
          const adopted = await adoptImageAreas(projectFile, id, found.row.chosenTake)
          if (adopted && !adopted.ok) return notAdopted(adopted)
        }
        return choices().run(
          `image-choice\0${projectFile}`,
          async (): Promise<ImageTakesAnswer> => {
            const problems: Problem[] = []
            const manifest = await manifestNow(found, problems)
            const lock = await lockNow(found, problems)
            if (!manifest) return { ok: false, message: 'The images manifest could not be read.' }
            if (!lock) return { ok: false, message: 'The images lock could not be read.' }
            if (!lock[id]) return { ok: false, message: 'No take is chosen for this image.' }
            if (id in manifest) {
              delete manifest[id]
              await writeAtomic(
                found.root,
                found.config.manifest,
                `${JSON.stringify(sorted(manifest), null, 2)}\n`,
              )
            }
            await rm(resolveInRoot(found.root, join(found.config.clips, `${id}.png`)), {
              force: true,
            })
            delete lock[id]
            await writeAtomic(found.root, IMAGES_LOCK_FILE, formatImageLock(lock))
            return { ok: true }
          },
        )
      })
    },

    async drop(projectFile, id, n) {
      const found = await resolve(projectFile, id)
      if (!found || !('row' in found)) return found
      const outcome = await changeBoard(
        found,
        async (board): Promise<ImageTakesAnswer | { dropped: ImageBoardTake }> => {
          const problems: Problem[] = []
          const lock = await lockNow(found, problems)
          if (!lock) return { ok: false, file: IMAGES_LOCK_FILE, problems }
          const take = board.takes.find((t) => t.n === n)
          if (!take) return { ok: false, message: 'That take is not on the board.' }
          if (lock[id]?.take === n) {
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
      const secondsOf = await secondsFor(projectFile)
      const prefix = `${projectFile}\0`
      const keys = new Set([...active.keys(), ...stoppedCount.keys()])
      for (const key of keys) {
        if (!key.startsWith(prefix)) continue
        let takes = 0
        let left = 0
        let failed = 0
        for (const entry of active.get(key)?.values() ?? []) {
          if (entry.state === 'failed') {
            failed++
            continue
          }
          takes++
          const seconds = secondsOf(entry.model)
          left +=
            entry.state === 'waiting'
              ? seconds
              : Math.max(0, seconds - (now() - entry.startedAt) / 1000)
        }
        const stopped = stoppedCount.get(key) ?? 0
        if (takes || failed || stopped) {
          summary[key.slice(prefix.length)] = { takes, left, failed, stopped }
        }
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
      // an image several acts list has a row in each, and is brought once
      const ids = [
        ...new Set(
          (summary?.acts ?? [])
            .flatMap((act) => act.rows)
            .filter((r) => r.looksOld)
            .map((r) => r.id),
        ),
      ]
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
      if (lock?.[id]) {
        const clip = resolveInRoot(found.root, join(found.config.clips, `${id}.png`))
        return (await Bun.file(clip).exists()) ? clip : null
      }
      // While the lock cannot be read, what the game shows is not known.
      if (!lock) return null
      return found.row.gameFile ? gameFilePath(found.root, found.row.gameFile.file) : null
    },
  }
}

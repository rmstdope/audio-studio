import { createHash, randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  MUSIC_MODEL,
  generatedSeconds,
  peaks,
  shapeTake,
  wavSeconds,
  MusicBoardSchema,
  type BoardTake,
  type FailedView,
  type MusicMakingSummary,
  type MakingView,
  type MusicBoard,
  type MusicTakesView,
  type TakeView,
} from '../core/musicTake'
import {
  DEFAULT_MUSIC_MODEL,
  MUSIC_MODELS,
  modelLine,
  musicModel,
  onThisComputer,
  takePrice,
  tooLongOnTrack,
  type MusicModelId,
} from '../core/musicModels'
import type { MusicSpend } from '../core/spending'
import { trackFor, type TrackRow } from '../core/music'
import type { Problem } from '../core/project'
import { resolveInRoot } from '../core/paths'
import { movedBoardTake } from '../core/musicMove'
import { TAKES_EACH, planMakeAll } from '../core/musicMakeAll'
import { applyFades, fadesProblem, hasFades, type Fades } from '../core/fades'
import {
  NOTHING_LINE,
  SILENT_LINE,
  findTrim,
  trimWav,
  trimmedSeconds,
  type Trim,
} from '../core/musicTrim'
import { readWav, writeWav } from '../core/wav'
import { ffmpegEncoder, type Encoder } from './audio'
import { readResource, refusalAnswer, refusalSentence, writeAtomic, writeOrRefuse } from './files'
import { gpuQueue, holdGpu, GPU } from './gpu'
import type { MusicGenerator } from './music'
import {
  acceptChange,
  commitChoice,
  readChosen,
  uncommitChoice,
  type CommitResult,
} from './musicClips'
import { readMusic } from './musicLists'
import { isRefreshing, isRefreshingShared } from './refresh'
import { createSerial, type Serial } from './serial'
import { openProject, type ProjectFailure } from './workspace'
import { CACHE_DIR, MUSIC_LOCK_FILE } from '../core/project'

/** The queue's key for takes made in the cloud: one at a time, beside the GPU's. */
const CLOUD = 'music-cloud'

/** Where a project's music takes are cached, one folder per track. */
export const MUSIC_TAKES_DIR = `${CACHE_DIR}/music-takes`

/** Where a track's board is saved: one file per track (a track id is a safe file name). */
export const MUSIC_BOARD_DIR = `${CACHE_DIR}/music`

/** A track id that is safe as a file and folder name (the game's list is validated too; this guards the board's path on its own). */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** How many bars a take's waveform has. */
const WAVEFORM_BARS = 120

/** A take's file name: the hash of its inputs, its number, `.wav`. */
const TAKE_FILE = /^([0-9a-f]{16})\.(\d+)\.wav$/

/** What to make: this many new takes, or the failed take with this number again. */
export type MakeRequest = { count: number; model?: MusicModelId } | { retry: number }

/** What asking for takes answered; null for a track the project does not list. */
export type MakeResult = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** What making takes for a whole list answered: how many tracks and takes were queued; null for an unknown list. */
export type MakeAllResult =
  { ok: true; tracks: number; takes: number } | { ok: false; message: string } | ProjectFailure

/** The project's music model, and whether takes can be made with it now (`message` says what is missing). */
export type ModelStateResult =
  { ok: true; model: MusicModelId; ready: boolean; message: string | null } | ProjectFailure | null

/** What dropping a take answered; null for a track the project does not list. */
export type DropResult =
  | { ok: true }
  | {
      ok: false
      message: string
      /** Set when a failed fade save could not put the game's file back: the game plays the new sound. */
      gameChanged?: true
    }
  | ProjectFailure
  | null

/** What moving a take answered: its number on the other track; null for a track the project does not list. */
export type MoveResult =
  { ok: true; n: number } | { ok: false; message: string } | ProjectFailure | null

/** What stopping answered: how many takes were stopped, made or waiting; null for an unknown track. */
export type StopResult = { ok: true; stopped: number } | ProjectFailure | null

/** What stopping a whole list answered: how many takes were stopped in all, and on each track. */
export type StopAllResult =
  { ok: true; stopped: number; byTrack: Record<string, number> } | ProjectFailure | null

/** What choosing a take answered; null for a track the project does not list. */
export type ChooseResult = CommitResult | null

/** What trimming or untrimming a take answered; null for a track the project does not list. */
export type TrimResult = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** A track's takes as the page shows them, a project failure, or null for an unknown track. */
export type TakesResult = MusicTakesView | ProjectFailure | null

/** Changes to one track's board, one after another, keyed `<project file>\0<track id>`. */
export function boardQueue(): Serial {
  const shared = globalThis as { contentStudioBoardQueue?: Serial }
  return (shared.contentStudioBoardQueue ??= createSerial())
}

/** Whether a track id is safe as the name of its board and takes folder. */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id)
}

/**
 * Deletes a track's board and its cached takes (the caller holds the track's turn on the board
 * queue). Nothing for an id that is not safe as a file name.
 */
export async function deleteBoard(root: string, id: string): Promise<void> {
  if (!isSafeId(id)) return
  await rm(resolveInRoot(root, `${MUSIC_BOARD_DIR}/${id}.json`), { force: true })
  await rm(resolveInRoot(root, `${MUSIC_TAKES_DIR}/${id}`), { recursive: true, force: true })
}

/** What a track's inputs are for the takes: the brief in force, with the kind. */
interface Inputs {
  brief: string
  kind: 'loop' | 'stinger'
  seconds: number
  bpm: number | null
  key: string | null
}

/** A take being made or waiting, or one that failed, until it is made. */
interface Entry {
  n: number
  state: 'waiting' | 'making' | 'failed'
  startedAt: number
  message: string
  /** The hash of the inputs it is made for; Try again files it under the brief as it is then. */
  hash: string
  /** Ends the take while it is being made (Stop). */
  stop?: AbortController
  /** The music model it is made with; a retry makes it again with the same. */
  model: MusicModelId
  /** The press of Make all that started it, which counts it if it is stopped; none if by hand. */
  press?: StoredBatch
}

/**
 * A hash of what went into a take: the track's inputs. It begins with Balanced's recipe whatever
 * model makes the take, as it did when there was one model, so no fingerprint already kept
 * changes and choosing another model never makes a take "earlier".
 */
export function musicTakeHash(inputs: Inputs): string {
  const { brief, kind, seconds, bpm, key } = inputs
  return createHash('sha256')
    .update(JSON.stringify([MUSIC_MODEL, brief, kind, seconds, bpm, key]))
    .digest('hex')
    .slice(0, 16)
}

/** A model as a take's line says it: "Balanced · XL turbo · 4B". */
const lineOf = (model: MusicModelId) => modelLine(musicModel(model).recipe)

/** A failure as a sentence for the page. */
function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const prefix = 'The music generator: '
  const sentence = text.startsWith(prefix)
    ? `The music generator stopped: ${text.slice(prefix.length)}`
    : text
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}

/** What the takes of a track are made of. */
export interface MusicTakes {
  /** The track's board, and those being made. */
  view(projectFile: string, id: string): Promise<TakesResult>
  /** Queues takes on the GPU queue and returns at once; they are made one at a time. */
  make(projectFile: string, id: string, request: MakeRequest): Promise<MakeResult>
  /** Stops the track's takes: the one being made ends and is discarded, the waiting ones never start. */
  stop(projectFile: string, id: string): Promise<StopResult>
  /**
   * Queues four takes, on the project's model, for every track of the list with no chosen take that
   * is not already making takes and that the model can make at its length (`planMakeAll`). Starts
   * nothing when music cannot be made yet, or when one track fails to start (the ones queued are
   * stopped). Null for a list that is not there.
   */
  makeAll(projectFile: string, listId: string): Promise<MakeAllResult | null>
  /** The latest press on the list, kept until Close, a hand start or a new press; null when none. */
  batch(projectFile: string, listId: string): Promise<MusicBatch | null>
  /** Forgets the list's finished press (Close); one that still runs is not forgotten. */
  closeBatch(projectFile: string, listId: string): Promise<{ ok: true }>
  /** Stops every take of the list's tracks that waits or is being made. Null for a list that is not there. */
  stopAll(projectFile: string, listId: string): Promise<StopAllResult>
  /** The project's music model, and whether takes can be made with it now. Null without a `music` section. */
  modelState(projectFile: string): Promise<ModelStateResult>
  /** Makes a take on the board the track's music: levelled, encoded, with the manifest and lock. */
  choose(projectFile: string, id: string, name: string): Promise<ChooseResult>
  /** Takes the track's chosen take back: its music file, manifest entry and lock entry go; the take stays on the board. */
  unchoose(projectFile: string, id: string): Promise<ChooseResult>
  /**
   * Accepts a changed brief, tempo or key: the chosen take counts as made from them, and the track
   * is up to date. A changed length is refused.
   */
  accept(projectFile: string, id: string): Promise<ChooseResult>
  /**
   * Saves the fades of a stinger take, or removes them (null). The take on the board stays as
   * generated; if it is the chosen one, the game's file is written again with the faded sound first,
   * and nothing changes if that fails.
   */
  setFades(projectFile: string, id: string, name: string, fades: Fades | null): Promise<DropResult>
  /** Takes a take off the board and deletes its file; the chosen take stays. */
  drop(projectFile: string, id: string, name: string): Promise<DropResult>
  /**
   * Moves a take to the board of another track of the same kind, as that track's next take, made
   * for its brief; it keeps where it came from. Not the chosen take, and not while either track's
   * list is being refreshed from the game.
   */
  move(projectFile: string, id: string, name: string, toId: string): Promise<MoveResult>
  /**
   * Cuts the near-silent start and end of a stinger take (or, with `undo`, gives it back as
   * generated). The WAV stays as generated; the cut is kept on the board. A take that is the one in
   * the game has the game's file rewritten first, and nothing changes if that fails.
   */
  trim(projectFile: string, id: string, name: string, undo: boolean): Promise<TrimResult>
  /** A trimmed take's sound between its cuts as a WAV; null for a take that is not trimmed. */
  trimmedSound(projectFile: string, id: string, name: string): Promise<Uint8Array | null>
  /** What is being made in the project, by track, for the lists' status. */
  making(projectFile: string): Promise<Record<string, MusicMakingSummary>>
  /** The path of a take's WAV, or null for a track not listed or a name that is not a take's. */
  takeFile(projectFile: string, id: string, name: string): Promise<string | null>
}

/**
 * What one press of Make takes on a list remembers: how many takes it asked for, for which tracks,
 * how many of each track's takes had failed before it, and how many of its own takes were
 * stopped; `running` while any of its tracks still has a take waiting or being made.
 */
export interface MusicBatch {
  total: number
  tracks: string[]
  failedBefore: Record<string, number>
  stopped: number
  running: boolean
}

/** A press as the studio keeps it: `members` are all the list's tracks, whose hand starts end it. */
interface StoredBatch extends Omit<MusicBatch, 'running'> {
  members: string[]
}

/** A take's file name on the board. */
const fileOf = (take: Pick<BoardTake, 'hash' | 'n'>) => `${take.hash}.${take.n}.wav`

/** A refusal of a choice as a bare reason: "Take 1 could not be chosen: X. Nothing was changed." gives "X". */
function plainReason(message: string): string {
  return message
    .replace(/^Take \d+ could not be chosen: /, '')
    .replace(/\.? Nothing was changed\.$/, '')
    .replace(/\.$/, '')
}

/**
 * What the game plays of a take: its WAV between the cuts if it was trimmed, then with its fades if
 * it has some, and the take as the board should hand it to the encoder, with the length that is left.
 */
function playedOf(take: BoardTake, bytes: Uint8Array): { take: BoardTake; wav: Uint8Array } {
  const fades = take.fades && hasFades(take.fades) ? take.fades : null
  if (!take.trim && !fades) return { take, wav: bytes }
  let wav = readWav(bytes)
  if (take.trim) wav = trimWav(wav, take.trim)
  if (fades) wav = applyFades(wav, fades)
  return {
    take: take.trim ? { ...take, seconds: trimmedSeconds(take.seconds, take.trim) } : take,
    wav: writeWav(wav),
  }
}

/**
 * The takes of the game's music: made by `generator` on the GPU `queue` (shared with Whisper),
 * shaped to what the game would play, and kept on a board per track in
 * `content-studio/cache/music/<track>.json` (each take with its seed, waveform and the inputs it was made
 * from), its WAV in `content-studio/cache/music-takes/<track>/<hash>.<n>.wav`. Takes waiting, being made
 * and failed are kept in memory, per track, for the page to poll (they survive a `--dev` reload,
 * not a restart); a take made is a file and a board entry.
 */
export function createMusicTakes({
  generator,
  queue = gpuQueue(),
  now = Date.now,
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
  encode = ffmpegEncoder,
  spent = () => undefined,
}: {
  generator: MusicGenerator
  queue?: Serial
  now?: () => number
  newSeed?: () => number
  /** Encodes the chosen take (tests); ffmpeg by default. */
  encode?: Encoder
  /**
   * Hears what a paid take cost: once it is made, or once it is stopped while being made (the
   * request was sent, so it may be billed). Takes that fail, and free ones, cost nothing.
   */
  spent?: (projectFile: string, take: MusicSpend) => void | Promise<void>
}): MusicTakes {
  // On `globalThis` like the GPU queue the jobs run on, so a `--dev` reload keeps what is being made.
  const shared = globalThis as {
    contentStudioMakingTakes?: Map<string, Map<number, Entry>>
    contentStudioMusicBatches?: Map<string, StoredBatch>
  }
  const active = (shared.contentStudioMakingTakes ??= new Map())
  // The latest press of each list (`<project file>\0<list id>`), so every tab shows its summary.
  const batches = (shared.contentStudioMusicBatches ??= new Map())
  // The press while Make all starts its own takes, which are not hand starts.
  let pressing: StoredBatch | null = null
  // Changes to one track's board, one after another: a take finishing and a drop lose neither.
  const boards = boardQueue()
  // What a stinger take has to cut, by its file's path, size and time, so a poll reads no WAV again.
  const scans = new Map<string, NonNullable<TakeView['trimmable']>>()

  /** What the WAV at `path` has to cut. */
  async function scan(path: string): Promise<NonNullable<TakeView['trimmable']> | null> {
    try {
      // The time to the nanosecond, so a sound written again at once is not taken for the one before.
      const { size, mtimeMs, ctimeMs } = await stat(path)
      const key = `${path}\0${size}\0${mtimeMs}\0${ctimeMs}`
      const known = scans.get(key)
      if (known) return known
      const file = Bun.file(path)
      const found = findTrim(readWav(new Uint8Array(await file.arrayBuffer())))
      const answer = found.kind === 'cut' ? 'cut' : found.kind
      scans.set(key, answer)
      return answer
    } catch {
      return null
    }
  }

  async function resolve(projectFile: string, id: string) {
    if (!SAFE_ID.test(id)) return null
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { project } = opened
    const root = dirname(projectFile)
    if (!project.music) return null
    const found = trackFor((await readMusic(root, project, []))?.lists ?? [], id)
    if (!found) return null
    const row: TrackRow = found.track
    const kind: Inputs['kind'] = found.list.kind === 'stingers' ? 'stinger' : 'loop'
    const inputs: Inputs = {
      brief: row.brief,
      kind,
      seconds: row.seconds,
      bpm: row.bpm,
      key: row.key,
    }
    return {
      root,
      id,
      music: project.music,
      model: project.music.model ?? DEFAULT_MUSIC_MODEL,
      listId: found.list.id,
      title: row.title,
      inputs,
      hash: musicTakeHash(inputs),
      folder: `${MUSIC_TAKES_DIR}/${id}`,
      board: `${MUSIC_BOARD_DIR}/${id}.json`,
    }
  }
  type Found = Exclude<Awaited<ReturnType<typeof resolve>>, ProjectFailure | null>

  /** A track's board; an empty one before its first take; the problems if its file is broken. */
  async function readBoard(root: string, path: string): Promise<MusicBoard | ProjectFailure> {
    const problems: Problem[] = []
    const board = await readResource(root, path, MusicBoardSchema, problems)
    if (board === 'missing') return { next: 1, takes: [] }
    if (board === 'invalid') return { ok: false, file: path, problems }
    return board
  }

  /** Changes a track's board and saves it; what `change` returns is the answer. */
  function changeBoard<T>(
    projectFile: string,
    found: Found,
    change: (board: MusicBoard) => T | Promise<T>,
    /** Called when the board cannot be written, to take back what `change` did elsewhere. */
    undo?: () => Promise<void>,
  ): Promise<T | ProjectFailure> {
    return boards.run(`${projectFile}\0${found.id}`, async () => {
      const board = await readBoard(found.root, found.board)
      if ('ok' in board) return board
      const before = JSON.stringify(board, null, 2)
      const answer = await change(board)
      const after = JSON.stringify(board, null, 2)
      // Nothing changed (a drop of a take that is not there): nothing is written.
      if (after !== before) {
        try {
          await writeOrRefuse(found.root, found.board, `${after}\n`)
        } catch (error) {
          await undo?.()
          throw error
        }
      }
      return answer
    })
  }

  async function run(
    projectFile: string,
    found: Found,
    entry: Entry,
    inputs: Inputs,
    waiting: Map<number, Entry>,
  ): Promise<void> {
    // Stopped while it waited: it is no longer in the map.
    if (waiting.get(entry.n) !== entry || entry.state !== 'waiting') return
    entry.state = 'making'
    entry.startedAt = now()
    const stop = new AbortController()
    entry.stop = stop
    // What the take costs, sent once ElevenLabs made it (billed, kept or not), or once it was
    // stopped while being made (the request was sent, so it may be billed).
    const price = takePrice(entry.model, inputs)
    let generated = false
    try {
      const seed = newSeed()
      const take = await generator.generate(
        {
          brief: inputs.brief,
          kind: inputs.kind,
          seconds: generatedSeconds(inputs.kind, inputs.seconds),
          bpm: inputs.bpm,
          key: inputs.key,
          seed,
          model: entry.model,
        },
        stop.signal,
      )
      generated = true
      // Stopped while it was made: it is discarded, and no longer in the map.
      if (stop.signal.aborted) return
      const shaped = shapeTake(take.wav, inputs.kind, inputs.seconds)
      const wav = readWav(shaped)
      const made: BoardTake = {
        n: entry.n,
        hash: entry.hash,
        ...(take.seed !== undefined && { seed: take.seed }),
        model: musicModel(entry.model).recipe,
        seconds: wavSeconds(wav),
        peaks: peaks(wav, WAVEFORM_BARS),
        inputs,
      }
      // The file first: a take is on the board only once its WAV is there.
      await writeAtomic(found.root, `${found.folder}/${fileOf(made)}`, shaped)
      const saved = await changeBoard(projectFile, found, (board) => {
        // Stopped while its file was written or it waited for the board: not put on it.
        if (stop.signal.aborted) return
        board.takes = [...board.takes.filter((t) => t.n !== made.n), made].sort((a, b) => a.n - b.n)
      })
      if (stop.signal.aborted) {
        await rm(resolveInRoot(found.root, `${found.folder}/${fileOf(made)}`), { force: true })
        return
      }
      if (saved && 'ok' in saved) throw new Error(`${saved.file} cannot be used`)
      waiting.delete(entry.n)
    } catch (error) {
      if (stop.signal.aborted) return
      entry.state = 'failed'
      entry.message = describeFailure(error)
    } finally {
      const outcome = generated ? 'done' : stop.signal.aborted ? 'stopped' : null
      if (price !== null && outcome) {
        // Saving what was spent must never undo or crash the take it describes.
        try {
          await spent(projectFile, {
            id: randomUUID(),
            at: new Date(now()).toISOString(),
            part: found.listId,
            track: found.id,
            title: found.title,
            model: entry.model,
            seconds: generatedSeconds(inputs.kind, inputs.seconds),
            cost: price,
            outcome,
          })
        } catch (error) {
          console.error('Content Studio: could not save what a music take cost:', error)
        }
      }
    }
  }

  /** Whether any take of the press is still waiting or being made. */
  const pressRunning = (projectFile: string, press: StoredBatch) =>
    press.tracks.some((id) => entriesOf(projectFile, id).some((entry) => entry.state !== 'failed'))

  /** A track's entries: waiting, being made, or failed. */
  const entriesOf = (projectFile: string, id: string) =>
    [...(active.get(`${projectFile}\0${id}`)?.values() ?? [])].sort((a, b) => a.n - b.n)

  const api: MusicTakes = {
    async view(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      const { root, inputs, hash, folder } = found
      // The entries first: one is dropped only after the board has it, so a take is then in the
      // board read after, never in neither.
      const entries = entriesOf(projectFile, id)
      const board = await readBoard(root, found.board)
      if ('ok' in board) return board
      const chosenTracks = await readChosen(root, found.music, [])
      const chosen = chosenTracks.read ? chosenTracks.entries[id]?.lock : undefined
      const takes: TakeView[] = []
      for (const take of board.takes) {
        const path = join(root, folder, fileOf(take))
        if (!(await Bun.file(path).exists())) continue
        const trimmable = inputs.kind === 'stinger' && !take.trim ? await scan(path) : null
        takes.push({
          n: take.n,
          file: fileOf(take),
          seconds: take.seconds,
          ...(take.seed !== undefined && { seed: take.seed }),
          peaks: take.peaks,
          earlier: take.hash !== hash,
          chosen: chosen?.take === take.n && chosen.fp === take.hash,
          model: modelLine(take.model),
          ...(take.movedFrom && { movedFrom: take.movedFrom }),
          ...(take.trim && {
            trim: { ...take.trim, seconds: trimmedSeconds(take.seconds, take.trim) },
          }),
          ...(trimmable && { trimmable }),
          ...(take.fades && { fades: take.fades }),
        })
      }
      const making: MakingView[] = entries
        .filter((entry) => entry.state !== 'failed' && !takes.some((take) => take.n === entry.n))
        .map((entry) => ({
          n: entry.n,
          state: entry.state as 'waiting' | 'making',
          elapsed: entry.state === 'making' ? Math.max(0, (now() - entry.startedAt) / 1000) : 0,
          model: lineOf(entry.model),
          expected: musicModel(entry.model).seconds,
          paid: musicModel(entry.model).perMinute !== null,
        }))
      // Whatever brief they failed on: Try again makes them from the brief as it is now.
      const failed: FailedView[] = entries
        .filter((entry) => entry.state === 'failed')
        .map((entry) => ({
          n: entry.n,
          message: entry.message,
          model: lineOf(entry.model),
          modelId: entry.model,
        }))
      const models = await Promise.all(
        MUSIC_MODELS.map(async ({ id }) => ({ id, installed: await generator.installed(id) })),
      )
      // The project's model says whether music can be made when it can be used; else the first
      // model that is here says the rest (the machine and uv); with none, the project's model says
      // what is missing (its download, or for Eleven Music its key).
      const here =
        models.find((m) => m.id === found.model && m.installed) ?? models.find((m) => m.installed)
      return {
        ok: true,
        kind: inputs.kind,
        generator: await generator.ready(here?.id ?? found.model),
        defaultModel: found.model,
        models,
        takes,
        making,
        failed,
        lockUnread: !chosenTracks.read,
      }
    },

    async make(projectFile, id, request) {
      // Read before anything is awaited: Make all sets it only around its own synchronous call.
      const press = pressing
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      const { inputs, hash } = found
      // A retry is made with the model the take was first asked with.
      const retried =
        'retry' in request ? active.get(`${projectFile}\0${id}`)?.get(request.retry) : undefined
      const model =
        retried?.model ?? ('retry' in request ? found.model : (request.model ?? found.model))
      const tooLong = tooLongOnTrack(model, inputs.kind, inputs.seconds)
      if (tooLong) return { ok: false, message: tooLong }
      if (!(await generator.installed(model))) {
        const { name } = musicModel(model)
        return {
          ok: false,
          message: onThisComputer(model)
            ? `${name} is not on this computer.`
            : `${name} needs an ElevenLabs key.`,
        }
      }
      const ready = await generator.ready(model)
      if (!ready.ok) return { ok: false, message: ready.message }
      // Takes started by hand end the summary of a finished press (read before they are added);
      // one still running goes on.
      const ended = press
        ? []
        : [...batches]
            .filter(
              ([at, press]) =>
                at.startsWith(`${projectFile}\0`) &&
                press.members.includes(id) &&
                !pressRunning(projectFile, press),
            )
            .map(([at]) => at)
      const key = `${projectFile}\0${id}`
      const entries = active.get(key) ?? new Map<number, Entry>()
      active.set(key, entries)
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
        // The brief may have changed since it failed: it is made from it, so it is filed under it.
        failed.hash = hash
        queued.push(failed)
      } else {
        // The numbers are reserved on the board at once, so none is used twice, even by a take
        // that fails or is stopped.
        const reserved = await changeBoard(projectFile, found, (board) => {
          const first = Math.max(board.next, ...[...entries.values()].map((entry) => entry.n + 1))
          board.next = first + request.count
          return first
        }).catch(
          refusalAnswer(
            'reserving the take numbers failed',
            (reason) => `No takes were made: ${reason}.`,
          ),
        )
        if (typeof reserved !== 'number') return reserved
        for (let i = 0; i < request.count; i++) {
          const entry: Entry = {
            n: reserved + i,
            state: 'waiting',
            startedAt: 0,
            message: '',
            hash,
            model,
            ...(press && { press }),
          }
          entries.set(entry.n, entry)
          queued.push(entry)
        }
      }
      for (const key of ended) batches.delete(key)
      for (const entry of queued) {
        // Takes made on this computer wait for its GPU; takes made in the cloud wait only for
        // each other.
        const turn = onThisComputer(entry.model) ? GPU : CLOUD
        const make = () => run(projectFile, found, entry, inputs, entries)
        void queue.run(turn, turn === GPU ? () => holdGpu('music', make) : make)
      }
      return { ok: true }
    },

    async makeAll(projectFile, listId) {
      const opened = await openProject(projectFile)
      if (!opened.ok) return opened
      const { project } = opened
      if (!project.music) return null
      const lists = (await readMusic(dirname(projectFile), project, []))?.lists ?? []
      const list = lists.find((l) => l.id === listId)
      if (!list) return null
      const state = await api.modelState(projectFile)
      if (!state || !state.ok) return state
      if (!state.ready) return { ok: false, message: state.message ?? 'Music cannot be made yet.' }
      const plan = planMakeAll({
        kind: list.kind === 'stingers' ? 'stinger' : 'loop',
        tracks: list.tracks,
        making: await api.making(projectFile),
        model: state.model,
        ready: true,
      })
      if (plan.kind !== 'ready' || plan.tracks.length === 0)
        return { ok: true, tracks: 0, takes: 0 }
      const started: string[] = []
      const before = await api.making(projectFile)
      // Its takes point at it from the start; it is kept only once they have all been started.
      const press: StoredBatch = {
        total: plan.takes,
        tracks: started,
        members: list.tracks.map((t) => t.id),
        failedBefore: {},
        stopped: 0,
      }
      for (const track of plan.tracks) {
        // Only this call reads it, before its first await; a hand start meanwhile does not.
        pressing = press
        const making = api.make(projectFile, track.id, { count: TAKES_EACH })
        pressing = null
        const made = await making
        if (!made || !made.ok) {
          for (const id of started) await api.stop(projectFile, id)
          const message =
            made && 'message' in made ? made.message : 'The takes could not be started.'
          return { ok: false, message }
        }
        started.push(track.id)
      }
      press.failedBefore = Object.fromEntries(started.map((id) => [id, before[id]?.failed ?? 0]))
      batches.set(`${projectFile}\0${listId}`, press)
      return { ok: true, tracks: plan.tracks.length, takes: plan.takes }
    },

    async batch(projectFile, listId) {
      const press = batches.get(`${projectFile}\0${listId}`)
      if (!press) return null
      const { members: _members, ...kept } = press
      return { ...kept, running: pressRunning(projectFile, press) }
    },

    async closeBatch(projectFile, listId) {
      const key = `${projectFile}\0${listId}`
      const press = batches.get(key)
      if (press && !pressRunning(projectFile, press)) batches.delete(key)
      return { ok: true }
    },

    async stopAll(projectFile, listId) {
      const opened = await openProject(projectFile)
      if (!opened.ok) return opened
      if (!opened.project.music) return null
      const lists = (await readMusic(dirname(projectFile), opened.project, []))?.lists ?? []
      const list = lists.find((l) => l.id === listId)
      if (!list) return null
      let stopped = 0
      const byTrack: Record<string, number> = {}
      for (const track of list.tracks) {
        const result = await api.stop(projectFile, track.id)
        if (result && result.ok && result.stopped > 0) {
          byTrack[track.id] = result.stopped
          stopped += result.stopped
        }
      }
      return { ok: true, stopped, byTrack }
    },

    async modelState(projectFile) {
      const opened = await openProject(projectFile)
      if (!opened.ok) return opened
      const { music } = opened.project
      if (!music) return null
      const model = music.model ?? DEFAULT_MUSIC_MODEL
      if (!(await generator.installed(model))) {
        const { name } = musicModel(model)
        return {
          ok: true,
          model,
          ready: false,
          message: onThisComputer(model)
            ? `${name} is not on this computer.`
            : `${name} needs an ElevenLabs key.`,
        }
      }
      const ready = await generator.ready(model)
      return { ok: true, model, ready: ready.ok, message: ready.ok ? null : ready.message }
    },

    async stop(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      let stopped = 0
      const entries = active.get(`${projectFile}\0${id}`)
      if (!entries) return { ok: true, stopped: 0 }
      for (const [n, entry] of entries) {
        if (entry.state === 'failed') continue
        entry.stop?.abort()
        entries.delete(n)
        stopped++
        // Its press counts it, wherever Stop was pressed, so a take stopped is never one made.
        if (entry.press) entry.press.stopped++
      }
      return { ok: true, stopped }
    },

    async drop(projectFile, id, name) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      // The lock is read in the board's turn, so a choice under way is either done or not begun.
      const outcome = await changeBoard(
        projectFile,
        found,
        async (board): Promise<DropResult | { dropped: BoardTake }> => {
          const problems: Problem[] = []
          const chosenTracks = await readChosen(found.root, found.music, problems)
          // Which take the game plays is not known: nothing is dropped.
          if (!chosenTracks.read || problems.length)
            return { ok: false, file: MUSIC_LOCK_FILE, problems }
          const chosen = chosenTracks.entries[id]?.lock
          const take = board.takes.find((t) => fileOf(t) === name)
          if (!take) return { ok: false, message: 'That take is not on the board.' }
          if (chosen?.take === take.n && chosen.fp === take.hash) {
            return { ok: false, message: 'That take is the one in the game; choose another first.' }
          }
          board.takes = board.takes.filter((t) => t !== take)
          return { dropped: take }
        },
      ).catch(
        refusalAnswer(
          'dropping the take failed',
          (reason) => `The take could not be dropped: ${reason}.`,
        ),
      )
      if (!outcome || !('dropped' in outcome)) return outcome
      await rm(resolveInRoot(found.root, `${found.folder}/${fileOf(outcome.dropped)}`), {
        force: true,
      })
      return { ok: true }
    },

    async setFades(projectFile, id, name, fades) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      /** Puts the game's file back, once the board turned out not to be writable. */
      let putBack: (() => Promise<void>) | null = null
      let stuck = false
      return changeBoard(
        projectFile,
        found,
        async (board): Promise<DropResult> => {
          const problems: Problem[] = []
          const chosenTracks = await readChosen(found.root, found.music, problems)
          // Which take the game plays is not known: nothing is changed.
          if (!chosenTracks.read || problems.length)
            return { ok: false, file: MUSIC_LOCK_FILE, problems }
          if (found.inputs.kind !== 'stinger')
            return { ok: false, message: 'Only a stinger can fade.' }
          const take = board.takes.find((t) => fileOf(t) === name)
          if (!take) return { ok: false, message: 'That take is not on the board.' }
          // The fades are of what the game plays: the take between its cuts, if it is trimmed.
          const wrong =
            fades &&
            fadesProblem(fades, take.trim ? trimmedSeconds(take.seconds, take.trim) : take.seconds)
          if (wrong) return { ok: false, message: wrong }
          const next: BoardTake = { ...take }
          delete next.fades
          if (fades && hasFades(fades)) next.fades = fades
          const chosen = chosenTracks.entries[id]?.lock
          if (chosen?.take === take.n && chosen.fp === take.hash) {
            let wav: Uint8Array
            try {
              wav = new Uint8Array(
                await Bun.file(join(found.root, found.folder, name)).arrayBuffer(),
              )
            } catch {
              return { ok: false, message: 'That take’s sound is gone, so it cannot be faded.' }
            }
            const game = join(found.music.clips, `${id}.mp3`)
            const was = await Bun.file(resolveInRoot(found.root, game))
              .bytes()
              .catch(() => null)
            putBack = async () => {
              if (was) await writeAtomic(found.root, game, was)
              else await rm(resolveInRoot(found.root, game), { force: true })
            }
            // Only the sound changes: the manifest and the lock (an accepted change too) stay as they are.
            const done = await commitChoice({
              root: found.root,
              projectFile,
              music: found.music,
              id,
              listId: chosen.list,
              take: next,
              wav: playedOf(next, wav).wav,
              encode,
              soundOnly: true,
            })
            if (!done.ok) return done
          }
          board.takes = board.takes.map((t) => (t === take ? next : t))
          return { ok: true }
        },
        () =>
          (putBack?.() ?? Promise.resolve()).catch((error) => {
            stuck = true
            console.error('putting the game’s file back failed', error)
          }),
      ).catch((error): DropResult => {
        const sentence = refusalSentence(error)
        if (sentence === null) throw error
        // Kept in the server log: the person is told which file, not the stack.
        console.error('saving the fades failed', error)
        return stuck
          ? {
              ok: false,
              message: `${sentence}, and the game’s file could not be put back.`,
              gameChanged: true,
            }
          : { ok: false, message: `${sentence}.` }
      })
    },

    async choose(projectFile, id, name) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      // In the board's turn, so the take cannot be dropped between the check and the lock.
      return boards.run(`${projectFile}\0${id}`, async (): Promise<CommitResult> => {
        const board = await readBoard(found.root, found.board)
        if ('ok' in board) return board
        const take = board.takes.find((t) => fileOf(t) === name)
        if (!take) return { ok: false, message: 'That take is not on the board.' }
        let wav: Uint8Array
        try {
          wav = new Uint8Array(await Bun.file(join(found.root, found.folder, name)).arrayBuffer())
        } catch {
          return { ok: false, message: 'That take’s sound is gone, so it cannot be chosen.' }
        }
        const played = playedOf(take, wav)
        return commitChoice({
          root: found.root,
          projectFile,
          music: found.music,
          id,
          listId: found.listId,
          take: played.take,
          wav: played.wav,
          encode,
        })
      })
    },

    async trim(projectFile, id, name, undo) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      if (found.inputs.kind !== 'stinger') {
        return { ok: false, message: 'Only a stinger’s take can be trimmed.' }
      }
      return changeBoard(projectFile, found, async (board): Promise<TrimResult> => {
        const take = board.takes.find((t) => fileOf(t) === name)
        if (!take) return { ok: false, message: 'That take is not on the board.' }
        let bytes: Uint8Array
        try {
          bytes = new Uint8Array(await Bun.file(join(found.root, found.folder, name)).arrayBuffer())
        } catch {
          return { ok: false, message: 'The take’s sound file could not be read.' }
        }
        let trim: Trim | undefined
        if (undo) {
          if (!take.trim) return { ok: false, message: 'That take is not trimmed.' }
        } else {
          let finding: ReturnType<typeof findTrim>
          try {
            finding = findTrim(readWav(bytes))
          } catch {
            return { ok: false, message: 'The take’s sound file could not be read.' }
          }
          if (finding.kind === 'nothing') return { ok: false, message: NOTHING_LINE }
          if (finding.kind === 'silent') return { ok: false, message: SILENT_LINE }
          trim = { start: finding.start, end: finding.end }
        }
        const { trim: _was, ...rest } = take
        const next: BoardTake = trim ? { ...rest, trim } : rest
        const problems: Problem[] = []
        const chosenTracks = await readChosen(found.root, found.music, problems)
        if (!chosenTracks.read || problems.length) {
          return { ok: false, message: 'The music lock could not be read.' }
        }
        const chosen = chosenTracks.entries[id]?.lock
        if (chosen?.take === take.n && chosen.fp === take.hash) {
          let played: ReturnType<typeof playedOf>
          try {
            played = playedOf(next, bytes)
          } catch {
            return { ok: false, message: 'The take’s sound file could not be read.' }
          }
          const committed = await commitChoice({
            root: found.root,
            projectFile,
            music: found.music,
            id,
            listId: found.listId,
            // The lock keeps what Accept made it count the take as made from, and when it was chosen.
            take: { ...played.take, inputs: chosen.inputs },
            now: () => new Date(chosen.at),
            wav: played.wav,
            encode,
          })
          if (!committed.ok) {
            return 'message' in committed
              ? { ok: false, message: plainReason(committed.message) }
              : { ok: false, message: `${committed.file} could not be read` }
          }
        }
        board.takes = board.takes.map((t) => (t === take ? next : t))
        return { ok: true }
      }).catch(refusalAnswer('saving the trim failed', (sentence) => `${sentence}.`))
    },

    async trimmedSound(projectFile, id, name) {
      const path = await api.takeFile(projectFile, id, name)
      const found = await resolve(projectFile, id)
      if (!path || !found || !('inputs' in found)) return null
      const board = await readBoard(found.root, found.board)
      if ('ok' in board) return null
      const take = board.takes.find((t) => fileOf(t) === name)
      if (!take?.trim) return null
      // Only the cuts: the fades are asked for in the address, or saved ones would be applied twice.
      return playedOf(
        { ...take, fades: undefined },
        new Uint8Array(await Bun.file(path).arrayBuffer()),
      ).wav
    },

    async unchoose(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      // In the board's turn, like Choose and Drop, so none slips between another's check and write.
      return boards.run(`${projectFile}\0${id}`, () =>
        uncommitChoice({ root: found.root, projectFile, music: found.music, id }),
      )
    },

    async accept(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      return boards.run(`${projectFile}\0${id}`, () =>
        acceptChange({ root: found.root, projectFile, id, now: found.inputs }),
      )
    },

    async move(projectFile, id, name, toId) {
      const from = await resolve(projectFile, id)
      if (!from || !('inputs' in from)) return from
      const to = await resolve(projectFile, toId)
      if (!to) return { ok: false, message: 'That track is not in the game’s list.' }
      if (!('inputs' in to)) return to
      if (to.id === from.id)
        return { ok: false, message: 'A take cannot move to the track it is on.' }
      if (to.inputs.kind !== from.inputs.kind) {
        return { ok: false, message: 'A loop can only move to a loop, and a stinger to a stinger.' }
      }
      // Checked before the boards' turns: a refresh rewrites the game's list, never the boards, so one
      // that starts in between cannot harm the move.
      for (const track of [from, to]) {
        const busy =
          track.listId === 'stingers'
            ? isRefreshingShared(projectFile)
            : isRefreshing(projectFile, track.listId)
        if (busy) return { ok: false, message: `${track.title} is being refreshed from the game.` }
      }
      // Both boards' turns, in a fixed order, so two moves the other way round cannot wait on each other.
      const [first, second] = [from.id, to.id].sort()
      return boards.run(`${projectFile}\0${first}`, () =>
        boards.run(`${projectFile}\0${second}`, async (): Promise<MoveResult> => {
          const problems: Problem[] = []
          const chosenTracks = await readChosen(from.root, from.music, problems)
          if (!chosenTracks.read || problems.length) {
            return { ok: false, message: 'The music lock could not be read.' }
          }
          const source = await readBoard(from.root, from.board)
          if ('ok' in source) return source
          const target = await readBoard(to.root, to.board)
          if ('ok' in target) return target
          const take = source.takes.find((t) => fileOf(t) === name)
          if (!take) return { ok: false, message: 'That take is not on the board.' }
          const chosen = chosenTracks.entries[id]?.lock
          if (chosen?.take === take.n && chosen.fp === take.hash) {
            return { ok: false, message: 'That take is the one in the game; choose another first.' }
          }
          let wav: Uint8Array
          try {
            wav = new Uint8Array(
              await Bun.file(resolveInRoot(from.root, `${from.folder}/${name}`)).arrayBuffer(),
            )
          } catch {
            return { ok: false, message: 'That take’s sound is gone, so it cannot be moved.' }
          }
          // The number a take being made there holds is not taken.
          const n = Math.max(
            target.next,
            ...entriesOf(projectFile, to.id).map((entry) => entry.n + 1),
          )
          const moved = movedBoardTake(take, {
            n,
            hash: to.hash,
            inputs: to.inputs,
            from: from.title,
          })
          // The sound first, then the destination's board, then the source's: a failure part-way
          // leaves the take on both boards, never on neither.
          await writeAtomic(to.root, `${to.folder}/${fileOf(moved)}`, wav)
          target.next = n + 1
          target.takes = [...target.takes, moved].sort((a, b) => a.n - b.n)
          await writeAtomic(to.root, to.board, `${JSON.stringify(target, null, 2)}\n`)
          source.takes = source.takes.filter((t) => t !== take)
          await writeAtomic(from.root, from.board, `${JSON.stringify(source, null, 2)}\n`)
          await rm(resolveInRoot(from.root, `${from.folder}/${name}`), { force: true })
          return { ok: true, n }
        }),
      )
    },

    async making(projectFile) {
      const summary: Record<string, MusicMakingSummary> = {}
      const prefix = `${projectFile}\0`
      for (const [key, entries] of active) {
        if (!key.startsWith(prefix)) continue
        let takes = 0
        let left = 0
        let failed = 0
        for (const entry of entries.values()) {
          if (entry.state === 'failed') {
            failed++
            continue
          }
          takes++
          const expected = musicModel(entry.model).seconds
          left +=
            entry.state === 'waiting'
              ? expected
              : Math.max(0, expected - (now() - entry.startedAt) / 1000)
        }
        if (takes || failed) summary[key.slice(prefix.length)] = { takes, left, failed }
      }
      return summary
    },

    async takeFile(projectFile, id, name) {
      if (!TAKE_FILE.test(name)) return null
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return null
      const file = join(found.root, found.folder, name)
      return (await Bun.file(file).exists()) ? file : null
    },
  }
  return api
}

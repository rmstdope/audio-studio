import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
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
  type MakingSummary,
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
  tooLongOnTrack,
  type MusicModelId,
} from '../core/musicModels'
import { trackFor, type TrackRow } from '../core/music'
import type { Problem } from '../core/project'
import { resolveInRoot } from '../core/paths'
import { readWav } from '../core/wav'
import { ffmpegEncoder, type Encoder } from './audio'
import { readResource, writeAtomic } from './files'
import { gpuQueue, GPU } from './gpu'
import type { MusicGenerator } from './music'
import { commitChoice, readChosen, uncommitChoice, type CommitResult } from './musicClips'
import { readMusic } from './musicLists'
import { createSerial, type Serial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** Where a project's music takes are cached, one folder per track. */
export const MUSIC_TAKES_DIR = '.audio-studio/music-takes'

/** Where a track's board is saved: one file per track (a track id is a safe file name). */
export const MUSIC_BOARD_DIR = '.audio-studio/music'

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

/** What dropping a take answered; null for a track the project does not list. */
export type DropResult = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** What stopping answered: how many takes were stopped, made or waiting; null for an unknown track. */
export type StopResult = { ok: true; stopped: number } | ProjectFailure | null

/** What choosing a take answered; null for a track the project does not list. */
export type ChooseResult = CommitResult | null

/** A track's takes as the page shows them, a project failure, or null for an unknown track. */
export type TakesResult = MusicTakesView | ProjectFailure | null

/** Changes to one track's board, one after another, keyed `<project file>\0<track id>`. */
export function boardQueue(): Serial {
  const shared = globalThis as { audioStudioBoardQueue?: Serial }
  return (shared.audioStudioBoardQueue ??= createSerial())
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
  /** The hash of the inputs it is made for; the page shows only the current inputs'. */
  hash: string
  /** Ends the take while it is being made (Stop). */
  stop?: AbortController
  /** The music model it is made with; a retry makes it again with the same. */
  model: MusicModelId
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
  /** Makes a take on the board the track's music: levelled, encoded, with the manifest and lock. */
  choose(projectFile: string, id: string, name: string): Promise<ChooseResult>
  /** Takes the track's chosen take back: its music file, manifest entry and lock entry go; the take stays on the board. */
  unchoose(projectFile: string, id: string): Promise<ChooseResult>
  /** Takes a take off the board and deletes its file; the chosen take stays. */
  drop(projectFile: string, id: string, name: string): Promise<DropResult>
  /** What is being made in the project, by track, for the lists' status. */
  making(projectFile: string): Promise<Record<string, MakingSummary>>
  /** The path of a take's WAV, or null for a track not listed or a name that is not a take's. */
  takeFile(projectFile: string, id: string, name: string): Promise<string | null>
}

/** A take's file name on the board. */
const fileOf = (take: Pick<BoardTake, 'hash' | 'n'>) => `${take.hash}.${take.n}.wav`

/**
 * The takes of the game's music: made by `generator` on the GPU `queue` (shared with Whisper),
 * shaped to what the game would play, and kept on a board per track in
 * `.audio-studio/music/<track>.json` (each take with its seed, waveform and the inputs it was made
 * from), its WAV in `.audio-studio/music-takes/<track>/<hash>.<n>.wav`. Takes waiting, being made
 * and failed are kept in memory, per track, for the page to poll (they survive a `--dev` reload,
 * not a restart); a take made is a file and a board entry.
 */
export function createMusicTakes({
  generator,
  queue = gpuQueue(),
  now = Date.now,
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
  encode = ffmpegEncoder,
}: {
  generator: MusicGenerator
  queue?: Serial
  now?: () => number
  newSeed?: () => number
  /** Encodes the chosen take (tests); ffmpeg by default. */
  encode?: Encoder
}): MusicTakes {
  // On `globalThis` like the GPU queue the jobs run on, so a `--dev` reload keeps what is being made.
  const shared = globalThis as { audioStudioMakingTakes?: Map<string, Map<number, Entry>> }
  const active = (shared.audioStudioMakingTakes ??= new Map())
  // Changes to one track's board, one after another: a take finishing and a drop lose neither.
  const boards = boardQueue()

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
  ): Promise<T | ProjectFailure> {
    return boards.run(`${projectFile}\0${found.id}`, async () => {
      const board = await readBoard(found.root, found.board)
      if ('ok' in board) return board
      const before = JSON.stringify(board, null, 2)
      const answer = await change(board)
      const after = JSON.stringify(board, null, 2)
      // Nothing changed (a drop of a take that is not there): nothing is written.
      if (after !== before) await writeAtomic(found.root, found.board, `${after}\n`)
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
      // Stopped while it was made: it is discarded, and no longer in the map.
      if (stop.signal.aborted) return
      const shaped = shapeTake(take.wav, inputs.kind, inputs.seconds)
      const wav = readWav(shaped)
      const made: BoardTake = {
        n: entry.n,
        hash: entry.hash,
        seed: take.seed,
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
    }
  }

  /** A track's entries: waiting, being made, or failed. */
  const entriesOf = (projectFile: string, id: string) =>
    [...(active.get(`${projectFile}\0${id}`)?.values() ?? [])].sort((a, b) => a.n - b.n)

  return {
    async view(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      const { root, inputs, hash, folder } = found
      // The entries first: one is dropped only after the board has it, so a take is then in the
      // board read after, never in neither.
      const entries = entriesOf(projectFile, id)
      const board = await readBoard(root, found.board)
      if ('ok' in board) return board
      const chosen = (await readChosen(root, found.music, []))[id]?.lock
      const takes: TakeView[] = []
      for (const take of board.takes) {
        if (!(await Bun.file(join(root, folder, fileOf(take))).exists())) continue
        takes.push({
          n: take.n,
          file: fileOf(take),
          seconds: take.seconds,
          seed: take.seed,
          peaks: take.peaks,
          earlier: take.hash !== hash,
          chosen: chosen?.take === take.n && chosen.fp === take.hash,
          model: modelLine(take.model),
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
        }))
      const failed: FailedView[] = entries
        .filter((entry) => entry.state === 'failed' && entry.hash === hash)
        .map((entry) => ({
          n: entry.n,
          message: entry.message,
          model: lineOf(entry.model),
        }))
      const models = MUSIC_MODELS.map(({ id }) => ({ id, installed: generator.installed(id) }))
      // Not installed at all when no model is here: the first one that is says the rest (the
      // machine and uv); with none, the project's model says what to download.
      const here = models.find((m) => m.installed)
      return {
        ok: true,
        kind: inputs.kind,
        generator: generator.ready(here?.id ?? found.model),
        defaultModel: found.model,
        models,
        takes,
        making,
        failed,
      }
    },

    async make(projectFile, id, request) {
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
      if (!generator.installed(model)) {
        return { ok: false, message: `${musicModel(model).name} is not on this computer.` }
      }
      const ready = generator.ready(model)
      if (!ready.ok) return { ok: false, message: ready.message }
      const key = `${projectFile}\0${id}`
      const entries = active.get(key) ?? new Map<number, Entry>()
      active.set(key, entries)
      const queued: Entry[] = []
      if ('retry' in request) {
        const failed = entries.get(request.retry)
        if (!failed || failed.state !== 'failed' || failed.hash !== hash) {
          return {
            ok: false,
            message: `Take ${request.retry} did not fail, so it is not made again.`,
          }
        }
        failed.state = 'waiting'
        queued.push(failed)
      } else {
        // The numbers are reserved on the board at once, so none is used twice, even by a take
        // that fails or is stopped.
        const reserved = await changeBoard(projectFile, found, (board) => {
          const first = Math.max(board.next, ...[...entries.values()].map((entry) => entry.n + 1))
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
            hash,
            model,
          }
          entries.set(entry.n, entry)
          queued.push(entry)
        }
      }
      for (const entry of queued) {
        void queue.run(GPU, () => run(projectFile, found, entry, inputs, entries))
      }
      return { ok: true }
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
          if (problems.length) return { ok: false, file: found.music.paths.lock, problems }
          const chosen = chosenTracks[id]?.lock
          const take = board.takes.find((t) => fileOf(t) === name)
          if (!take) return { ok: false, message: 'That take is not on the board.' }
          if (chosen?.take === take.n && chosen.fp === take.hash) {
            return { ok: false, message: 'That take is the one in the game; choose another first.' }
          }
          board.takes = board.takes.filter((t) => t !== take)
          return { dropped: take }
        },
      )
      if (!outcome || !('dropped' in outcome)) return outcome
      await rm(resolveInRoot(found.root, `${found.folder}/${fileOf(outcome.dropped)}`), {
        force: true,
      })
      return { ok: true }
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
        return commitChoice({
          root: found.root,
          projectFile,
          music: found.music,
          id,
          listId: found.listId,
          take,
          wav,
          encode,
        })
      })
    },

    async unchoose(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      // In the board's turn, like Choose and Drop, so none slips between another's check and write.
      return boards.run(`${projectFile}\0${id}`, () =>
        uncommitChoice({ root: found.root, projectFile, music: found.music, id }),
      )
    },

    async making(projectFile) {
      const summary: Record<string, MakingSummary> = {}
      const prefix = `${projectFile}\0`
      for (const [key, entries] of active) {
        if (!key.startsWith(prefix)) continue
        let takes = 0
        let left = 0
        for (const entry of entries.values()) {
          if (entry.state === 'failed') continue
          takes++
          const expected = musicModel(entry.model).seconds
          left +=
            entry.state === 'waiting'
              ? expected
              : Math.max(0, expected - (now() - entry.startedAt) / 1000)
        }
        if (takes) summary[key.slice(prefix.length)] = { takes, left }
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
}

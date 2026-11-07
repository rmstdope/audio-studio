import { createHash } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DEFAULT_EFFECT_MODEL,
  EFFECT_MODEL_IDS,
  defaultEffectModel,
  effectModel,
  type EffectModelId,
  type EffectModelState,
} from '../core/effectModels'
import {
  effectTakeChoosable,
  type EffectBoard,
  type EffectBoardTake,
  type EffectFailedView,
  type EffectInputs,
  type EffectMakingSummary,
  type EffectMakingView,
  type EffectModelsView,
  type EffectTakesView,
  type EffectTakeView,
} from '../core/effectTakes'
import { EFFECT_TRIM_RULES, effectTrimOffered } from '../core/effectTrim'
import {
  NOTHING_LINE,
  SILENT_LINE,
  findTrim,
  trimWav,
  trimmedSeconds,
  type Trim,
} from '../core/musicTrim'
import { resolveInRoot } from '../core/paths'
import { shapeEffectLoop, loopRequestSeconds } from '../core/effectLoop'
import { peaks, wavSeconds } from '../core/musicTake'
import { readWav, writeWav } from '../core/wav'
import { applyFades, fadesProblem, hasFades, type Fades } from '../core/fades'
import { ffmpegEncoder, type Encoder } from './audio'
import { EFFECT_BOARD_DIR, EFFECT_TAKES_DIR, boardFile, readEffectBoard } from './effectBoards'
import { acceptEffect, commitEffect, readEffectChosen, uncommitEffect } from './effectClips'
import { readEffects } from './effectsLists'
import type { EffectGenerator } from './effects'
import type { EffectHealthStore } from './effectHealth'
import { gpuInUse, gpuQueue, GPU, holdGpu } from './gpu'
import { writeAtomic } from './files'
import { EFFECTS_LOCK_FILE } from '../core/project'
import type { CommitResult } from './musicClips'
import { createSerial, type Serial } from './serial'
import { MAKE_ALL_TAKES, type EffectBatch } from '../core/effectsMakeAll'
import { openProject, type ProjectFailure } from './workspace'

export { EFFECT_BOARD_DIR, EFFECT_TAKES_DIR }

/** How many bars a take's waveform has. */
const WAVEFORM_BARS = 120

/** An effect id is a slug (the game's list is validated); this guards the board's path on its own. */
const SAFE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** A take's file name: the hash of its inputs, its number, `.wav`. */
const TAKE_FILE = /^([0-9a-f]{16})\.(\d+)\.wav$/

/** The queue key Small SFX's effects are made on: one at a time, on the CPU. */
const CPU = 'effects'

/** What to make: this many new takes (with `model`, else the default for the effect), or the failed take with this number again. */
export type MakeEffectRequest = { count: number; model?: EffectModelId } | { retry: number }

/** What asking for takes, dropping or stopping answered; null for an effect the project does not list. */
export type EffectMakeResult =
  | { ok: true }
  | {
      ok: false
      message: string
      /** Set when saving fades failed and the game's file could not be put back as it was. */
      gameChanged?: true
    }
  | ProjectFailure
  | null

/** What stopping answered: how many takes were stopped, made or waiting; null for an unknown effect. */
export type EffectStopResult = { ok: true; stopped: number } | ProjectFailure | null

/** What trimming or untrimming a take answered; null for an effect the project does not list. */
export type EffectTrimResult = CommitResult | null

/** What choosing, un-choosing or accepting answered; null for an effect the project does not list. */
export type EffectChooseResult = CommitResult | null

/** An effect's takes as the page shows them, a project failure, or null for an unknown effect. */
export type EffectTakesResult = EffectTakesView | ProjectFailure | null

/**
 * A hash of what went into a take: the description in use, the length, and for a loop the word
 * "loop" (the model is the take's own field).
 */
export function effectTakeHash(inputs: EffectInputs): string {
  const parts = [inputs.description, inputs.seconds, ...(inputs.loops ? ['loop'] : [])]
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16)
}

/** The takes the latest Make all started, by effect, and how many of them were stopped. */
interface Batch {
  total: number
  stopped: number
  ns: Map<string, Set<number>>
}

/** A take being made or waiting, or one that failed, until it is made. */
interface Entry {
  n: number
  state: 'waiting' | 'making' | 'failed'
  startedAt: number
  message: string
  /** The hash of the inputs it is made for; the page shows only the current inputs'. */
  hash: string
  /** The model it is made with. */
  model: EffectModelId
  /** Ends the take while it is being made (Stop). */
  stop?: AbortController
}

/** What Make all answered: the effects that got takes, or why nothing was started. */
export type EffectMakeAllResult =
  | { ok: true; started: { id: string; takes: number }[] }
  | { ok: false; message: string }
  | ProjectFailure

/** What Stop all answered: how many takes were stopped. */
export type EffectStopAllResult = EffectStopResult

/** What the takes of an effect are made of. */
export interface EffectTakes {
  /** Which models can run, for the project as a whole; null when the project has no effects section. */
  models(projectFile: string): Promise<EffectModelsView | ProjectFailure | null>
  /** Four takes for each listed effect that has no chosen take and is not making takes; the others are skipped. */
  makeAll(projectFile: string, ids: string[]): Promise<EffectMakeAllResult>
  /** Stops every take waiting or being made in the project. */
  stopAll(projectFile: string): Promise<EffectStopAllResult>
  /** What the latest Make all made, stopped and failed so far; null when there has been none. */
  batch(projectFile: string): Promise<EffectBatch | null>
  /** Forgets the latest Make all's summary (Close); a press that still runs is not forgotten. */
  closeBatch(projectFile: string): Promise<{ ok: true }>
  /** The effect's board, and the takes being made. */
  view(projectFile: string, id: string): Promise<EffectTakesResult>
  /** Queues takes and returns at once; they are made one at a time. */
  make(projectFile: string, id: string, request: MakeEffectRequest): Promise<EffectMakeResult>
  /** Stops the effect's takes: the one being made ends and is discarded, the waiting ones never start. */
  stop(projectFile: string, id: string): Promise<EffectStopResult>
  /** Makes a take on the board the effect's clip: encoded, with the manifest and lock. */
  choose(projectFile: string, id: string, name: string): Promise<EffectChooseResult>
  /** Takes the chosen take back: its clip, manifest entry and lock entry go; the take stays on the board. */
  unchoose(projectFile: string, id: string): Promise<EffectChooseResult>
  /** Accepts a changed description: the chosen take counts as made from it. A changed length is refused. */
  accept(projectFile: string, id: string): Promise<EffectChooseResult>
  /**
   * Saves the fades of a take made to play once, or removes them (null). The take on the board stays
   * as generated; if it is the chosen one, the game's file is written again with the faded sound
   * first (the lock and manifest untouched), and nothing changes if that fails.
   */
  setFades(
    projectFile: string,
    id: string,
    name: string,
    fades: Fades | null,
  ): Promise<EffectMakeResult>
  /** Takes a take off the board and deletes its file; the chosen take stays. */
  drop(projectFile: string, id: string, name: string): Promise<EffectMakeResult>
  /**
   * Cuts the near-silent start and end of a take made to play once (or, with `undo`, gives it back
   * as generated). The WAV stays as generated; the cut is kept on the board. A take that is the
   * one in the game, with its clip there, has the game's file rewritten first, and nothing changes
   * if that fails.
   */
  trim(projectFile: string, id: string, name: string, undo: boolean): Promise<EffectTrimResult>
  /** A trimmed take's sound between its cuts as a WAV; null for a take that is not trimmed. */
  trimmedSound(projectFile: string, id: string, name: string): Promise<Uint8Array | null>
  /** What is being made in the project, by effect, for the list's status. */
  making(projectFile: string): Promise<Record<string, EffectMakingSummary>>
  /** The path of a take's WAV, or null for an effect not listed or a name that is not a take's. */
  takeFile(projectFile: string, id: string, name: string): Promise<string | null>
}

/** A take's file name on the board. */
const fileOf = (take: Pick<EffectBoardTake, 'hash' | 'n'>) => `${take.hash}.${take.n}.wav`

/**
 * What the game plays of a take: its WAV between the cuts if it was trimmed, then with its fades if
 * it has some, and the take as the board should hand it to the encoder, with the length that is left.
 */
function playedOf(take: EffectBoardTake, bytes: Uint8Array) {
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

/** A take board that could not be saved, after anything the change wrote elsewhere was undone. */
class BoardNotWritten extends Error {
  constructor(
    /** The board's path in the project. */
    readonly file: string,
    cause: unknown,
  ) {
    super(`${file} could not be written`, { cause })
  }
}

/** A refusal of a choice as a bare reason: "Take 1 could not be chosen: X. Nothing was changed." gives "X". */
function plainReason(message: string): string {
  return message
    .replace(/^Take \d+ could not be chosen: /, '')
    .replace(/\.? Nothing was changed\.$/, '')
    .replace(/\.$/, '')
}

/** A model's full name; an id the studio does not know is shown as it is. */
const modelName = (id: string) =>
  (EFFECT_MODEL_IDS as readonly string[]).includes(id) ? effectModel(id as EffectModelId).name : id

/** A failure as a sentence for the page. */
function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/**
 * The takes of the game's sound effects: made by `generator` one at a time (the CPU), each ending
 * where its sound ends, and kept on a board per effect in `content-studio/cache/effect-boards/<effect>.json`
 * (with its seed, real length and waveform), its WAV in
 * `content-studio/cache/effect-takes/<effect>/<hash>.<n>.wav`. Takes waiting, being made and failed are
 * kept in memory, per effect, for the page to poll (they survive a `--dev` reload, not a restart).
 * The generator's failures and successes go to `health`, which Setup's Sound-effect models row reads.
 */
export function createEffectTakes({
  generator,
  health,
  queue,
  gpu = gpuQueue(),
  hasUv = () => Bun.which('uv') !== null,
  now = Date.now,
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
  encode = ffmpegEncoder,
}: {
  generator: EffectGenerator
  health?: Pick<EffectHealthStore, 'read' | 'record' | 'clear'>
  /** Where Small SFX's takes wait their turn (the CPU); one shared queue by default. */
  queue?: Serial
  /** Where Open 1.0's takes wait their turn, with music, images and recording checks; the process's GPU queue by default. */
  gpu?: Serial
  /** Whether uv, which runs the models, is on the PATH (tests). */
  hasUv?: () => boolean
  now?: () => number
  newSeed?: () => number
  /** Encodes the chosen take (tests); ffmpeg by default. */
  encode?: Encoder
}): EffectTakes {
  // On `globalThis`, so a `--dev` reload keeps what is being made and the one queue.
  const shared = globalThis as {
    contentStudioEffectEntries?: Map<string, Map<number, Entry>>
    contentStudioEffectQueue?: Serial
    contentStudioEffectBoards?: Serial
    contentStudioEffectBatches?: Map<string, Batch>
  }
  const active = (shared.contentStudioEffectEntries ??= new Map())
  const cpu = queue ?? (shared.contentStudioEffectQueue ??= createSerial())
  // Changes to one effect's board, one after another: a take finishing and a drop lose neither.
  const boards = (shared.contentStudioEffectBoards ??= createSerial())
  // The latest Make all of each project, so its summary can be worked out from what is running.
  const batches = (shared.contentStudioEffectBatches ??= new Map())
  const keyOf = (projectFile: string, id: string) => `${projectFile}\0${id}`
  // Set while Make all starts its own takes, which are not hand starts.
  let pressing = false
  // What a take has to cut, by its file's path, size and time, so a poll reads no WAV again.
  const scans = new Map<string, NonNullable<EffectTakeView['trimmable']>>()

  /** What the WAV at `path` has to cut; null when it cannot be read. */
  async function scan(path: string): Promise<NonNullable<EffectTakeView['trimmable']> | null> {
    try {
      // The time to the nanosecond, so a sound written again at once is not taken for the one before.
      const { size, mtimeMs, ctimeMs } = await stat(path)
      const key = `${path}\0${size}\0${mtimeMs}\0${ctimeMs}`
      const known = scans.get(key)
      if (known) return known
      const found = findTrim(
        readWav(new Uint8Array(await Bun.file(path).arrayBuffer())),
        EFFECT_TRIM_RULES,
      )
      scans.set(key, found.kind)
      return found.kind
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
    if (!project.effects) return null
    const row = (await readEffects(root, project, []))?.rows.find((r) => r.id === id)
    if (!row) return null
    const inputs: EffectInputs = {
      description: row.description,
      seconds: row.seconds,
      ...(row.loops && { loops: true }),
    }
    return {
      root,
      id,
      effects: project.effects,
      inputs,
      projectModel: project.effects.model ?? DEFAULT_EFFECT_MODEL,
      hash: effectTakeHash(inputs),
      folder: `${EFFECT_TAKES_DIR}/${id}`,
    }
  }
  type Found = Exclude<Awaited<ReturnType<typeof resolve>>, ProjectFailure | null>

  /** Changes an effect's board and saves it; what `change` returns is the answer. */
  function changeBoard<T>(
    projectFile: string,
    found: Found,
    change: (board: EffectBoard) => T | Promise<T>,
    /** Called when the board cannot be written, to take back what `change` did elsewhere. */
    undo?: () => Promise<void>,
  ): Promise<T | ProjectFailure> {
    return boards.run(keyOf(projectFile, found.id), async () => {
      const board = await readEffectBoard(found.root, found.id)
      if ('ok' in board) return board
      const before = JSON.stringify(board, null, 2)
      const answer = await change(board)
      const after = JSON.stringify(board, null, 2)
      if (after !== before) {
        try {
          await writeAtomic(found.root, boardFile(found.id), `${after}\n`)
        } catch (error) {
          await undo?.()
          throw new BoardNotWritten(boardFile(found.id), error)
        }
      }
      return answer
    })
  }

  async function run(
    projectFile: string,
    found: Found,
    entry: Entry,
    waiting: Map<number, Entry>,
  ): Promise<void> {
    // Stopped while it waited: it is no longer in the map.
    if (waiting.get(entry.n) !== entry || entry.state !== 'waiting') return
    entry.state = 'making'
    entry.startedAt = now()
    const stop = new AbortController()
    entry.stop = stop
    const { inputs } = found
    try {
      const generate = () =>
        generator.generate(
          {
            prompt: inputs.description,
            seconds: inputs.loops ? loopRequestSeconds(inputs.seconds) : inputs.seconds,
            seed: newSeed(),
            model: entry.model,
            ...(inputs.loops && { loops: true }),
          },
          stop.signal,
        )
      const take = await (entry.model === 'open-1' ? holdGpu('effect', generate) : generate())
      // Stopped while it was made: it is discarded, and no longer in the map.
      if (stop.signal.aborted) return
      // A loop is made seamless at the length the game asks; a one-shot ends where its sound does.
      const shaped = inputs.loops ? shapeEffectLoop(readWav(take.wav), inputs.seconds) : null
      const wav = shaped ? shaped.wav : readWav(take.wav)
      const bytes = shaped ? writeWav(wav) : take.wav
      const made: EffectBoardTake = {
        n: entry.n,
        hash: entry.hash,
        seed: take.seed,
        model: entry.model,
        seconds: wavSeconds(wav),
        peaks: peaks(wav, WAVEFORM_BARS),
        inputs,
        ...(shaped?.quietAt != null && { quietAt: shaped.quietAt }),
      }
      // The file first: a take is on the board only once its WAV is there.
      await writeAtomic(found.root, `${found.folder}/${fileOf(made)}`, bytes)
      const saved = await changeBoard(projectFile, found, async (board) => {
        // A stopped take is no news of the model: its last failure stays.
        if (stop.signal.aborted) return
        // The model worked: its failure is cleared before the take shows, so a page that sees the
        // take made sees the model well too.
        await health?.clear(projectFile, entry.model).catch(() => {})
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
      const last = entry.message.split('\n').filter(Boolean).pop() ?? entry.message
      await health
        ?.record(projectFile, entry.model, { error: last, effect: found.id })
        .catch(() => {})
    }
  }

  /** Each model: how much of it is on this computer, and whether its last effect failed. */
  async function modelStates(projectFile: string) {
    const failures = (await health?.read(projectFile)) ?? {}
    const states = {} as Record<EffectModelId, EffectModelState>
    for (const id of EFFECT_MODEL_IDS) {
      states[id] = { download: await generator.download(id), failed: Boolean(failures[id]) }
    }
    return states
  }

  /** Which models can run here. */
  async function modelsOf(projectFile: string, projectModel = DEFAULT_EFFECT_MODEL) {
    const states = await modelStates(projectFile)
    const runnable = await Promise.all(
      EFFECT_MODEL_IDS.map(async (model) => (await generator.ready(model)).ok),
    )
    return {
      ok: true as const,
      canMake: runnable.some(Boolean),
      projectModel,
      uv: hasUv(),
      models: EFFECT_MODEL_IDS.map((model) => ({ id: model, ...states[model] })),
    }
  }

  /** Counts a take stopped into the latest Make all, if it was one of its takes. */
  function countStopped(projectFile: string, id: string, n: number) {
    const batch = batches.get(projectFile)
    if (batch?.ns.get(id)?.has(n)) batch.stopped++
  }

  /** Whether any take of the press is still waiting or being made. */
  function pressRunning(projectFile: string, press: Batch) {
    for (const [id, ns] of press.ns) {
      for (const entry of entriesOf(projectFile, id)) {
        if (ns.has(entry.n) && entry.state !== 'failed') return true
      }
    }
    return false
  }

  /** An effect's entries: waiting, being made, or failed. */
  const entriesOf = (projectFile: string, id: string) =>
    [...(active.get(keyOf(projectFile, id))?.values() ?? [])].sort((a, b) => a.n - b.n)

  const api: EffectTakes = {
    async models(projectFile) {
      const opened = await openProject(projectFile)
      if (!opened.ok) return opened
      if (!opened.project.effects) return null
      return modelsOf(projectFile, opened.project.effects.model ?? DEFAULT_EFFECT_MODEL)
    },

    async view(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      const { root, hash, folder } = found
      // The entries first: one is dropped only after the board has it, so a take is then in the
      // board read after, never in neither.
      const entries = entriesOf(projectFile, id)
      const board = await readEffectBoard(root, id)
      if ('ok' in board) return board
      const chosenEffects = await readEffectChosen(root, found.effects, [])
      const chosen = chosenEffects?.[id]?.lock
      const takes: EffectTakeView[] = []
      for (const take of board.takes) {
        const path = join(root, folder, fileOf(take))
        if (!(await Bun.file(path).exists())) continue
        const loops = Boolean(take.inputs.loops)
        const trimmable =
          !take.trim && effectTrimOffered({ loops }, Boolean(found.inputs.loops))
            ? await scan(path)
            : null
        takes.push({
          n: take.n,
          file: fileOf(take),
          seconds: take.seconds,
          peaks: take.peaks,
          chosen: chosen?.take === take.n && chosen.fp === take.hash,
          model: modelName(take.model),
          loops,
          quietAt: take.quietAt ?? null,
          ...(take.fades && { fades: take.fades }),
          ...(take.trim && {
            trim: { ...take.trim, seconds: trimmedSeconds(take.seconds, take.trim) },
          }),
          ...(trimmable && { trimmable }),
        })
      }
      const pending = entries.filter(
        (entry) => entry.state !== 'failed' && !takes.some((take) => take.n === entry.n),
      )
      // The first Open 1.0 take that waits for the chip says so and what is using it, unless one
      // of this effect's own takes is making: then the takes behind it say "waiting".
      const first = pending.some((entry) => entry.state === 'making')
        ? undefined
        : pending.find((entry) => entry.state === 'waiting' && entry.model === 'open-1')
      const making: EffectMakingView[] = pending.map((entry) => ({
        n: entry.n,
        state: entry.state as 'waiting' | 'making',
        elapsed: entry.state === 'making' ? Math.max(0, (now() - entry.startedAt) / 1000) : 0,
        expected: effectModel(entry.model).seconds,
        model: modelName(entry.model),
        ...(entry === first ? { chip: { using: gpuInUse() } } : {}),
      }))
      const failed: EffectFailedView[] = entries
        .filter((entry) => entry.state === 'failed' && entry.hash === hash)
        .map((entry) => ({ n: entry.n, message: entry.message }))
      const modelsView = await modelsOf(projectFile, found.projectModel)
      return {
        ...modelsView,
        takes,
        making,
        failed,
        lockUnread: chosenEffects === null,
      }
    },

    async make(projectFile, id, request) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      const { hash } = found
      const key = keyOf(projectFile, id)
      const entries0 = active.get(key)
      let model: EffectModelId
      if ('retry' in request) {
        const failed = entries0?.get(request.retry)
        if (!failed || failed.state !== 'failed' || failed.hash !== hash) {
          return {
            ok: false,
            message: `Take ${request.retry} did not fail, so it is not made again.`,
          }
        }
        model = failed.model
      } else {
        model =
          request.model ??
          defaultEffectModel(found.projectModel, await modelStates(projectFile), hasUv())
      }
      const ready = await generator.ready(model)
      if (!ready.ok) return { ok: false, message: ready.message }

      // Takes started by hand (a retry too) end the summary of a finished press; read before the
      // entries change. One still running goes on.
      const press = batches.get(projectFile)
      const ended = !pressing && press !== undefined && !pressRunning(projectFile, press)
      const entries = active.get(key) ?? new Map<number, Entry>()
      active.set(key, entries)
      const queued: Entry[] = []
      if ('retry' in request) {
        const failed = entries.get(request.retry)!
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
      if (ended) batches.delete(projectFile)
      for (const entry of queued) {
        const make = () => run(projectFile, found, entry, entries)
        void (entry.model === 'open-1' ? gpu.run(GPU, make) : cpu.run(CPU, make))
      }
      return { ok: true }
    },

    async stop(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      let stopped = 0
      const entries = active.get(keyOf(projectFile, id))
      if (!entries) return { ok: true, stopped: 0 }
      for (const [n, entry] of entries) {
        if (entry.state === 'failed') continue
        entry.stop?.abort()
        entries.delete(n)
        countStopped(projectFile, id, n)
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
        async (board): Promise<EffectMakeResult | { dropped: EffectBoardTake }> => {
          const chosenEffects = await readEffectChosen(found.root, found.effects, [])
          // Which take the game plays is not known: nothing is dropped.
          if (!chosenEffects) {
            return { ok: false, message: 'The sound effects lock could not be read.' }
          }
          const chosen = chosenEffects[id]?.lock
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
      return boards.run(keyOf(projectFile, id), async (): Promise<CommitResult> => {
        const board = await readEffectBoard(found.root, id)
        if ('ok' in board) return board
        const take = board.takes.find((t) => fileOf(t) === name)
        if (!take) return { ok: false, message: 'That take is not on the board.' }
        if (
          !effectTakeChoosable({ loops: Boolean(take.inputs.loops) }, Boolean(found.inputs.loops))
        ) {
          const made = take.inputs.loops ? 'to loop' : 'to play once'
          const plays = found.inputs.loops ? 'loops' : 'plays once'
          return {
            ok: false,
            message: `Take ${take.n} was made ${made}, so it can't be chosen for an effect that ${plays}.`,
          }
        }
        let wav: Uint8Array
        try {
          wav = new Uint8Array(await Bun.file(join(found.root, found.folder, name)).arrayBuffer())
        } catch {
          return { ok: false, message: 'That take’s sound is gone, so it cannot be chosen.' }
        }
        let played: ReturnType<typeof playedOf>
        try {
          played = playedOf(take, wav)
        } catch {
          return { ok: false, message: 'That take’s sound is gone, so it cannot be chosen.' }
        }
        return commitEffect({
          root: found.root,
          projectFile,
          effects: found.effects,
          id,
          take: played.take,
          inUse: found.inputs,
          wav: played.wav,
          encode,
        })
      })
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
        async (board): Promise<EffectMakeResult> => {
          const chosenEffects = await readEffectChosen(found.root, found.effects, [])
          // Which take the game plays is not known: nothing is changed.
          if (!chosenEffects) {
            return { ok: false, message: 'The sound effects lock could not be read.' }
          }
          const take = board.takes.find((t) => fileOf(t) === name)
          if (!take) return { ok: false, message: 'That take is not on the board.' }
          if (take.inputs.loops || found.inputs.loops) {
            return { ok: false, message: 'Only a sound that plays once can fade.' }
          }
          // The fades are of what the game plays: the take between its cuts, if it is trimmed.
          const wrong =
            fades &&
            fadesProblem(fades, take.trim ? trimmedSeconds(take.seconds, take.trim) : take.seconds)
          if (wrong) return { ok: false, message: wrong }
          const next: EffectBoardTake = { ...take }
          delete next.fades
          if (fades && hasFades(fades)) next.fades = fades
          const chosen = chosenEffects[id]?.lock
          if (chosen?.take === take.n && chosen.fp === take.hash) {
            let wav: Uint8Array
            try {
              wav = new Uint8Array(
                await Bun.file(join(found.root, found.folder, name)).arrayBuffer(),
              )
            } catch {
              return { ok: false, message: 'That take’s sound is gone, so it cannot be faded.' }
            }
            let played: ReturnType<typeof playedOf>
            try {
              played = playedOf(next, wav)
            } catch {
              return { ok: false, message: 'That take’s sound cannot be faded.' }
            }
            const game = join(found.effects.clips, `${id}.mp3`)
            const was = await Bun.file(resolveInRoot(found.root, game))
              .bytes()
              .catch(() => null)
            putBack = async () => {
              if (was) await writeAtomic(found.root, game, was)
              else await rm(resolveInRoot(found.root, game), { force: true })
            }
            // Only the sound changes: the manifest and the lock (an accepted change too) stay as they are.
            const done = await commitEffect({
              root: found.root,
              projectFile,
              effects: found.effects,
              id,
              take: played.take,
              inUse: found.inputs,
              wav: played.wav,
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
      ).catch((error): EffectMakeResult => {
        // Kept in the server log: the person is told the plain reason, not the stack.
        console.error('saving the fades failed', error)
        return stuck
          ? {
              ok: false,
              message:
                'The take board could not be written, and the game’s file could not be put back.',
              gameChanged: true,
            }
          : { ok: false, message: 'The take board could not be written.' }
      })
    },

    async trim(projectFile, id, name, undo) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      /** Puts the game's files back, once the board turned out not to be writable. */
      let putBack: (() => Promise<void>) | null = null
      let stuck = false
      return changeBoard(
        projectFile,
        found,
        async (board): Promise<EffectTrimResult> => {
          const take = board.takes.find((t) => fileOf(t) === name)
          if (!take) return { ok: false, message: 'That take is not on the board.' }
          // Undo is always allowed, so a trim made before the effect began to loop is never stuck.
          if (
            !undo &&
            !effectTrimOffered({ loops: Boolean(take.inputs.loops) }, Boolean(found.inputs.loops))
          ) {
            return {
              ok: false,
              message:
                'Only a take made to play once, for an effect that plays once, can be trimmed.',
            }
          }
          // The sound is read only when it is needed: a new trim, or the game's file rewritten.
          const sound = async () => {
            try {
              return new Uint8Array(
                await Bun.file(join(found.root, found.folder, name)).arrayBuffer(),
              )
            } catch {
              return null
            }
          }
          let trim: Trim | undefined
          if (undo) {
            if (!take.trim) return { ok: false, message: 'That take is not trimmed.' }
          } else {
            const bytes = await sound()
            if (!bytes) return { ok: false, message: 'The take’s sound file could not be read.' }
            let finding: ReturnType<typeof findTrim>
            try {
              finding = findTrim(readWav(bytes), EFFECT_TRIM_RULES)
            } catch {
              return { ok: false, message: 'The take’s sound file could not be read.' }
            }
            if (finding.kind === 'nothing') return { ok: false, message: NOTHING_LINE }
            if (finding.kind === 'silent') return { ok: false, message: SILENT_LINE }
            trim = { start: finding.start, end: finding.end }
          }
          const { trim: _was, ...rest } = take
          const next: EffectBoardTake = trim ? { ...rest, trim } : rest
          const chosenEffects = await readEffectChosen(found.root, found.effects, [])
          if (!chosenEffects)
            return { ok: false, message: 'The sound effects lock could not be read.' }
          const chosen = chosenEffects[id]
          // The take in the game, with its clip there, is rewritten first; with the clip missing only
          // the take changes, and Choose again writes it.
          if (chosen?.fileExists && chosen.lock.take === take.n && chosen.lock.fp === take.hash) {
            let played: ReturnType<typeof playedOf>
            try {
              played = playedOf(next, (await sound()) ?? new Uint8Array())
            } catch {
              return { ok: false, message: 'The take’s sound file could not be read.' }
            }
            // The clip, the manifest and the lock as they are, to be put back if the board cannot be.
            const files = [
              join(found.effects.clips, `${id}.mp3`),
              found.effects.manifest,
              EFFECTS_LOCK_FILE,
            ]
            const was = await Promise.all(
              files.map((file) =>
                Bun.file(resolveInRoot(found.root, file))
                  .bytes()
                  .catch(() => null),
              ),
            )
            putBack = async () => {
              for (const [i, file] of files.entries()) {
                const bytes = was[i]
                if (bytes) await writeAtomic(found.root, file, bytes)
                else await rm(resolveInRoot(found.root, file), { force: true })
              }
            }
            const committed = await commitEffect({
              root: found.root,
              projectFile,
              effects: found.effects,
              id,
              take: played.take,
              // The lock keeps what Accept made it count the take as made from, and when it was chosen.
              inUse: chosen.lock.inputs,
              now: () => new Date(chosen.lock.at),
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
        },
        () =>
          (putBack?.() ?? Promise.resolve()).catch((error) => {
            stuck = true
            console.error('putting the game’s files back failed', error)
          }),
      ).catch((error): EffectTrimResult => {
        if (!(error instanceof BoardNotWritten)) throw error
        // Kept in the server log: the person is told which file, not the stack.
        console.error('saving the trim failed', error)
        return {
          ok: false,
          message: stuck
            ? `${error.message}, and the game’s files could not be put back`
            : error.message,
        }
      })
    },

    async trimmedSound(projectFile, id, name) {
      const path = await api.takeFile(projectFile, id, name)
      const found = await resolve(projectFile, id)
      if (!path || !found || !('inputs' in found)) return null
      const board = await readEffectBoard(found.root, id)
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
      return boards.run(keyOf(projectFile, id), () =>
        uncommitEffect({ root: found.root, projectFile, effects: found.effects, id }),
      )
    },

    async accept(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      return boards.run(keyOf(projectFile, id), () =>
        acceptEffect({
          root: found.root,
          projectFile,
          id,
          now: found.inputs,
        }),
      )
    },

    async making(projectFile) {
      const summary: Record<string, EffectMakingSummary> = {}
      const prefix = `${projectFile}\0`
      for (const [key, entries] of active) {
        if (!key.startsWith(prefix)) continue
        let takes = 0
        let left = 0
        for (const entry of entries.values()) {
          if (entry.state === 'failed') continue
          takes++
          const { seconds } = effectModel(entry.model)
          left +=
            entry.state === 'waiting'
              ? seconds
              : Math.max(0, seconds - (now() - entry.startedAt) / 1000)
        }
        if (takes) summary[key.slice(prefix.length)] = { takes, left }
      }
      return summary
    },

    async makeAll(projectFile, ids) {
      const opened = await openProject(projectFile)
      if (!opened.ok) return opened
      const { project } = opened
      const root = dirname(projectFile)
      if (!project.effects) return { ok: false, message: 'The project has no sound effects.' }
      const listed = new Set(
        ((await readEffects(root, project, []))?.rows ?? []).map((row) => row.id),
      )
      const chosen = await readEffectChosen(root, project.effects, [])
      if (!chosen) return { ok: false, message: 'The sound effects lock could not be read.' }
      const busy = (id: string) =>
        entriesOf(projectFile, id).some((entry) => entry.state !== 'failed')
      const wanted = [...new Set(ids)].filter((id) => listed.has(id) && !chosen[id] && !busy(id))
      if (!wanted.length) return { ok: true, started: [] }
      // The model every effect uses is a hand start's; when it cannot run, none is started.
      const model = defaultEffectModel(
        project.effects.model ?? DEFAULT_EFFECT_MODEL,
        await modelStates(projectFile),
        hasUv(),
      )
      const ready = await generator.ready(model)
      if (!ready.ok) return { ok: false, message: ready.message }
      const started: { id: string; takes: number }[] = []
      // Registered before the first take is queued, so a stop that arrives while the rest are
      // being started is counted in this press.
      const before = batches.get(projectFile)
      const batch: Batch = { total: 0, stopped: 0, ns: new Map() }
      batches.set(projectFile, batch)
      let failure: EffectMakeAllResult | null = null
      for (const id of wanted) {
        const had = new Set(entriesOf(projectFile, id).map((entry) => entry.n))
        pressing = true
        const result = await api.make(projectFile, id, { count: MAKE_ALL_TAKES }).finally(() => {
          pressing = false
        })
        if (!result || !result.ok) {
          // This effect cannot be started (its board cannot be read); the others still are.
          failure = result ?? { ok: false, message: `${id} is not listed.` }
          continue
        }
        const made = entriesOf(projectFile, id).filter((entry) => !had.has(entry.n))
        batch.ns.set(id, new Set(made.map((entry) => entry.n)))
        batch.total += made.length
        started.push({ id, takes: made.length })
      }
      if (!started.length) {
        if (before) batches.set(projectFile, before)
        else batches.delete(projectFile)
        return failure ?? { ok: true, started }
      }
      return { ok: true, started }
    },

    async stopAll(projectFile) {
      const opened = await openProject(projectFile)
      if (!opened.ok) return opened
      let stopped = 0
      const prefix = `${projectFile}\0`
      for (const [key, entries] of active) {
        if (!key.startsWith(prefix)) continue
        for (const [n, entry] of entries) {
          if (entry.state === 'failed') continue
          entry.stop?.abort()
          entries.delete(n)
          countStopped(projectFile, key.slice(prefix.length), n)
          stopped++
        }
      }
      return { ok: true, stopped }
    },

    async batch(projectFile) {
      const batch = batches.get(projectFile)
      if (!batch) return null
      const failed: EffectBatch['failed'] = []
      let running = 0
      for (const [id, ns] of batch.ns) {
        for (const entry of entriesOf(projectFile, id)) {
          if (!ns.has(entry.n)) continue
          if (entry.state === 'failed') failed.push({ id, n: entry.n })
          else running++
        }
      }
      return {
        total: batch.total,
        made: batch.total - batch.stopped - failed.length - running,
        stopped: batch.stopped,
        failed,
        running: running > 0,
      }
    },

    async closeBatch(projectFile) {
      const press = batches.get(projectFile)
      if (press && !pressRunning(projectFile, press)) batches.delete(projectFile)
      return { ok: true }
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

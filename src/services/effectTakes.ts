import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { effectModel, type EffectModelId } from '../core/effectModels'
import {
  EFFECT_TAKE_SECONDS,
  type EffectBoard,
  type EffectBoardTake,
  type EffectFailedView,
  type EffectInputs,
  type EffectMakingSummary,
  type EffectMakingView,
  type EffectTakesView,
  type EffectTakeView,
} from '../core/effectTakes'
import { resolveInRoot } from '../core/paths'
import { peaks, wavSeconds } from '../core/musicTake'
import { readWav } from '../core/wav'
import { ffmpegEncoder, type Encoder } from './audio'
import { EFFECT_BOARD_DIR, EFFECT_TAKES_DIR, boardFile, readEffectBoard } from './effectBoards'
import { acceptEffect, commitEffect, readEffectChosen, uncommitEffect } from './effectClips'
import { readEffects } from './effectsLists'
import type { EffectGenerator } from './effects'
import type { EffectHealthStore } from './effectHealth'
import { writeAtomic } from './files'
import type { CommitResult } from './musicClips'
import { createSerial, type Serial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

export { EFFECT_BOARD_DIR, EFFECT_TAKES_DIR }

/** The model every take is made with until there is a second one (as-5wc.5). */
const MODEL: EffectModelId = 'small-sfx'

/** How many bars a take's waveform has. */
const WAVEFORM_BARS = 120

/** An effect id is a slug (the game's list is validated); this guards the board's path on its own. */
const SAFE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** A take's file name: the hash of its inputs, its number, `.wav`. */
const TAKE_FILE = /^([0-9a-f]{16})\.(\d+)\.wav$/

/** The queue key effects are made on: one at a time, on the CPU. */
const CPU = 'effects'

/** What to make: this many new takes, or the failed take with this number again. */
export type MakeEffectRequest = { count: number } | { retry: number }

/** What asking for takes, dropping or stopping answered; null for an effect the project does not list. */
export type EffectMakeResult = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** What stopping answered: how many takes were stopped, made or waiting; null for an unknown effect. */
export type EffectStopResult = { ok: true; stopped: number } | ProjectFailure | null

/** What choosing, un-choosing or accepting answered; null for an effect the project does not list. */
export type EffectChooseResult = CommitResult | null

/** An effect's takes as the page shows them, a project failure, or null for an unknown effect. */
export type EffectTakesResult = EffectTakesView | ProjectFailure | null

/** A hash of what went into a take: the model, the description in use and the length. */
export function effectTakeHash(inputs: EffectInputs): string {
  return createHash('sha256')
    .update(JSON.stringify([MODEL, inputs.description, inputs.seconds]))
    .digest('hex')
    .slice(0, 16)
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
}

/** What the takes of an effect are made of. */
export interface EffectTakes {
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
  /** Takes a take off the board and deletes its file; the chosen take stays. */
  drop(projectFile: string, id: string, name: string): Promise<EffectMakeResult>
  /** What is being made in the project, by effect, for the list's status. */
  making(projectFile: string): Promise<Record<string, EffectMakingSummary>>
  /** The path of a take's WAV, or null for an effect not listed or a name that is not a take's. */
  takeFile(projectFile: string, id: string, name: string): Promise<string | null>
}

/** A take's file name on the board. */
const fileOf = (take: Pick<EffectBoardTake, 'hash' | 'n'>) => `${take.hash}.${take.n}.wav`

/** A failure as a sentence for the page. */
function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/**
 * The takes of the game's sound effects: made by `generator` one at a time (the CPU), each ending
 * where its sound ends, and kept on a board per effect in `.content-studio/effect-boards/<effect>.json`
 * (with its seed, real length and waveform), its WAV in
 * `.content-studio/effect-takes/<effect>/<hash>.<n>.wav`. Takes waiting, being made and failed are
 * kept in memory, per effect, for the page to poll (they survive a `--dev` reload, not a restart).
 * The generator's failures and successes go to `health`, which Setup's Sound-effect models row reads.
 */
export function createEffectTakes({
  generator,
  health,
  queue,
  now = Date.now,
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
  encode = ffmpegEncoder,
}: {
  generator: EffectGenerator
  health?: Pick<EffectHealthStore, 'record' | 'clear'>
  /** Where takes wait their turn; one shared queue by default. */
  queue?: Serial
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
  }
  const active = (shared.contentStudioEffectEntries ??= new Map())
  const cpu = queue ?? (shared.contentStudioEffectQueue ??= createSerial())
  // Changes to one effect's board, one after another: a take finishing and a drop lose neither.
  const boards = (shared.contentStudioEffectBoards ??= createSerial())
  const keyOf = (projectFile: string, id: string) => `${projectFile}\0${id}`

  async function resolve(projectFile: string, id: string) {
    if (!SAFE_ID.test(id)) return null
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { project } = opened
    const root = dirname(projectFile)
    if (!project.effects) return null
    const row = (await readEffects(root, project, []))?.rows.find((r) => r.id === id)
    if (!row) return null
    const inputs: EffectInputs = { description: row.description, seconds: row.seconds }
    return {
      root,
      id,
      effects: project.effects,
      inputs,
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
  ): Promise<T | ProjectFailure> {
    return boards.run(keyOf(projectFile, found.id), async () => {
      const board = await readEffectBoard(found.root, found.id)
      if ('ok' in board) return board
      const before = JSON.stringify(board, null, 2)
      const answer = await change(board)
      const after = JSON.stringify(board, null, 2)
      if (after !== before) await writeAtomic(found.root, boardFile(found.id), `${after}\n`)
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
      const take = await generator.generate(
        { prompt: inputs.description, seconds: inputs.seconds, seed: newSeed() },
        stop.signal,
      )
      // Stopped while it was made: it is discarded, and no longer in the map.
      if (stop.signal.aborted) return
      const wav = readWav(take.wav)
      const made: EffectBoardTake = {
        n: entry.n,
        hash: entry.hash,
        seed: take.seed,
        model: MODEL,
        seconds: wavSeconds(wav),
        peaks: peaks(wav, WAVEFORM_BARS),
        inputs,
      }
      // The file first: a take is on the board only once its WAV is there.
      await writeAtomic(found.root, `${found.folder}/${fileOf(made)}`, take.wav)
      const saved = await changeBoard(projectFile, found, (board) => {
        if (stop.signal.aborted) return
        board.takes = [...board.takes.filter((t) => t.n !== made.n), made].sort((a, b) => a.n - b.n)
      })
      if (stop.signal.aborted) {
        await rm(resolveInRoot(found.root, `${found.folder}/${fileOf(made)}`), { force: true })
        return
      }
      if (saved && 'ok' in saved) throw new Error(`${saved.file} cannot be used`)
      waiting.delete(entry.n)
      await health?.clear(projectFile, MODEL).catch(() => {})
    } catch (error) {
      if (stop.signal.aborted) return
      entry.state = 'failed'
      entry.message = describeFailure(error)
      const last = entry.message.split('\n').filter(Boolean).pop() ?? entry.message
      await health?.record(projectFile, MODEL, { error: last }).catch(() => {})
    }
  }

  /** An effect's entries: waiting, being made, or failed. */
  const entriesOf = (projectFile: string, id: string) =>
    [...(active.get(keyOf(projectFile, id))?.values() ?? [])].sort((a, b) => a.n - b.n)

  return {
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
      const name = effectModel(MODEL).name
      const takes: EffectTakeView[] = []
      for (const take of board.takes) {
        if (!(await Bun.file(join(root, folder, fileOf(take))).exists())) continue
        takes.push({
          n: take.n,
          file: fileOf(take),
          seconds: take.seconds,
          peaks: take.peaks,
          chosen: chosen?.take === take.n && chosen.fp === take.hash,
          model: name,
        })
      }
      const making: EffectMakingView[] = entries
        .filter((entry) => entry.state !== 'failed' && !takes.some((take) => take.n === entry.n))
        .map((entry) => ({
          n: entry.n,
          state: entry.state as 'waiting' | 'making',
          elapsed: entry.state === 'making' ? Math.max(0, (now() - entry.startedAt) / 1000) : 0,
          expected: EFFECT_TAKE_SECONDS,
          model: name,
        }))
      const failed: EffectFailedView[] = entries
        .filter((entry) => entry.state === 'failed' && entry.hash === hash)
        .map((entry) => ({ n: entry.n, message: entry.message }))
      return {
        ok: true,
        generator: generator.ready(),
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
      const ready = generator.ready()
      if (!ready.ok) return { ok: false, message: ready.message }
      const key = keyOf(projectFile, id)
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
          }
          entries.set(entry.n, entry)
          queued.push(entry)
        }
      }
      for (const entry of queued) void cpu.run(CPU, () => run(projectFile, found, entry, entries))
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
        let wav: Uint8Array
        try {
          wav = new Uint8Array(await Bun.file(join(found.root, found.folder, name)).arrayBuffer())
        } catch {
          return { ok: false, message: 'That take’s sound is gone, so it cannot be chosen.' }
        }
        return commitEffect({
          root: found.root,
          projectFile,
          effects: found.effects,
          id,
          take,
          wav,
          encode,
        })
      })
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
          effects: found.effects,
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
          left +=
            entry.state === 'waiting'
              ? EFFECT_TAKE_SECONDS
              : Math.max(0, EFFECT_TAKE_SECONDS - (now() - entry.startedAt) / 1000)
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

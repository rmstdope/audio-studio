import { rm } from 'node:fs/promises'
import { resolveInRoot } from '../core/paths'
import { WriteRefused, writeOrRefuse } from './files'
import type { Serial } from './serial'
import type { ProjectFailure } from './workspace'

/** A take being made or waiting, or one that failed, until it is made. */
export interface TakeEntry {
  n: number
  state: 'waiting' | 'making' | 'failed'
  startedAt: number
  message: string
  /** The hash of the inputs it is made for; Try again files it under the inputs as they are then. */
  hash: string
  /** Ends the take while it is being made (Stop). */
  stop?: AbortController
}

/** What every medium's board has in common: the next take number (each names its list of takes itself). */
export interface TakeBoard {
  next: number
}

/** How a medium reads and writes one board: the file is the medium's, the turns are the engine's. */
export interface BoardAccess<B> {
  /** The board; an empty one before its first take; the problems if its file is broken. */
  read(): Promise<B | ProjectFailure>
  /** Saves the board's text; refuses with the medium's own refusal when it cannot. */
  write(text: string): Promise<void>
}

/** What a take's job is told, and what happens around it. */
export interface TakeJob {
  /**
   * Makes the take; ends when it is on the board. The signal is aborted by Stop. `began` marks the
   * take as being made: the engine calls it before the job unless the job is `queued`.
   */
  job(stop: AbortSignal, began: () => void): Promise<void>
  /** The job waits for something (the GPU) before it starts, and calls `began` when that is over. */
  queued?: boolean
  /**
   * Called with the error when the model's job failed and was not stopped, after the entry shows
   * failed. Never called for a take that was made but could not be saved: any `WriteRefused` or `BoardUnusable` the job throws (`save`'s refusals) is no news of the model.
   */
  failed?(error: unknown): void | Promise<void>
  /** Called last, whatever happened. */
  settled?(): void | Promise<void>
}

/** A take's board that could not be read after its file was written: no news of the model. */
export class BoardUnusable extends Error {
  constructor(file: string) {
    super(`${file} cannot be used`)
  }
}

/** A failure as a sentence for the page. */
export function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/**
 * The part of making takes that every medium shares: the entries waiting, being made and failed
 * (in memory, per project and id, so a `--dev` reload keeps them), the numbers reserved on the
 * board, the one-at-a-time changes to a board, and Stop. The medium decides what a take is made
 * of, where its board is, and how its presses are counted.
 */
export function createTakeEngine<E extends TakeEntry, B extends TakeBoard>({
  slot,
  boards,
  now,
  describe = describeFailure,
}: {
  /** The name of the `globalThis` slot that keeps this medium's entries. */
  slot: string
  /** Changes to one board, one after another: a take finishing and a drop lose neither. */
  boards: Serial
  now: () => number
  /** A failure as a sentence for the page, when the medium rewords some. */
  describe?: (error: unknown) => string
}) {
  const shared = globalThis as unknown as Record<string, Map<string, Map<number, E>> | undefined>
  const active = (shared[slot] ??= new Map<string, Map<number, E>>())
  const keyOf = (projectFile: string, id: string) => `${projectFile}\0${id}`

  /** An id's entries: waiting, being made, or failed. */
  function entriesOf(projectFile: string, id: string): E[] {
    return [...(active.get(keyOf(projectFile, id))?.values() ?? [])].sort((a, b) => a.n - b.n)
  }

  /** Stops the take, if it is waiting or being made: it ends, is forgotten, and is told to `onStopped`. */
  function stopEntry(entries: Map<number, E>, entry: E, onStopped?: (entry: E) => void): boolean {
    if (entry.state === 'failed') return false
    entry.stop?.abort()
    entries.delete(entry.n)
    onStopped?.(entry)
    return true
  }

  return {
    entriesOf,

    /** Runs `job` in the id's turn on the board, so nothing else changes the board meanwhile. */
    inTurn<T>(projectFile: string, id: string, job: () => Promise<T>): Promise<T> {
      return boards.run(keyOf(projectFile, id), job)
    },

    /** Changes a board and saves it; what `change` returns is the answer. */
    changeBoard<T>(
      projectFile: string,
      id: string,
      access: BoardAccess<B>,
      change: (board: B) => T | Promise<T>,
      /** Called when the board cannot be written, to take back what `change` did elsewhere. */
      undo?: () => Promise<void>,
    ): Promise<T | ProjectFailure> {
      return this.inTurn(projectFile, id, async () => {
        const board = await access.read()
        if ('ok' in board) return board
        const before = JSON.stringify(board, null, 2)
        const answer = await change(board)
        const after = JSON.stringify(board, null, 2)
        // Nothing changed (a drop of a take that is not there): nothing is written.
        if (after !== before) {
          try {
            await access.write(`${after}\n`)
          } catch (error) {
            await undo?.()
            throw error
          }
        }
        return answer
      })
    },

    /**
     * Reserves `count` numbers on the board at once, so none is used twice, even by a take that
     * fails or is stopped, and registers a waiting entry for each, made by `make` and returned in
     * number order. Rejects with the board's own refusal when it cannot be saved.
     */
    async reserve(
      projectFile: string,
      id: string,
      access: BoardAccess<B>,
      count: number,
      make: (n: number) => E,
    ): Promise<E[] | ProjectFailure> {
      const key = keyOf(projectFile, id)
      // Registered before the board is awaited, so two presses at once share one map.
      const entries = active.get(key) ?? new Map<number, E>()
      active.set(key, entries)
      const first = await this.changeBoard(projectFile, id, access, (board) => {
        const first = Math.max(board.next, ...[...entries.values()].map((entry) => entry.n + 1))
        board.next = first + count
        return first
      })
      if (typeof first !== 'number') return first
      const made: E[] = []
      for (let i = 0; i < count; i++) {
        const entry = make(first + i)
        entries.set(entry.n, entry)
        made.push(entry)
      }
      return made
    },

    /** The take `n` of an id, if it is waiting, being made or failed. */
    entry(projectFile: string, id: string, n: number): E | undefined {
      return active.get(keyOf(projectFile, id))?.get(n)
    },

    /** A failed take made to wait again, filed under `hash`; null when there is no failed take `n`. */
    retry(projectFile: string, id: string, n: number, hash: string): E | null {
      const entry = active.get(keyOf(projectFile, id))?.get(n)
      if (!entry || entry.state !== 'failed') return null
      entry.state = 'waiting'
      entry.hash = hash
      return entry
    },

    /**
     * Makes a waiting take: it is being made while `job` runs, forgotten once `job` is done, and
     * shown failed when `job` throws. A take stopped meanwhile (or while it waited) is never
     * shown failed and never made.
     */
    async run(
      projectFile: string,
      id: string,
      entry: E,
      { job, queued, failed, settled }: TakeJob,
    ) {
      const entries = active.get(keyOf(projectFile, id))
      // Stopped while it waited: it is no longer in the map.
      if (entries?.get(entry.n) !== entry || entry.state !== 'waiting') return
      const began = () => {
        entry.state = 'making'
        entry.startedAt = now()
      }
      if (!queued) began()
      const stop = new AbortController()
      entry.stop = stop
      try {
        await job(stop.signal, began)
        if (stop.signal.aborted) return
        entries.delete(entry.n)
      } catch (error) {
        if (stop.signal.aborted) return
        entry.state = 'failed'
        entry.message = describe(error)
        // The model made it; only saving it failed, which is no news of the model.
        if (error instanceof WriteRefused) console.error('saving the take failed', error)
        else if (!(error instanceof BoardUnusable)) await failed?.(error)
      } finally {
        await settled?.()
      }
    },

    /**
     * Saves a made take: its file first (a take is on the board only once its file is there), then
     * the board in its turn, where `change` puts it (not run once `stop` is aborted). The file is
     * removed again, and `cleanup` called, when the take was stopped or could not be saved.
     * Answers false when stopped; throws the `WriteRefused` of a file or board that cannot be
     * written, or `BoardUnusable` when the board cannot be read: neither is the model's failure.
     */
    async save(
      projectFile: string,
      id: string,
      access: BoardAccess<B>,
      take: {
        root: string
        /** The file's path in the project. */
        path: string
        bytes: Uint8Array
        stop: AbortSignal
        change: (board: B) => void | Promise<void>
        cleanup?: () => void
      },
    ): Promise<boolean> {
      const removeFile = async () => {
        take.cleanup?.()
        await rm(resolveInRoot(take.root, take.path), { force: true }).catch(() => {})
      }
      try {
        await writeOrRefuse(take.root, take.path, take.bytes)
      } catch (error) {
        await removeFile()
        throw error
      }
      let saved: void | ProjectFailure
      try {
        saved = await this.changeBoard(projectFile, id, access, async (board) => {
          // Stopped while its file was written or it waited for the board: not put on it.
          if (take.stop.aborted) return
          await take.change(board)
        })
      } catch (error) {
        await removeFile()
        throw error
      }
      if (take.stop.aborted) {
        await removeFile()
        return false
      }
      if (saved && 'ok' in saved) {
        await removeFile()
        throw new BoardUnusable(saved.file)
      }
      return true
    },

    /** Ends one take in any state (a failed one is only forgotten) and forgets it; false when there is none. */
    discard(projectFile: string, id: string, n: number): boolean {
      const entries = active.get(keyOf(projectFile, id))
      const entry = entries?.get(n)
      if (!entries || !entry) return false
      entry.stop?.abort()
      entries.delete(n)
      return true
    },

    /** Stops an id's takes that are waiting or being made; how many. Failed ones stay. */
    stop(projectFile: string, id: string, onStopped?: (entry: E) => void): number {
      const entries = active.get(keyOf(projectFile, id))
      let stopped = 0
      for (const entry of [...(entries?.values() ?? [])]) {
        if (stopEntry(entries!, entry, onStopped)) stopped++
      }
      return stopped
    },

    /** Stops the named takes of an id that are waiting or being made; how many. Failed ones stay. */
    stopTakes(
      projectFile: string,
      id: string,
      ns: number[],
      onStopped?: (entry: E) => void,
    ): number {
      const entries = active.get(keyOf(projectFile, id))
      let stopped = 0
      for (const n of ns) {
        const entry = entries?.get(n)
        if (entry && stopEntry(entries!, entry, onStopped)) stopped++
      }
      return stopped
    },

    /** Forgets the named takes of an id whatever their state, stopping the ones being made; how many. */
    discardTakes(projectFile: string, id: string, ns: number[]): number {
      const entries = active.get(keyOf(projectFile, id))
      let discarded = 0
      for (const n of ns) {
        const entry = entries?.get(n)
        if (!entry) continue
        entry.stop?.abort()
        entries!.delete(n)
        discarded++
      }
      return discarded
    },

    /** Stops every take of the project, whichever id; how many. */
    stopIn(projectFile: string, onStopped?: (id: string, entry: E) => void): number {
      const prefix = `${projectFile}\0`
      let stopped = 0
      for (const [key, entries] of active) {
        if (!key.startsWith(prefix)) continue
        for (const entry of [...entries.values()]) {
          if (stopEntry(entries, entry, (e) => onStopped?.(key.slice(prefix.length), e))) stopped++
        }
      }
      return stopped
    },

    /** What is being made in the project, by id; `summarize` answers null for an id with nothing to say. */
    making<S>(projectFile: string, summarize: (entries: E[]) => S | null): Record<string, S> {
      const summary: Record<string, S> = {}
      const prefix = `${projectFile}\0`
      for (const [key, entries] of active) {
        if (!key.startsWith(prefix)) continue
        const said = summarize([...entries.values()])
        if (said !== null) summary[key.slice(prefix.length)] = said
      }
      return summary
    },

    /**
     * What a view shows of the entries it read before the board: the ones still waiting or being
     * made and not yet on the board, and the failed ones. The entries are read first, so a take
     * dropped from them after the board has it is in the board read after, never in neither.
     */
    split(entries: E[], onBoard: { n: number }[]): { pending: E[]; failed: E[] } {
      return {
        pending: entries.filter(
          (entry) => entry.state !== 'failed' && !onBoard.some((take) => take.n === entry.n),
        ),
        failed: entries.filter((entry) => entry.state === 'failed'),
      }
    },
  }
}

import { randomUUID } from 'node:crypto'
import type { MeasureResult, RecordResult } from './narration'

/** What a job does to each line: record it, or measure its clip. */
export type JobKind = 'record' | 'measure'

/** What doing one line gave. */
export type StepResult = RecordResult | MeasureResult

/** A generation job as the page shows it. */
export interface JobState {
  id: string
  kind: JobKind
  part: string
  /** The one speaker generated, or null for the whole part. */
  speaker: string | null
  status: 'running' | 'cancelling' | 'done' | 'cancelled'
  total: number
  /** Lines finished: recorded, skipped or failed. */
  done: number
  /**
   * Lines skipped: no longer needing recording (recorded meanwhile, adopted), or, when measuring,
   * recorded again meanwhile.
   */
  skipped: number
  failed: { key: string; message: string }[]
  /** Lines being recorded right now. */
  recording: string[]
  /** Orphaned clips removed at the end. */
  removed: number
  /** True while the orphans are being removed: the one phase that cannot be cancelled. */
  removingOrphans: boolean
  /** Why removing the orphans failed, if it did. */
  orphanError: string | null
  startedAt: string
  finishedAt: string | null
}

/** What a job does: which lines to record and how, and which orphans to remove at the end. */
export interface JobOptions {
  kind?: JobKind
  part: string
  speaker: string | null
  keys: string[]
  /** Orphans to remove once every line is done; empty unless the user agreed. */
  orphans: string[]
  parallel: number
  /** Does one line: records it, or measures its clip. */
  record: (key: string) => Promise<StepResult>
  removeOrphans: (keys: string[]) => Promise<number>
}

/** The generation jobs of a server: started, followed and cancelled by id. */
export interface Jobs {
  start(options: JobOptions): JobState | { error: string }
  get(id: string): JobState | null
  /** The most recent job of a part, running or not. */
  latest(part: string): JobState | null
  cancel(id: string): JobState | null
}

/** A job and the lines it has not started yet. */
interface Running {
  state: JobState
  queue: string[]
}

/**
 * Generation jobs: each records its lines `parallel` at a time, goes on past a failed line, and
 * removes the agreed orphans once every line is done. Cancelling stops lines not started yet;
 * lines under way finish, and no orphans are removed. Only the orphan removal itself cannot be
 * cancelled. One job per part runs at a time, and only each part's latest is kept.
 */
export function createJobs(): Jobs {
  const byPart = new Map<string, Running>()
  const find = (id: string) => [...byPart.values()].find((job) => job.state.id === id)

  const snapshot = ({ state }: Running): JobState => ({
    ...state,
    failed: [...state.failed],
    recording: [...state.recording],
  })

  return {
    start(options) {
      const current = byPart.get(options.part)
      if (
        current &&
        (current.state.status === 'running' || current.state.status === 'cancelling')
      ) {
        return { error: `A generation is already running for ${options.part}.` }
      }
      const job: Running = {
        queue: [...options.keys],
        state: {
          id: randomUUID(),
          kind: options.kind ?? 'record',
          part: options.part,
          speaker: options.speaker,
          status: 'running',
          total: options.keys.length,
          done: 0,
          skipped: 0,
          failed: [],
          recording: [],
          removed: 0,
          removingOrphans: false,
          orphanError: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        },
      }
      byPart.set(options.part, job)
      void run(job, options)
      return snapshot(job)
    },
    get(id) {
      const job = find(id)
      return job ? snapshot(job) : null
    },
    latest(part) {
      const job = byPart.get(part)
      return job ? snapshot(job) : null
    },
    cancel(id) {
      const job = find(id)
      if (!job) return null
      // Until the orphans are being removed: lines waiting or under way can still be cancelled.
      if (job.state.status === 'running' && !job.state.removingOrphans) {
        job.state.status = 'cancelling'
      }
      return snapshot(job)
    },
  }
}

async function run(job: Running, options: JobOptions): Promise<void> {
  const { state } = job
  const worker = async () => {
    while (state.status === 'running') {
      const key = job.queue.shift()
      if (key === undefined) return
      state.recording.push(key)
      try {
        const result = await options.record(key)
        const why = failure(result)
        if (why) state.failed.push({ key, message: why })
        else if (result?.ok && 'skipped' in result) state.skipped++
      } catch (error) {
        state.failed.push({ key, message: messageOf(error) })
      } finally {
        state.recording = state.recording.filter((k) => k !== key)
        state.done++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, options.parallel) }, worker))
  if (state.status === 'running' && options.orphans.length) {
    state.removingOrphans = true
    try {
      state.removed = await options.removeOrphans(options.orphans)
    } catch (error) {
      state.orphanError = messageOf(error)
    } finally {
      state.removingOrphans = false
    }
  }
  state.status = state.status === 'running' ? 'done' : 'cancelled'
  state.finishedAt = new Date().toISOString()
}

/** Why a line's recording failed, or null when it did not. */
function failure(result: StepResult): string | null {
  if (!result) return 'the line is no longer in the dialog'
  if (result.ok) return null
  if ('message' in result && typeof result.message === 'string') return result.message
  if ('problems' in result) return result.problems.map((p) => `${p.file}: ${p.message}`).join('; ')
  return 'could not be recorded'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

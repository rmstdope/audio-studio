import { randomUUID } from 'node:crypto'
import type { RecordResult } from './narration'

/** A generation job as the page shows it. */
export interface JobState {
  id: string
  part: string
  /** The one speaker generated, or null for the whole part. */
  speaker: string | null
  status: 'running' | 'cancelling' | 'done' | 'cancelled'
  total: number
  /** Lines finished, recorded or failed. */
  done: number
  failed: { key: string; message: string }[]
  /** Lines being recorded right now. */
  recording: string[]
  /** Orphaned clips removed at the end. */
  removed: number
  startedAt: string
  finishedAt: string | null
}

/** What a job does: which lines to record and how, and which orphans to remove at the end. */
export interface JobOptions {
  part: string
  speaker: string | null
  keys: string[]
  /** Orphans to remove once every line is done; empty unless the user agreed. */
  orphans: string[]
  parallel: number
  record: (key: string) => Promise<RecordResult>
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

/**
 * Generation jobs: each records its lines `parallel` at a time, goes on past a failed line, and
 * removes the agreed orphans once every line is done. Cancelling stops new lines from starting;
 * lines under way finish, and no orphans are removed. One job per part runs at a time.
 */
export function createJobs(): Jobs {
  const jobs = new Map<string, JobState>()
  const latest = new Map<string, string>()

  const snapshot = (job: JobState): JobState => ({
    ...job,
    failed: [...job.failed],
    recording: [...job.recording],
  })

  return {
    start(options) {
      const previous = latest.get(options.part)
      const current = previous ? jobs.get(previous) : undefined
      if (current && (current.status === 'running' || current.status === 'cancelling')) {
        return { error: `A generation is already running for ${options.part}.` }
      }
      const job: JobState = {
        id: randomUUID(),
        part: options.part,
        speaker: options.speaker,
        status: 'running',
        total: options.keys.length,
        done: 0,
        failed: [],
        recording: [],
        removed: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      }
      jobs.set(job.id, job)
      latest.set(options.part, job.id)
      void run(job, options)
      return snapshot(job)
    },
    get(id) {
      const job = jobs.get(id)
      return job ? snapshot(job) : null
    },
    latest(part) {
      const id = latest.get(part)
      const job = id ? jobs.get(id) : undefined
      return job ? snapshot(job) : null
    },
    cancel(id) {
      const job = jobs.get(id)
      if (!job) return null
      if (job.status === 'running') job.status = 'cancelling'
      return snapshot(job)
    },
  }
}

async function run(job: JobState, options: JobOptions): Promise<void> {
  const queue = [...options.keys]
  const worker = async () => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      if (job.status !== 'running') return
      job.recording.push(key)
      try {
        const result = await options.record(key)
        if (!result || !result.ok) job.failed.push({ key, message: failure(result) })
      } catch (error) {
        job.failed.push({ key, message: error instanceof Error ? error.message : String(error) })
      } finally {
        job.recording = job.recording.filter((k) => k !== key)
        job.done++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, options.parallel) }, worker))
  if (job.status === 'running' && options.orphans.length) {
    try {
      job.removed = await options.removeOrphans(options.orphans)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      job.failed.push({
        key: 'orphans',
        message: `could not remove the orphaned clips: ${message}`,
      })
    }
  }
  job.status = job.status === 'running' ? 'done' : 'cancelled'
  job.finishedAt = new Date().toISOString()
}

function failure(result: RecordResult): string {
  if (!result) return 'the line is no longer in the dialog'
  if (result.ok) return ''
  if ('message' in result && typeof result.message === 'string') return result.message
  if ('problems' in result) return result.problems.map((p) => `${p.file}: ${p.message}`).join('; ')
  return 'could not be recorded'
}

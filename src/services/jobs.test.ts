import { describe, expect, it } from 'bun:test'
import { createJobs, type JobState } from './jobs'

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits until the job is no longer running. */
async function finished(get: () => JobState | null): Promise<JobState> {
  for (;;) {
    const job = get()
    if (job && job.status !== 'running' && job.status !== 'cancelling') return job
    await tick()
  }
}

describe('jobs', () => {
  it('records every line, `parallel` at a time, then removes the orphans', async () => {
    const jobs = createJobs()
    let running = 0
    let most = 0
    const recorded: string[] = []
    const removed: string[][] = []
    const job = jobs.start({
      part: 'act1',
      speaker: null,
      keys: ['a', 'b', 'c', 'd', 'e'],
      orphans: ['old'],
      parallel: 2,
      record: async (key) => {
        running++
        most = Math.max(most, running)
        await tick()
        running--
        recorded.push(key)
        return { ok: true, key, duration: 1 }
      },
      removeOrphans: async (keys) => {
        removed.push(keys)
        return keys.length
      },
    })
    if ('error' in job) throw new Error(job.error)
    expect(job).toMatchObject({ status: 'running', total: 5, done: 0 })
    const done = await finished(() => jobs.get(job.id))
    expect(done).toMatchObject({ status: 'done', done: 5, failed: [], recording: [], removed: 1 })
    expect(done.finishedAt).not.toBeNull()
    expect(recorded.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(most).toBe(2)
    expect(removed).toEqual([['old']])
  })

  it('goes on past a failed line, and lists it', async () => {
    const jobs = createJobs()
    const job = jobs.start({
      part: 'act1',
      speaker: null,
      keys: ['a', 'b'],
      orphans: [],
      parallel: 1,
      record: async (key) =>
        key === 'a'
          ? { ok: false, reason: 'fish', message: 'busy' }
          : { ok: true, key, duration: 1 },
      removeOrphans: async () => 0,
    })
    if ('error' in job) throw new Error(job.error)
    const done = await finished(() => jobs.get(job.id))
    expect(done).toMatchObject({ status: 'done', done: 2, failed: [{ key: 'a', message: 'busy' }] })
  })

  it('stops starting lines when cancelled, finishes those under way, and removes no orphans', async () => {
    const jobs = createJobs()
    let removeCalled = false
    const job = jobs.start({
      part: 'act1',
      speaker: null,
      keys: ['a', 'b', 'c', 'd'],
      orphans: ['old'],
      parallel: 1,
      record: async (key) => {
        await tick(20)
        return { ok: true, key, duration: 1 }
      },
      removeOrphans: async () => {
        removeCalled = true
        return 1
      },
    })
    if ('error' in job) throw new Error(job.error)
    await tick(5)
    expect(jobs.cancel(job.id)?.status).toBe('cancelling')
    const done = await finished(() => jobs.get(job.id))
    expect(done.status).toBe('cancelled')
    expect(done.done).toBe(1)
    expect(removeCalled).toBe(false)
  })

  it('runs one job per part at a time, and finds it', async () => {
    const jobs = createJobs()
    const slow = {
      part: 'act1',
      speaker: null,
      keys: ['a'],
      orphans: [],
      parallel: 1,
      record: async (key: string) => {
        await tick(20)
        return { ok: true as const, key, duration: 1 }
      },
      removeOrphans: async () => 0,
    }
    const first = jobs.start(slow)
    if ('error' in first) throw new Error(first.error)
    expect(jobs.start(slow)).toEqual({ error: 'A generation is already running for act1.' })
    expect(jobs.latest('act1')?.id).toBe(first.id)
    await finished(() => jobs.get(first.id))
    expect('id' in jobs.start(slow)).toBe(true)
  })
})

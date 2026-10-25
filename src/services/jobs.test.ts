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

describe('jobs in several languages', () => {
  const slow = (language?: string) => ({
    part: 'act1',
    ...(language ? { language } : {}),
    speaker: null,
    keys: ['a'],
    orphans: [],
    parallel: 1,
    record: async (key: string) => {
      await tick(20)
      return { ok: true as const, key, duration: 1 }
    },
    removeOrphans: async () => 0,
  })

  it('runs a job per part and language, each found by its own language', async () => {
    const jobs = createJobs()
    const english = jobs.start(slow())
    const swedish = jobs.start(slow('sv'))
    if ('error' in english || 'error' in swedish) throw new Error('both should start')
    expect(jobs.start(slow('sv'))).toEqual({
      error: 'A generation is already running for act1 in sv.',
    })
    expect(jobs.latest('act1')?.id).toBe(english.id)
    expect(jobs.latest('act1', 'sv')?.id).toBe(swedish.id)
    expect(jobs.latest('act1', 'de')).toBeNull()
    expect(swedish.language).toBe('sv')
    expect(jobs.running('act1')).toBe(true)
    await finished(() => jobs.get(english.id))
    await finished(() => jobs.get(swedish.id))
    expect(jobs.running('act1')).toBe(false)
  })
})

describe('jobs, ending', () => {
  it('says when a job has ended, done or cancelled, once', async () => {
    const jobs = createJobs()
    const ended: string[] = []
    const job = jobs.start({
      part: 'act1',
      speaker: null,
      keys: ['a', 'b'],
      orphans: [],
      parallel: 1,
      record: async (key) => (await tick(), { ok: true, key, duration: 1 }),
      removeOrphans: async () => 0,
      onEnd: () => ended.push('act1'),
    })
    if ('error' in job) throw new Error(job.error)
    jobs.cancel(job.id)
    expect(ended).toEqual([])
    await finished(() => jobs.get(job.id))
    expect(ended).toEqual(['act1'])
  })
})

describe('jobs, edge cases', () => {
  const base = {
    part: 'act1',
    speaker: null,
    orphans: [] as string[],
    parallel: 1,
    removeOrphans: async () => 0,
  }

  it('lists a line whose recording throws, is gone, or has problems', async () => {
    const jobs = createJobs()
    const job = jobs.start({
      ...base,
      keys: ['a', 'b', 'c'],
      record: async (key) => {
        if (key === 'a') throw new Error('crashed')
        if (key === 'b') return null
        return { ok: false, problems: [{ file: 'f.json', path: '', message: 'broken' }] }
      },
    })
    if ('error' in job) throw new Error(job.error)
    const done = await finished(() => jobs.get(job.id))
    expect(done.failed).toEqual([
      { key: 'a', message: 'crashed' },
      { key: 'b', message: 'the line is no longer in the dialog' },
      { key: 'c', message: 'f.json: broken' },
    ])
  })

  it('ignores a cancel once every line is done, and reports orphan trouble apart', async () => {
    const jobs = createJobs()
    let release = () => {}
    const job = jobs.start({
      ...base,
      keys: ['a'],
      orphans: ['old'],
      record: async (key) => ({ ok: true, key, duration: 1 }),
      removeOrphans: async () => {
        await new Promise<void>((r) => (release = r))
        throw new Error('locked')
      },
    })
    if ('error' in job) throw new Error(job.error)
    await tick(20)
    expect(jobs.cancel(job.id)?.status).toBe('running')
    release()
    const done = await finished(() => jobs.get(job.id))
    expect(done).toMatchObject({ status: 'done', failed: [], orphanError: 'locked' })
  })

  it('counts a line skipped as no longer needed as done, not failed', async () => {
    const jobs = createJobs()
    const job = jobs.start({
      ...base,
      keys: ['a'],
      record: async (key) => ({ ok: true, key, skipped: true }),
    })
    if ('error' in job) throw new Error(job.error)
    const done = await finished(() => jobs.get(job.id))
    expect(done).toMatchObject({ done: 1, skipped: 1, failed: [] })
  })
})

describe('jobs, cancel with every line under way', () => {
  it('cancels while the last lines record, and removes no orphans', async () => {
    const jobs = createJobs()
    let removeCalled = false
    const job = jobs.start({
      part: 'act1',
      speaker: null,
      keys: ['a', 'b'],
      orphans: ['o'],
      parallel: 2,
      record: async (key) => {
        await tick(30)
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
    expect(done).toMatchObject({ status: 'cancelled', done: 2 })
    expect(removeCalled).toBe(false)
  })
})

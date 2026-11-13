import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { FishError, type FishClient } from '../services/fish'
import { startServer } from './index'
import { encode, fish, gate, until } from './test-support'

describe('server, the spending record', () => {
  const oneAtATime = { ...(projectJson().narration as object), generate: { parallel: 1 } }
  const freeProject = projectJson({ narration: oneAtATime })
  const paidProject = projectJson({
    narration: { ...oneAtATime, models: { fish: { draft: 's2-pro' } } },
  })
  const script = ['a', 'b', 'c'].map((id) => ({ id, speaker: 'narrator', text: `Line ${id}.` }))
  const repo = tempRepo({
    'content-studio.json': paidProject,
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': script,
  })
  const projectFile = join(repo, 'content-studio.json')
  const requests: ReturnType<typeof gate>[] = []
  let hold = false
  let failFrom = Infinity
  let sent = 0
  const account: FishClient = {
    ...fish,
    createVoice: () => Promise.reject(new Error('not used')),
    async credit() {
      return 100
    },
    async tts(request) {
      if (++sent > failFrom) throw new FishError(500, 'boom')
      if (hold) {
        const waiting = gate()
        requests.push(waiting)
        await waiting.opened
      }
      return fish.tts(request)
    },
  }
  const server = startServer({ projectFile, port: 0, fish: account, encode, transcriber: null })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }
  const post = (path: string, body: unknown) =>
    fetch(at(path), { method: 'POST', headers: own, body: JSON.stringify(body) })
  const spending = async () => (await fetch(at('/api/spending'))).json()
  const ceilingOf = async () =>
    (await (await fetch(at('/api/parts/act1/plan'))).json()).plan.ceiling as number
  const startJob = async (keys: string[]) => {
    const ceiling = (await (await fetch(at('/api/parts/act1/plan'))).json()).plan.ceiling
    return (
      await post('/api/parts/act1/jobs', {
        speaker: null,
        keys,
        orphans: [],
        confirmedCost: ceiling,
      })
    ).json()
  }
  const waitJob = async (id: string) => {
    for (;;) {
      const state = await (await fetch(at(`/api/jobs/${id}`))).json()
      if (state.status !== 'running' && state.status !== 'cancelling') return state
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  const settle = async (rows: number) => {
    const giveUp = Date.now() + 2000
    for (;;) {
      const now = await spending()
      if (now.ok && now.rows.filter((r: { state: string }) => r.state !== 'running').length >= rows)
        return now
      if (Date.now() > giveUp) throw new Error('waited in vain')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  it('is empty before anything is recorded', async () => {
    expect(await spending()).toMatchObject({ ok: true, total: 0, count: 0, rows: [] })
  })

  it('logs a paid one-line recording with what it was charged', async () => {
    const ceiling = await ceilingOf()
    const line = (await (await fetch(at('/api/parts/act1/plan'))).json()).plan.cost / 3
    const done = await post('/api/parts/act1/lines/a/record', { confirmedCost: ceiling })
    expect(await done.json()).toMatchObject({ ok: true })
    const now = await spending()
    expect(now.count).toBe(1)
    expect(now.rows[0]).toMatchObject({
      part: 'act1',
      language: 'en',
      model: 's2-pro',
      lines: 1,
      planned: 1,
      state: 'done',
    })
    expect(now.rows[0].cost).toBeGreaterThan(0)
    expect(now.rows[0].cost).toBeLessThan(line * 1.01)
    expect(now.acts[0]).toMatchObject({ part: 'act1', title: 'Act I' })
    expect(now.total).toBeCloseTo(now.rows[0].cost, 12)
    expect(existsSync(join(repo, 'content-studio/cache/spending.json'))).toBe(true)
  })

  it('logs a whole-part job, and shows it live while it runs', async () => {
    hold = true
    const job = await startJob(['b', 'c'])
    await until(() => requests.length >= 1)
    const live = await spending()
    expect(live.rows[0]).toMatchObject({ state: 'running', planned: 2, lines: 0 })
    expect(live.rows[0].cost).toBeGreaterThan(0)
    expect(live.count).toBe(2)
    hold = false
    for (const r of requests) r.open()
    await waitJob(job.id)
    const now = await settle(2)
    expect(now.rows.map((r: { state: string }) => r.state)).toEqual(['done', 'done'])
    expect(now.rows[0]).toMatchObject({ lines: 2, planned: 2 })
  })

  it('logs a job that stopped, or ended on an error, with the lines it got through', async () => {
    writeFileSync(
      join(repo, 'tts/act1/script.json'),
      JSON.stringify(script.map((l) => ({ ...l, text: `${l.text} Again.` }))),
    )
    sent = 0
    failFrom = 1
    const failing = await startJob(['a', 'b', 'c'])
    await waitJob(failing.id)
    const now = await settle(3)
    expect(now.rows[0]).toMatchObject({ state: 'error', lines: 1, planned: 3 })
    failFrom = Infinity
  })

  it('keeps the record across a restart of the studio', async () => {
    const again = startServer({ projectFile, port: 0, fish: account, encode, transcriber: null })
    try {
      const body = await (await fetch(new URL('/api/spending', again.url))).json()
      expect(body.count).toBe(3)
    } finally {
      again.stop(true)
    }
  })

  it('says so when the record is damaged', async () => {
    const path = join(repo, 'content-studio/cache/spending.json')
    const good = readFileSync(path, 'utf8')
    writeFileSync(path, '{ nope')
    const body = await spending()
    expect(body).toMatchObject({ ok: false })
    expect(body.problems[0].file).toBe('content-studio/cache/spending.json')
    writeFileSync(path, good)
  })

  it('logs nothing for a free model', async () => {
    const freeRepo = tempRepo({
      'content-studio.json': freeProject,
      'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
      'tts/act1/script.json': script,
    })
    const free = startServer({
      projectFile: join(freeRepo, 'content-studio.json'),
      port: 0,
      fish: account,
      encode,
      transcriber: null,
    })
    try {
      const o = { origin: free.url.origin, 'content-type': 'application/json' }
      const res = await fetch(new URL('/api/parts/act1/lines/a/record', free.url), {
        method: 'POST',
        headers: o,
        body: '{}',
      })
      expect(await res.json()).toMatchObject({ ok: true })
      expect(await (await fetch(new URL('/api/spending', free.url))).json()).toMatchObject({
        ok: true,
        count: 0,
      })
      expect(existsSync(join(freeRepo, 'content-studio/cache/spending.json'))).toBe(false)
    } finally {
      free.stop(true)
    }
  })

  it('logs a job stopped part-way as stopped, with the lines it got through', async () => {
    writeFileSync(
      join(repo, 'tts/act1/script.json'),
      JSON.stringify(script.map((l) => ({ ...l, text: `${l.text} Once more.` }))),
    )
    const before = (await spending()).count
    requests.length = 0
    hold = true
    const job = await startJob(['a', 'b', 'c'])
    await until(() => requests.length >= 1)
    await fetch(at(`/api/jobs/${job.id}`), { method: 'DELETE', headers: own })
    hold = false
    for (const r of requests) r.open()
    await waitJob(job.id)
    const now = await settle(before + 1)
    expect(now.rows[0]).toMatchObject({ state: 'stopped', planned: 3 })
    expect(now.rows[0].lines).toBeGreaterThan(0)
    expect(now.rows[0].lines).toBeLessThan(3)
  })

  it('logs a paid take whose request failed after it was charged as ended on an error', async () => {
    const before = (await spending()).count
    const ceiling = await ceilingOf()
    sent = 0
    failFrom = 0
    const res = await post('/api/parts/act1/lines/a/takes', { confirmedCost: ceiling })
    failFrom = Infinity
    expect((await res.json()).ok).toBe(false)
    const now = await spending()
    expect(now.count).toBe(before + 1)
    expect(now.rows[0]).toMatchObject({ state: 'error', lines: 0, planned: 1 })
    expect(now.rows[0].cost).toBeGreaterThan(0)
    expect(now.rows.some((r: { state: string }) => r.state === 'running')).toBe(false)
  })

  it('logs a paid extra take', async () => {
    const before = (await spending()).count
    const ceiling = await ceilingOf()
    const res = await post('/api/parts/act1/lines/a/takes', { confirmedCost: ceiling })
    expect(await res.json()).toMatchObject({ ok: true })
    const now = await spending()
    expect(now.count).toBe(before + 1)
    expect(now.rows[0]).toMatchObject({ lines: 1, planned: 1, state: 'done' })
  })
})

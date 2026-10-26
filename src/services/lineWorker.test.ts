import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { WORKERS_DIR, createLineWorker } from './lineWorker'

const fake = join(import.meta.dir, '../../test/fixtures/fake-whisper.ts')
const make = (options: Partial<Parameters<typeof createLineWorker>[0]> = {}) =>
  createLineWorker({
    name: 'The fake',
    command: [process.execPath, fake],
    timeoutMs: 5000,
    couldNotStart: (why) => `could not start: ${why}`,
    ...options,
  })

describe('createLineWorker', () => {
  it('answers each request by its id, several at once', async () => {
    const worker = make()
    const [a, b] = await Promise.all([
      worker.request({ path: '/c/one.wav', model: 'm' }),
      worker.request({ path: '/c/two-three.wav', model: 'm' }),
    ])
    expect(JSON.stringify(a)).toContain('"one"')
    expect(JSON.stringify(b)).toContain('"three"')
    worker.close()
  })

  it('names the worker in an error answer and in the message of one that died', async () => {
    const worker = make()
    await expect(worker.request({ path: '/c/fail.wav' })).rejects.toThrow(
      'The fake: RuntimeError: bad audio',
    )
    await expect(worker.request({ path: '/c/crash.wav' })).rejects.toThrow(
      'The fake stopped (exit code 3)',
    )
    expect(JSON.stringify(await worker.request({ path: '/c/after.wav' }))).toContain('"after"')
    worker.close()
  })

  it('names the worker when it takes too long', async () => {
    const worker = make({ timeoutMs: 300 })
    await expect(worker.request({ path: '/c/hang.wav' })).rejects.toThrow(
      'The fake took longer than 0.3 s; it was stopped',
    )
    worker.close()
  })

  it('gives the process the environment it was asked for', async () => {
    const script = `for await (const line of console) { const { id } = JSON.parse(line); console.log(JSON.stringify({ id, said: process.env.LINE_WORKER_TEST })) }`
    const worker = make({
      command: [process.execPath, '-e', script],
      env: { LINE_WORKER_TEST: 'hello' },
    })
    expect(await worker.request({})).toEqual({ said: 'hello' })
    worker.close()
  })

  it("runs the worker in the studio's worker folder, not in the game's repository", async () => {
    // ACE-Step writes ./.cache/acestep/progress_estimates.json; the studio runs from the game's repo.
    const script = `for await (const line of console) { const { id } = JSON.parse(line); console.log(JSON.stringify({ id, cwd: process.cwd() })) }`
    const worker = make({ command: [process.execPath, '-e', script] })
    const { cwd } = await worker.request({})
    expect(cwd).not.toBe(process.cwd())
    expect(cwd).toBe(WORKERS_DIR)
    worker.close()
  })

  it('says why when the process cannot start', async () => {
    const worker = make({ command: ['no-such-command-xyz'] })
    await expect(worker.request({})).rejects.toThrow('could not start')
    worker.close()
  })
})

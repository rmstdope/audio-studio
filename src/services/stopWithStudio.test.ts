import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fixture = join(import.meta.dir, '../../test/fixtures/studio-with-worker.ts')
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Whether a process with this pid is still running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Starts a stand-in studio with a generator of `kind` running, and gives the generator's child. */
async function studioWithWorker(kind: 'line' | 'image') {
  const pidFile = join(mkdtempSync(join(tmpdir(), 'stop-with-studio-')), 'child.pid')
  const studio = Bun.spawn([process.execPath, fixture, kind, pidFile], { stdout: 'ignore' })
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await wait(50)
  await wait(50)
  const child = Number(readFileSync(pidFile, 'utf8').trim())
  return { studio, child }
}

describe('a local generator stops with the studio', () => {
  for (const kind of ['line', 'image'] as const) {
    it(`stops ${kind === 'line' ? 'a music or effects worker' : 'an image take'}, and what it started, on SIGTERM`, async () => {
      const { studio, child } = await studioWithWorker(kind)
      try {
        expect(alive(child)).toBe(true)
        studio.kill('SIGTERM')
        await studio.exited
        for (let i = 0; i < 20 && alive(child); i++) await wait(50)
        expect(alive(child)).toBe(false)
      } finally {
        if (alive(child)) process.kill(child, 'SIGKILL')
      }
    })
  }
})

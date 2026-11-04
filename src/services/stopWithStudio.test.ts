import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
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

/** The pid written to `file`, or 0 while it holds none yet. */
function pidIn(file: string): number {
  try {
    return Number(readFileSync(file, 'utf8').trim()) || 0
  } catch {
    return 0
  }
}

describe('a local generator stops with the studio', () => {
  for (const kind of ['line', 'image'] as const) {
    for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
      it(`stops ${kind === 'line' ? 'a music or effects worker' : 'an image take'}, and what it started, on ${signal}`, async () => {
        const pidFile = join(mkdtempSync(join(tmpdir(), 'stop-with-studio-')), 'child.pid')
        const studio = Bun.spawn([process.execPath, fixture, kind, pidFile], { stdout: 'ignore' })
        let child = 0
        try {
          for (let i = 0; i < 100 && !child; i++) {
            await wait(50)
            child = pidIn(pidFile)
          }
          expect(child).toBeGreaterThan(0)
          expect(alive(child)).toBe(true)
          studio.kill(signal)
          await studio.exited
          for (let i = 0; i < 20 && alive(child); i++) await wait(50)
          expect(alive(child)).toBe(false)
        } finally {
          studio.kill('SIGKILL')
          if (child > 0 && alive(child)) process.kill(child, 'SIGKILL')
        }
      })
    }
  }
})

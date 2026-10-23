import { join } from 'node:path'
import type { HeardSegment } from '../core/align'

/** Hears what a clip says. Behind an interface, so tests use a fake. */
export interface Transcriber {
  /** What Whisper (`model`) heard in the WAV file at `path`: its segments, with word timings. */
  transcribe(model: string, path: string): Promise<HeardSegment[]>
  /** Stops the worker, if one is running. */
  close(): void
}

/** The worker script, run with uv (which installs mlx-whisper the first time). */
export const WORKER = join(import.meta.dir, '../../worker/transcribe.py')

interface Pending {
  resolve: (segments: HeardSegment[]) => void
  reject: (error: Error) => void
}

/** A running worker and the requests it has not answered yet. */
interface Worker {
  proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
  pending: Map<string, Pending>
  /** Why it was stopped on purpose, if it was. */
  stoppedBecause: string | null
}

/**
 * A long-lived Whisper worker (worker/transcribe.py, mlx-whisper on Apple silicon), started on
 * first use so the model loads once; the model is named with each request (mlx-whisper reloads
 * only when it changes). Requests are answered in turn. A worker that dies fails only its own
 * waiting requests and is started again next time; one that takes longer than `timeoutMs` on a
 * request is stopped, failing everything it had with that reason. It exits by itself when its
 * input closes, as it does when the studio stops. `command` replaces the worker (tests).
 */
export function createWhisperWorker({
  command = ['uv', 'run', '--quiet', '--script', WORKER],
  timeoutMs = 10 * 60_000,
}: { command?: string[]; timeoutMs?: number } = {}): Transcriber {
  let worker: Worker | null = null
  let counter = 0

  function start(): Worker {
    const proc = Bun.spawn(command, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    const current: Worker = { proc, pending: new Map(), stoppedBecause: null }
    let stderr = ''
    const note = (text: string) => {
      // Progress bars (carriage returns, "%|") are noise in a message; keep the rest, briefly.
      const kept = text
        .split('\n')
        .filter((line) => line.trim() && !line.includes('\r') && !line.includes('%|'))
        .join('\n')
      if (kept) stderr = `${stderr}\n${kept}`.slice(-2000)
    }
    void (async () => {
      for await (const chunk of proc.stderr) note(new TextDecoder().decode(chunk))
    })()
    void (async () => {
      let buffer = ''
      for await (const chunk of proc.stdout) {
        buffer += new TextDecoder().decode(chunk)
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (!answer(current, line)) note(`(not an answer) ${line}`)
          newline = buffer.indexOf('\n')
        }
      }
    })()
    void proc.exited.then((code) => {
      if (worker === current) worker = null
      const why = stderr.trim().split('\n').slice(-3).join(' ')
      const reason =
        current.stoppedBecause ??
        `the Whisper worker stopped (exit code ${code})${why ? `: ${why}` : ''}`
      for (const waiting of current.pending.values()) waiting.reject(new Error(reason))
      current.pending.clear()
    })
    return current
  }

  /** Settles the request an answer line is for; false if the line is not an answer. */
  function answer(current: Worker, line: string): boolean {
    if (!line.trim()) return true
    let message: { id?: string; segments?: HeardSegment[]; error?: string }
    try {
      message = JSON.parse(line)
    } catch {
      return false
    }
    const waiting = message.id ? current.pending.get(message.id) : undefined
    if (!waiting || !message.id) return false
    current.pending.delete(message.id)
    if (message.error) waiting.reject(new Error(`Whisper: ${message.error}`))
    else waiting.resolve(message.segments ?? [])
    return true
  }

  return {
    transcribe(model, path) {
      if (!worker) {
        try {
          worker = start()
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error)
          return Promise.reject(
            new Error(
              `Whisper could not start (${why}). It needs uv and Apple silicon; set ` +
                'quality.transcriber to "none" in the project file to record without checking.',
            ),
          )
        }
      }
      const current = worker
      const id = String(++counter)
      return new Promise<HeardSegment[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          current.stoppedBecause = `Whisper took longer than ${timeoutMs / 1000} s; it was stopped`
          current.proc.kill()
        }, timeoutMs)
        current.pending.set(id, {
          resolve: (segments) => {
            clearTimeout(timer)
            resolve(segments)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
        current.proc.stdin.write(`${JSON.stringify({ id, path, model })}\n`)
        void current.proc.stdin.flush()
      })
    },
    close() {
      worker?.proc.kill()
      worker = null
    },
  }
}

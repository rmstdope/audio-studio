import { join } from 'node:path'
import type { HeardSegment } from '../core/align'

/** Hears what a clip says. Behind an interface, so tests use a fake. */
export interface Transcriber {
  /** What Whisper heard in the WAV file at `path`: its segments, with word timings. */
  transcribe(path: string): Promise<HeardSegment[]>
  /** Stops the worker, if one is running. */
  close(): void
}

/** The worker script, run with uv (which installs mlx-whisper the first time). */
export const WORKER = join(import.meta.dir, '../../worker/transcribe.py')

/** A transcription taking longer than this stops the worker (the first one loads the model). */
const TIMEOUT_MS = 10 * 60_000

interface Pending {
  resolve: (segments: HeardSegment[]) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * A long-lived Whisper worker (worker/transcribe.py, mlx-whisper on Apple silicon), started on
 * first use so the model loads once. It exits by itself when its input closes, as it does when
 * the studio stops. Requests are answered in turn; a worker that dies rejects
 * what it had and is started again next time. `command` replaces the worker (tests).
 */
export function createWhisperWorker({
  model,
  command = ['uv', 'run', '--quiet', '--script', WORKER],
}: {
  model: string
  command?: string[]
}): Transcriber {
  let child: ReturnType<typeof spawn> | null = null
  const pending = new Map<string, Pending>()
  let counter = 0

  function spawn() {
    return Bun.spawn(command, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  }

  function failAll(error: Error) {
    for (const [id, waiting] of pending) {
      clearTimeout(waiting.timer)
      waiting.reject(error)
      pending.delete(id)
    }
  }

  function start(): ReturnType<typeof spawn> {
    const proc = spawn()
    let stderr = ''
    void (async () => {
      for await (const chunk of proc.stderr)
        stderr = (stderr + new TextDecoder().decode(chunk)).slice(-2000)
    })()
    void (async () => {
      let buffer = ''
      for await (const chunk of proc.stdout) {
        buffer += new TextDecoder().decode(chunk)
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          answer(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
        }
      }
    })()
    void proc.exited.then((code) => {
      if (child === proc) child = null
      const why = stderr.trim().split('\n').slice(-3).join(' ')
      failAll(new Error(`the Whisper worker stopped (exit code ${code})${why ? `: ${why}` : ''}`))
    })
    return proc
  }

  function answer(line: string) {
    if (!line.trim()) return
    let message: { id?: string; segments?: HeardSegment[]; error?: string }
    try {
      message = JSON.parse(line)
    } catch {
      return // not an answer: ignore it
    }
    const waiting = message.id ? pending.get(message.id) : undefined
    if (!waiting || !message.id) return
    pending.delete(message.id)
    clearTimeout(waiting.timer)
    if (message.error) waiting.reject(new Error(`Whisper: ${message.error}`))
    else waiting.resolve(message.segments ?? [])
  }

  return {
    transcribe(path) {
      if (!child) {
        try {
          child = start()
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
      const id = String(++counter)
      const proc = child
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(
            new Error(`Whisper took longer than ${TIMEOUT_MS / 60_000} minutes; it was stopped`),
          )
          proc.kill()
        }, TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        proc.stdin.write(`${JSON.stringify({ id, path, model })}\n`)
        void proc.stdin.flush()
      })
    },
    close() {
      child?.kill()
      child = null
    },
  }
}

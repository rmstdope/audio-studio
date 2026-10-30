import { join } from 'node:path'

/**
 * The studio's own worker folder, where every worker runs: what a worker writes beside itself
 * (ACE-Step's ./.cache) stays with the studio, never in the game's repository the studio runs from.
 */
export const WORKERS_DIR = join(import.meta.dir, '../../worker')

/** The lines of a process's stderr without its progress bars (carriage returns, "%|"), which are noise in a message. */
export function quietLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.trim() && !line.includes('\r') && !line.includes('%|'))
    .join('\n')
}

/** A request to a worker: anything, plus the `id` the worker answers it by (added here). */
type Payload = Record<string, unknown>

/** A long-lived worker process that speaks JSON lines: one request per line in, one answer per line out. */
export interface LineWorker {
  /**
   * Sends `payload` and gives the worker's answer (its JSON line, without the `id`). An answer
   * with an `error` rejects, saying the worker's name and the error.
   */
  request(payload: Payload): Promise<Record<string, unknown>>
  /** Stops the worker, if one is running; resolves once its process is gone and its memory free. */
  close(): Promise<void>
}

interface Pending {
  resolve: (answer: Record<string, unknown>) => void
  reject: (error: Error) => void
}

/** A running worker and the requests it has not answered yet. */
interface Running {
  proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
  pending: Map<string, Pending>
  /** Why it was stopped on purpose, if it was. */
  stoppedBecause: string | null
}

/** How a line worker is run. */
export interface LineWorkerOptions {
  /** What the worker is called, starting a sentence ("Whisper", "The music generator"). */
  name: string
  command: string[]
  /** How long one request may take before the worker is stopped. */
  timeoutMs: number
  /** What to say when the process cannot be started at all; `why` is the system's reason. */
  couldNotStart: (why: string) => string
  /**
   * What to say when the system killed the worker (SIGKILL, exit code 137: on macOS, most often
   * memory running out), in place of its exit code and last log lines.
   */
  killed?: string
  /** Extra environment for the process, over the studio's own. */
  env?: Record<string, string>
}

/**
 * A worker process started on its first request and kept, so a model loads once. Requests are
 * answered by `id`, several may wait at once. A worker that dies fails only the requests waiting
 * for it and is started again next time; one that takes longer than `timeoutMs` on a request is
 * stopped, failing everything it had with that reason. It exits by itself when its input closes,
 * as it does when the studio stops.
 */
export function createLineWorker({
  name,
  command,
  timeoutMs,
  couldNotStart,
  killed,
  env,
}: LineWorkerOptions): LineWorker {
  let worker: Running | null = null
  let counter = 0

  function start(): Running {
    const proc = Bun.spawn(command, {
      cwd: WORKERS_DIR,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      ...(env ? { env: { ...process.env, ...env } } : {}),
    })
    const current: Running = { proc, pending: new Map(), stoppedBecause: null }
    let stderr = ''
    const note = (text: string) => {
      const kept = quietLines(text)
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
      const wasKilled = code === 137 || current.proc.signalCode === 'SIGKILL'
      const reason =
        current.stoppedBecause ??
        (killed && wasKilled
          ? killed
          : `${name} stopped (exit code ${code})${why ? `: ${why}` : ''}`)
      for (const waiting of current.pending.values()) waiting.reject(new Error(reason))
      current.pending.clear()
    })
    return current
  }

  /** Settles the request an answer line is for; false if the line is not an answer. */
  function answer(current: Running, line: string): boolean {
    if (!line.trim()) return true
    let message: { id?: string; error?: string } & Record<string, unknown>
    try {
      message = JSON.parse(line)
    } catch {
      return false
    }
    const waiting = message.id ? current.pending.get(message.id) : undefined
    if (!waiting || !message.id) return false
    current.pending.delete(message.id)
    const { id: _id, ...rest } = message
    if (message.error) waiting.reject(new Error(`${name}: ${message.error}`))
    else waiting.resolve(rest)
    return true
  }

  return {
    request(payload) {
      if (!worker) {
        try {
          worker = start()
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error)
          return Promise.reject(new Error(couldNotStart(why)))
        }
      }
      const current = worker
      const id = String(++counter)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          current.stoppedBecause = `${name} took longer than ${timeoutMs / 1000} s; it was stopped`
          current.proc.kill()
        }, timeoutMs)
        current.pending.set(id, {
          resolve: (result) => {
            clearTimeout(timer)
            resolve(result)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
        current.proc.stdin.write(`${JSON.stringify({ id, ...payload })}\n`)
        void current.proc.stdin.flush()
      })
    },
    async close() {
      const closing = worker
      worker = null
      closing?.proc.kill()
      await closing?.proc.exited
    },
  }
}

/** Runs jobs a few at a time, and lets requests for the same key share one run. */
export interface Limiter {
  /**
   * Runs `job` once no more than `limit` jobs are running; while a job for `key` is waiting or
   * running, another request for `key` gets the same result instead of a second run.
   */
  run<T>(key: string, limit: number, job: () => Promise<T>): Promise<T>
}

/** A limiter for one kind of work (e.g. Fish requests). */
export function createLimiter(): Limiter {
  const inFlight = new Map<string, Promise<unknown>>()
  const waiting: (() => void)[] = []
  let running = 0

  async function slot(limit: number): Promise<void> {
    while (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    running++
  }

  function release() {
    running--
    waiting.shift()?.()
  }

  return {
    run<T>(key: string, limit: number, job: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key)
      if (existing) return existing as Promise<T>
      const result = (async () => {
        await slot(limit)
        try {
          return await job()
        } finally {
          release()
        }
      })()
      inFlight.set(key, result)
      const forget = () => inFlight.delete(key)
      result.then(forget, forget)
      return result
    },
  }
}

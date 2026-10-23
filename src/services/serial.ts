/** Runs jobs with the same key one after another, each after the one before has finished. */
export interface Serial {
  run<T>(key: string, job: () => Promise<T>): Promise<T>
}

/**
 * A queue per key: jobs for one key run one at a time in the order asked, jobs for different keys
 * run side by side. A failed job does not stop the ones after it.
 */
export function createSerial(): Serial {
  const tails = new Map<string, Promise<unknown>>()
  return {
    run<T>(key: string, job: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve()
      const next = previous.catch(() => {}).then(job)
      tails.set(key, next)
      const forget = () => {
        if (tails.get(key) === next) tails.delete(key)
      }
      next.then(forget, forget)
      return next
    },
  }
}

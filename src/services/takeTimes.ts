import { dirname } from 'node:path'
import { CACHE_DIR } from '../core/project'
import { cleanTimes, recordTime, TakeTimesSchema } from '../core/takeTimes'
import type { TakeTimes, TimeKey } from '../core/takeTimes'
import { readResource, writeAtomic } from './files'
import { createSerial } from './serial'

/** Where the timings are kept: in the studio's cache, so they stay on this computer and are never committed. */
export const TAKE_TIMES_FILE = `${CACHE_DIR}/take-times.json`

/** One change of the timings file at a time, so two finished takes never lose each other's time. */
const writes = createSerial()

/**
 * The timings kept on this computer for the project at `projectFile`. Missing, broken or
 * unreadable timings are none: the models read as guesses again, with no error.
 */
export async function readTakeTimes(projectFile: string): Promise<TakeTimes> {
  const read = await readResource(dirname(projectFile), TAKE_TIMES_FILE, TakeTimesSchema, []).catch(
    () => 'invalid' as const,
  )
  return read === 'missing' || read === 'invalid' ? {} : cleanTimes(read)
}

/**
 * Keeps how long a finished take took, for what it was timed as. A disk that refuses the write
 * loses only that one time.
 */
export function recordTakeTime(projectFile: string, key: TimeKey, seconds: number): Promise<void> {
  const root = dirname(projectFile)
  return writes.run(root, async () => {
    const times = recordTime(await readTakeTimes(projectFile), key, seconds)
    await writeAtomic(root, TAKE_TIMES_FILE, `${JSON.stringify(times, null, 2)}\n`).catch(() => {})
  })
}

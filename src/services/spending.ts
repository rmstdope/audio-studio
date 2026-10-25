import { dirname } from 'node:path'
import type { Problem } from '../core/project'
import { SpendingSchema, type Recording } from '../core/spending'
import { readResource, writeAtomic } from './files'
import { createSerial } from './serial'

/** Where paid recordings are remembered, in the project's tool state. */
export const SPENDING_FILE = '.audio-studio/spending.json'

/** What the record holds, or what is wrong with the file. */
export type SpendingRead =
  { ok: true; recordings: Recording[] } | { ok: false; problems: Problem[] }

/** Changes to the record, one at a time. */
const writes = createSerial()

/** The paid recordings so far, oldest first; none if nothing was recorded yet. */
export async function readSpending(projectFile: string): Promise<SpendingRead> {
  const problems: Problem[] = []
  const read = await readResource(dirname(projectFile), SPENDING_FILE, SpendingSchema, problems)
  if (read === 'missing') return { ok: true, recordings: [] }
  if (read === 'invalid') return { ok: false, problems }
  return { ok: true, recordings: read.recordings }
}

/**
 * Adds a finished recording to the record. A damaged record is left as it is (the user may want
 * to repair it) and its problems given instead.
 */
export function appendRecording(projectFile: string, recording: Recording): Promise<SpendingRead> {
  return writes.run(projectFile, async () => {
    const before = await readSpending(projectFile)
    if (!before.ok) return before
    const recordings = [...before.recordings, recording]
    await writeAtomic(
      dirname(projectFile),
      SPENDING_FILE,
      `${JSON.stringify({ version: 1, recordings }, null, 1)}\n`,
    )
    return { ok: true, recordings }
  })
}

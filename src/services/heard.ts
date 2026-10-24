import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { HeardSchema, emptyHeard, withHeard, type Heard, type HeardLine } from '../core/heard'
import { resolveInRoot } from '../core/paths'
import { characterFile, readJson, writeAtomic } from './files'
import { readPart, type ProjectFailure } from './workspace'

/** Where what Whisper heard of each part's lines is kept, in the project's tool cache. */
export const HEARD_DIR = '.audio-studio/heard'

/** What Whisper heard of a line's take now, or nothing kept for it; null for an unknown line. */
export type HeardResult = { ok: true; heard: HeardLine | null } | ProjectFailure | null

/**
 * Keeps what Whisper heard of a line's kept take, or forgets it (null: heard in full); none left
 * removes the part's file. Called in the part's turn, with the take's lock entry written.
 */
export async function keepHeard(
  projectFile: string,
  partId: string,
  key: string,
  line: HeardLine | null,
): Promise<void> {
  const before = await read(projectFile, partId)
  const next = withHeard(before, key, line)
  if (next === before) return
  const root = dirname(projectFile)
  // Any part id makes a safe file name this way, as any character id does.
  const file = characterFile(HEARD_DIR, partId)
  if (Object.keys(next.lines).length) {
    await writeAtomic(root, file, `${JSON.stringify(next, null, 1)}\n`)
  } else {
    await rm(resolveInRoot(root, file), { force: true })
  }
}

/** What Whisper heard of a line's take as it is now: nothing if what was kept is of another take. */
export async function heardFor(
  projectFile: string,
  partId: string,
  key: string,
): Promise<HeardResult> {
  const part = await readPart(projectFile, partId)
  if (!part || !part.ok) return part
  if (!part.input.lines.some((l) => l.key === key)) return null
  const kept = (await read(projectFile, partId)).lines
  const line = Object.hasOwn(kept, key) ? kept[key]! : null
  const locked = Object.hasOwn(part.input.lock, key) ? part.input.lock[key] : undefined
  return { ok: true, heard: line && locked?.at === line.at ? line : null }
}

/** What was kept for a part; nothing if there is no file, or it does not fit (a hand edit). */
async function read(projectFile: string, partId: string): Promise<Heard> {
  const file = resolveInRoot(dirname(projectFile), characterFile(HEARD_DIR, partId))
  const json = await readJson(file)
  if (json.status !== 'ok') return emptyHeard(partId)
  const parsed = HeardSchema.safeParse(json.value)
  return parsed.success && parsed.data.part === partId ? parsed.data : emptyHeard(partId)
}

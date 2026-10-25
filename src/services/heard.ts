import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { HeardSchema, emptyHeard, withHeard, type Heard, type HeardLine } from '../core/heard'
import { resolveInRoot } from '../core/paths'
import { characterFile, readCached, writeAtomic } from './files'
import { inPartTurn } from './partFiles'
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
  /** What names the part's file in the cache: the part's id, with the language besides the source. */
  name: string,
  key: string,
  line: HeardLine | null,
): Promise<void> {
  const before = await read(projectFile, name)
  const next = withHeard(before, key, line)
  if (next === before) return
  const root = dirname(projectFile)
  // Any part id makes a safe file name this way, as any character id does.
  const file = characterFile(HEARD_DIR, name)
  if (Object.keys(next.lines).length) {
    await writeAtomic(root, file, `${JSON.stringify(next, null, 1)}\n`)
  } else {
    await rm(resolveInRoot(root, file), { force: true })
  }
}

/**
 * What Whisper heard of a line's take as it is now: nothing if what was kept is of another take.
 * Read in the part's turn, so a take being written is seen with what was heard of it.
 */
export async function heardFor(
  projectFile: string,
  partId: string,
  key: string,
  language?: string,
): Promise<HeardResult> {
  return inPartTurn(projectFile, partId, async () => {
    const part = await readPart(projectFile, partId, language)
    if (!part || !part.ok) return part
    if (!part.input.lines.some((l) => l.key === key)) return null
    const kept = (await read(projectFile, part.cacheName)).lines
    const line = Object.hasOwn(kept, key) ? kept[key]! : null
    return { ok: true, heard: line && part.input.lock[key]?.at === line.at ? line : null }
  })
}

/** What was kept for a part; nothing if there is no file, or it does not fit (a hand edit). */
async function read(projectFile: string, name: string): Promise<Heard> {
  const { value } = await readCached(
    dirname(projectFile),
    HEARD_DIR,
    name,
    HeardSchema,
    emptyHeard(name),
    (heard) => heard.part === name,
  )
  return value
}

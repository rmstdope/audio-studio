import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { z } from 'zod'
import { resolveInRoot } from '../core/paths'
import { problemsFrom, type Problem } from '../core/project'

/** What reading a JSON file gave. */
export type JsonRead =
  { status: 'ok'; value: unknown } | { status: 'missing' } | { status: 'invalid'; message: string }

/** A JSON file's value; 'missing' if there is no file, 'invalid' with a message if it is not JSON. */
export async function readJson(file: string): Promise<JsonRead> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { status: 'missing' }
    // A file that is there but cannot be read (a folder, no permission) is a problem to show.
    return { status: 'invalid', message: `could not be read (${code ?? (error as Error).message})` }
  }
  try {
    return { status: 'ok', value: JSON.parse(text) }
  } catch (error) {
    return { status: 'invalid', message: `not valid JSON: ${(error as Error).message}` }
  }
}

/**
 * A resource at `path` (relative to `root`) parsed with `schema`: 'missing' if there is no file,
 * 'invalid' if it is broken, with what is wrong added to `problems`.
 */
export async function readResource<T extends z.ZodType>(
  root: string,
  path: string,
  schema: T,
  problems: Problem[],
): Promise<z.infer<T> | 'missing' | 'invalid'> {
  const json = await readJson(resolveInRoot(root, path))
  if (json.status === 'missing') return 'missing'
  if (json.status === 'invalid') {
    problems.push({ file: path, path: '', message: json.message })
    return 'invalid'
  }
  const parsed = schema.safeParse(json.value)
  if (!parsed.success) {
    problems.push(...problemsFrom(path, parsed.error))
    return 'invalid'
  }
  return parsed.data
}

/** The names of the files in a folder; empty if the folder does not exist yet. */
export async function listFiles(folder: string): Promise<Set<string>> {
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    return new Set(entries.filter((e) => e.isFile()).map((e) => e.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }
}

/**
 * Writes `text` (or bytes) to `path` (relative to `root`) through a temporary file and a rename, so a crash
 * never leaves a half-written file. Each write has its own temporary file, so two writes at once
 * cannot mix. Creates the folder if needed.
 */
export async function writeAtomic(
  root: string,
  path: string,
  text: string | Uint8Array,
): Promise<void> {
  const file = resolveInRoot(root, path)
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text)
    await rename(temporary, file)
  } catch (error) {
    // Report the write's error, not a failure to clean up after it.
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * A JSON object written one entry per line, keys sorted: `{\n "a": {...},\n "b": {...}\n}\n`.
 * Small diffs when entries change, and still valid JSON.
 */
export function formatEntriesPerLine(record: Record<string, unknown>): string {
  const keys = Object.keys(record).sort()
  if (!keys.length) return '{}\n'
  const lines = keys.map((key) => ` ${JSON.stringify(key)}: ${JSON.stringify(record[key])}`)
  return `{\n${lines.join(',\n')}\n}\n`
}

/**
 * A per-part file of the tool's cache (what was heard, notes), read and checked against its
 * schema: `empty` when there is no file; `broken` (with `empty`) when there is one that cannot be
 * read or does not fit, so a caller writing the file can refuse to write over it.
 */
export async function readCached<T extends z.ZodType>(
  root: string,
  dir: string,
  partId: string,
  schema: T,
  empty: z.infer<T>,
  fits: (value: z.infer<T>) => boolean = () => true,
): Promise<{ value: z.infer<T>; broken: boolean; path: string }> {
  const path = characterFile(dir, partId)
  const json = await readJson(resolveInRoot(root, path))
  if (json.status === 'missing') return { value: empty, broken: false, path }
  if (json.status !== 'ok') return { value: empty, broken: true, path }
  const parsed = schema.safeParse(json.value)
  if (!parsed.success || !fits(parsed.data)) return { value: empty, broken: true, path }
  return { value: parsed.data, broken: false, path }
}

/**
 * A file of one character's in a folder of the tool's cache: a readable name plus a short hash of
 * the id, so any character id makes a safe file name.
 */
export function characterFile(dir: string, characterId: string): string {
  const readable = characterId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)
  const hash = createHash('sha256').update(characterId).digest('hex').slice(0, 8)
  return `${dir}/${readable}-${hash}.json`
}

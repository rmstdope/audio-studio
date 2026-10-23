import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
    throw error
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
 * Writes `text` to `path` (relative to `root`) through a temporary file and a rename, so a crash
 * never leaves a half-written file. Creates the folder if needed.
 */
export async function writeAtomic(root: string, path: string, text: string): Promise<void> {
  const file = resolveInRoot(root, path)
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, text)
  await rename(temporary, file)
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

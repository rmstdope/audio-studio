import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { ProjectSchema, problemsFrom, type Project } from '../core/project'
import { writeAtomic } from './files'
import { createSerial } from './serial'
import type { ProjectFailure } from './workspace'

/**
 * The queue every write to the project file goes through, so two saves never read the same text
 * and the later one loses the earlier one's change.
 */
export const projectWrites = createSerial()

/** The project file as it is on disk: its text, the JSON read from it and the parsed project. */
export interface OpenedProject {
  ok: true
  text: string
  /** The JSON as read, to change and write back; the key order is the file's. */
  raw: unknown
  project: Project
}

/** Reads the project file for a change, or says why it cannot be used. */
export async function openProject(projectFile: string): Promise<OpenedProject | ProjectFailure> {
  const file = basename(projectFile)
  const failure = (message: string): ProjectFailure => ({
    ok: false,
    file,
    problems: [{ file, path: '', message }],
  })
  let text: string
  try {
    text = await readFile(projectFile, 'utf8')
  } catch (error) {
    return failure(`could not be read (${(error as Error).message})`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return failure(`not valid JSON: ${(error as Error).message}`)
  }
  const current = ProjectSchema.safeParse(raw)
  if (!current.success) return { ok: false, file, problems: problemsFrom(file, current.error) }
  return { ok: true, text, raw, project: current.data }
}

/**
 * Writes the project file again from `render`, which is given the indentation the file used and
 * returns its JSON with `\n` line ends: the file's own line endings and last newline are kept.
 */
export async function saveProject(
  projectFile: string,
  opened: OpenedProject,
  render: (indent: string) => string,
): Promise<void> {
  const { text } = opened
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? '  '
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  await writeAtomic(
    dirname(projectFile),
    basename(projectFile),
    render(indent).replace(/\n/g, eol) + (/\n$/.test(text) ? eol : ''),
  )
}

/**
 * The project file's JSON in `indent`, each sound-alike group on one line (`["inn", "in"]`), as
 * the groups would be written by hand: every save of the file lays it out the same way.
 */
export function projectJson(raw: unknown, indent: string): string {
  const quality = (
    raw as {
      narration?: {
        quality?: { soundAlike?: unknown; soundAlikeByLanguage?: Record<string, unknown> }
      }
    }
  ).narration?.quality
  // Every list of groups in the file, the source language's and each language's, by where it is.
  const lists: { get: () => unknown; set: (value: unknown) => void }[] = []
  if (quality && Array.isArray(quality.soundAlike)) {
    lists.push({ get: () => quality.soundAlike, set: (v) => (quality.soundAlike = v) })
  }
  const byLanguage = quality?.soundAlikeByLanguage
  for (const language of byLanguage && typeof byLanguage === 'object'
    ? Object.keys(byLanguage)
    : []) {
    if (Array.isArray(byLanguage![language])) {
      lists.push({ get: () => byLanguage![language], set: (v) => (byLanguage![language] = v) })
    }
  }
  const mark = (list: number, i: number) => `\u0000group ${list}.${i}`
  const originals = lists.map((list) => list.get() as string[][])
  lists.forEach((list, n) => list.set(originals[n]!.map((_, i) => mark(n, i))))
  const oneLine = (group: string[]) => `[${group.map((w) => JSON.stringify(w)).join(', ')}]`
  const json = JSON.stringify(raw, null, indent)
  lists.forEach((list, n) => list.set(originals[n]))
  // A function, not a string, as the replacement: a "$" in a word is not a pattern.
  return originals.reduce(
    (text, groups, n) =>
      groups.reduce(
        (t, group, i) => t.replace(JSON.stringify(mark(n, i)), () => oneLine(group)),
        text,
      ),
    json,
  )
}

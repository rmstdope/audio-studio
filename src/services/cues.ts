import { dirname } from 'node:path'
import {
  WORDS_CHANGED,
  composeChecked,
  composeCued,
  normalizeCue,
  parseCued,
  wordsOf,
  withInside,
} from '../core/cued'
import { resolveInRoot } from '../core/paths'
import { problemsFrom, type Problem } from '../core/project'
import { CuesSchema } from '../core/resources'
import { readJson, writeAtomic } from './files'
import { inPartTurn } from './partFiles'
import { readPart, type ProjectFailure } from './workspace'

/** What changing a cue did, or why it did nothing. Null for an unknown part or line. */
export type CueChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/** Keys JavaScript would move to the front of an object, changing the file's order. */
const INTEGER_LIKE = /^(0|[1-9]\d*)$/

/**
 * Saves a line's own delivery cue in the part's cues file (the language's own: a language besides
 * the source follows the source's cue for a line until it has one); an empty cue removes it, so the line
 * goes back to its character's style. Nothing is written when the cue does not change.
 */
export async function setCue(
  projectFile: string,
  partId: string,
  key: string,
  cue: string,
  language?: string,
): Promise<CueChange> {
  const opening = cue.trim()
  return changeCues(projectFile, partId, [key], language, (entries, _path, _inDialog, text) => {
    const current = entries.find(([k]) => k === key)?.[1]
    // The cues inside the line stay; ones that no longer fit its words are replaced.
    const parsed = parseCued(current ?? '', text(key))
    const next = composeCued(opening, parsed.inside, text(key))
    if (current === undefined ? !next : current === next) return { entries }
    return { entries: replaceEntry(entries, key, next) }
  })
}

/** What the page sends to place, change or remove a cue inside a line. */
export interface InsideCueChange {
  /** The gap: the number of words before the cue. */
  at: number
  /** The cue as typed (brackets are added); empty removes the cue at the gap. */
  cue: string
  /** The line's words as the page showed them; a line that changed since is refused. */
  text: string
}

/**
 * Places, changes or removes the cue at one gap of a line, keeping its opening cue and its other
 * cues inside. Refused when the line's words are not the ones the page showed, or when the gap is
 * not between two words. Nothing is written when nothing changes.
 */
export async function setInsideCue(
  projectFile: string,
  partId: string,
  key: string,
  change: InsideCueChange,
  language?: string,
): Promise<CueChange> {
  const cue = normalizeCue(change.cue)
  return changeCues(projectFile, partId, [key], language, (entries, path, _inDialog, text) => {
    const refuse = (message: string) => ({ problems: [{ file: path, path: key, message }] })
    const words = text(key)
    if (wordsOf(change.text).join(' ') !== wordsOf(words).join(' ')) {
      return refuse(WORDS_CHANGED)
    }
    if (!Number.isInteger(change.at) || change.at < 1 || change.at >= wordsOf(words).length) {
      return refuse('a cue goes between two words')
    }
    const current = entries.find(([k]) => k === key)?.[1]
    const parsed = parseCued(current ?? '', words)
    const next = composeChecked(parsed.opening, withInside(parsed.inside, change.at, cue), words)
    if (next === null) {
      return refuse('this cue cannot go in this line: brackets inside a cue or in the line’s words')
    }
    if (current === undefined ? !next : current === next) return { entries }
    return { entries: replaceEntry(entries, key, next) }
  })
}

/** `entries` with the cue of `key` set (in place, or at the end); empty removes it. */
function replaceEntry(entries: Cue[], key: string, cue: string): Cue[] {
  if (!cue) return entries.filter(([k]) => k !== key)
  return entries.some(([k]) => k === key)
    ? entries.map(([k, v]): Cue => [k, k === key ? cue : v])
    : [...entries, [key, cue]]
}

/**
 * Gives an orphaned cue (its line left the dialog, usually reworded under a new key) to the line
 * `to`, in the cue's place in the file, or removes it when `to` is null. Refused for a cue whose
 * line is still in the dialog, and for a line that already has its own cue. Null for an unknown
 * part, cue or line.
 */
export async function moveCue(
  projectFile: string,
  partId: string,
  from: string,
  to: string | null,
  language?: string,
): Promise<CueChange> {
  return changeCues(
    projectFile,
    partId,
    to === null ? [] : [to],
    language,
    (entries, path, inDialog) => {
      const problem = (key: string, message: string) => ({
        problems: [{ file: path, path: key, message }],
      })
      if (!entries.some(([k]) => k === from)) return null
      if (inDialog.has(from)) return problem(from, 'this cue’s line is still in the dialog')
      if (to === null) return { entries: entries.filter(([k]) => k !== from) }
      if (entries.some(([k]) => k === to)) {
        return problem(to, 'this line has its own cue already; clear it first')
      }
      return { entries: entries.map(([k, v]): Cue => [k === from ? to : k, v]) }
    },
  )
}

/** One cue: a line key and the cue it is delivered with. */
type Cue = [key: string, cue: string]

/**
 * Changes the part's cues file in the part's turn: `change` gets its entries in file order (own
 * keys only, so `__proto__` is kept like any other key; parsing elsewhere drops it, so it is never
 * listed among orphaned cues), the file's path and the dialog's keys, and
 * gives the new entries, problems, or null (unknown). `lines` must all be in the dialog, or the
 * answer is null. The file is hand-edited too: its order is kept and it is written with two-space
 * indent, one cue per line; nothing is written when nothing changes. A broken file is reported,
 * never overwritten, and so is a number-like key (`"10"`), which JavaScript would move to the
 * front.
 */
async function changeCues(
  projectFile: string,
  partId: string,
  lines: string[],
  language: string | undefined,
  change: (
    entries: Cue[],
    path: string,
    inDialog: Set<string>,
    text: (key: string) => string,
  ) => { entries: Cue[] } | { problems: Problem[] } | null,
): Promise<CueChange> {
  const read = await readPart(projectFile, partId, language)
  if (!read || !read.ok) return read
  const inDialog = new Set(read.input.lines.map((line) => line.key))
  const textOf = (key: string) => read.input.lines.find((l) => l.key === key)?.text ?? ''
  if (!lines.every((key) => inDialog.has(key))) return null
  if (read.input.held) {
    // Nothing is orphaned while the dialog is unreadable or gone, so no cue moves or goes.
    const message =
      'the dialog cannot be read or is gone; cues are kept as they are until it is back'
    return { ok: false, problems: [{ file: read.paths.cuesPath, path: '', message }] }
  }
  const root = dirname(projectFile)
  const path = read.paths.cuesPath

  return inPartTurn(projectFile, partId, async (): Promise<CueChange> => {
    const json = await readJson(resolveInRoot(root, path))
    if (json.status === 'invalid') {
      return { ok: false, problems: [{ file: path, path: '', message: json.message }] }
    }
    const raw = json.status === 'missing' ? {} : json.value
    const parsed = CuesSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, problems: problemsFrom(path, parsed.error) }
    const entries = Object.entries(raw as Record<string, string>)

    const outcome = change(entries, path, inDialog, textOf)
    if (outcome === null) return null
    if ('problems' in outcome) return { ok: false, problems: outcome.problems }
    const changed = outcome.entries
    if (sameEntries(changed, entries)) return { ok: true }
    const moved = changed.map(([k]) => k).filter((k) => INTEGER_LIKE.test(k))
    if (moved.length && changed.length > 1) {
      const message =
        `the cue of ${moved.map((k) => `"${k}"`).join(', ')} would move to the top if the studio ` +
        'wrote this file; edit the file by hand.'
      return { ok: false, problems: [{ file: path, path: moved[0]!, message }] }
    }
    await writeAtomic(root, path, formatCues(changed))
    return { ok: true }
  })
}

function sameEntries(a: Cue[], b: Cue[]): boolean {
  return a.length === b.length && a.every(([k, v], i) => k === b[i]![0] && v === b[i]![1])
}

/** The cues file's text: two-space indent, one cue per line, in the order given. */
function formatCues(entries: [string, string][]): string {
  if (!entries.length) return '{}\n'
  const lines = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  return `{\n${lines.join(',\n')}\n}\n`
}

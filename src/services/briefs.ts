import { dirname } from 'node:path'
import {
  BriefsSchema,
  MAX_STINGER_SECONDS,
  applyBriefChange,
  staleIds,
  trackFor,
  type BriefChange,
  type BriefField,
  type BriefValue,
  type Briefs,
  type MusicSummary,
} from '../core/music'
import type { MusicConfig, Problem } from '../core/project'
import { resolveInRoot } from '../core/paths'
import { formatEntriesPerLine, listFiles, readResource, writeAtomic } from './files'
import { readChosen } from './musicClips'
import { readMusic } from './musicLists'
import { boardQueue, deleteBoard, MUSIC_BOARD_DIR } from './musicTakes'
import { createSerial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** What saving a change to a track's brief answered; null for a track the project does not list. */
export type BriefChangeResult =
  { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/** Saves one at a time per project: each reads the briefs file the one before wrote. */
const serial = createSerial()

/**
 * Saves one field of a track's brief, length, tempo or key in `briefs.json` (the studio's changes
 * over the game's values; the game's lists are never written). A value the game already has takes
 * the change back. A briefs file that cannot be read is reported and left as it is.
 */
export function setTrackBrief(
  projectFile: string,
  id: string,
  change: BriefChange,
): Promise<BriefChangeResult> {
  return serial.run(projectFile, () => save(projectFile, id, change))
}

async function save(
  projectFile: string,
  id: string,
  change: BriefChange,
): Promise<BriefChangeResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { project } = opened
  const root = dirname(projectFile)
  if (!project.music) return null
  const file = project.music.paths.briefs
  const summary = await readMusic(root, project, [])
  const found = trackFor(summary?.lists ?? [], id)
  if (!found) return null

  const [field, raw] = Object.entries(change)[0] as [BriefField, BriefValue]
  const value = typeof raw === 'string' ? raw.trim() : raw
  const refused = refusal(field, value, found.list.kind)
  if (refused) return { ok: false, problems: [{ file, path: `${id}.${field}`, message: refused }] }

  const problems: Problem[] = []
  const briefs = await readResource(root, file, BriefsSchema, problems)
  if (briefs === 'invalid') return { ok: false, problems }
  const changed = applyBriefChange(
    briefs === 'missing' ? {} : briefs,
    id,
    field,
    value === '' ? null : value,
    found.track.game,
  )
  const stale = new Set(await dropStale(projectFile, root, project.music, summary!, changed))
  const next = Object.fromEntries(Object.entries(changed).filter(([key]) => !stale.has(key)))
  await writeAtomic(root, file, formatEntriesPerLine(next))
  return { ok: true }
}

/**
 * Deletes the boards and takes of tracks never chosen that the game no longer lists, and says
 * which ids (with those in `briefs`) are such, so the caller drops their brief changes. Done at a
 * save of the briefs; nothing while a list is missing or the lock cannot be read.
 */
async function dropStale(
  projectFile: string,
  root: string,
  music: MusicConfig,
  summary: MusicSummary,
  briefs: Briefs,
): Promise<string[]> {
  const problems: Problem[] = []
  const chosen = await readChosen(root, music, problems)
  if (!chosen || problems.length) return []
  const boards = [...(await listFiles(resolveInRoot(root, MUSIC_BOARD_DIR)))]
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
  const stale = staleIds(
    summary,
    [...new Set([...Object.keys(briefs), ...boards])],
    Object.keys(chosen),
  )
  for (const id of stale) {
    await boardQueue().run(`${projectFile}\0${id}`, () => deleteBoard(root, id))
  }
  return stale
}

/** Takes the studio's changes for these tracks out of the briefs file; nothing is written if none is there. */
export function forgetBriefs(
  projectFile: string,
  root: string,
  file: string,
  ids: string[],
): Promise<{ ok: true } | { ok: false; problems: Problem[] }> {
  return serial.run(projectFile, async () => {
    const problems: Problem[] = []
    const briefs = await readResource(root, file, BriefsSchema, problems)
    if (briefs === 'invalid') return { ok: false, problems }
    if (briefs !== 'missing' && ids.some((id) => id in briefs)) {
      const next = Object.fromEntries(Object.entries(briefs).filter(([key]) => !ids.includes(key)))
      await writeAtomic(root, file, formatEntriesPerLine(next))
    }
    return { ok: true }
  })
}

/** Why a value cannot be saved, or null. */
function refusal(field: BriefField, value: BriefValue, kind: 'act' | 'stingers'): string | null {
  if (field === 'brief' && value === '') return 'a brief cannot be empty'
  if (field === 'seconds' && kind === 'stingers' && (value as number) > MAX_STINGER_SECONDS) {
    return `a stinger is at most ${MAX_STINGER_SECONDS} seconds`
  }
  return null
}

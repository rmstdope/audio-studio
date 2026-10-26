import { dirname } from 'node:path'
import {
  BriefsSchema,
  MAX_STINGER_SECONDS,
  applyBriefChange,
  trackFor,
  type BriefChange,
  type BriefField,
  type BriefValue,
} from '../core/music'
import type { Problem } from '../core/project'
import { formatEntriesPerLine, readResource, writeAtomic } from './files'
import { readMusic } from './musicLists'
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
  const file = project.music?.paths.briefs
  if (!project.music || !file) return null
  const found = trackFor((await readMusic(root, project, []))?.lists ?? [], id)
  if (!found) return null

  const [field, raw] = Object.entries(change)[0] as [BriefField, BriefValue]
  const value = typeof raw === 'string' ? raw.trim() : raw
  const refused = refusal(field, value, found.list.kind)
  if (refused) return { ok: false, problems: [{ file, path: `${id}.${field}`, message: refused }] }

  const problems: Problem[] = []
  const briefs = await readResource(root, file, BriefsSchema, problems)
  if (briefs === 'invalid') return { ok: false, problems }
  const next = applyBriefChange(
    briefs === 'missing' ? {} : briefs,
    id,
    field,
    value === '' ? null : value,
    found.track.game,
  )
  await writeAtomic(root, file, formatEntriesPerLine(next))
  return { ok: true }
}

/** Why a value cannot be saved, or null. */
function refusal(field: BriefField, value: BriefValue, kind: 'act' | 'stingers'): string | null {
  if (field === 'brief' && value === '') return 'a brief cannot be empty'
  if (field === 'seconds' && kind === 'stingers' && (value as number) > MAX_STINGER_SECONDS) {
    return `a stinger is at most ${MAX_STINGER_SECONDS} seconds`
  }
  return null
}

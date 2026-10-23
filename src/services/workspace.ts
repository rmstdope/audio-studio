import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveInRoot } from '../core/paths'
import { adoptUntracked, planPart, type PartState, type PlanInput } from '../core/planner'
import {
  PROJECT_FILE,
  ProjectSchema,
  partPathFor,
  problemsFrom,
  type Part,
  type Problem,
  type Project,
} from '../core/project'
import {
  CastSchema,
  CuesSchema,
  DialogSchema,
  LockSchema,
  ManifestSchema,
  type Cast,
} from '../core/resources'
import { summarize, type DialogState, type ProjectSummary } from '../core/summary'
import { formatEntriesPerLine, listFiles, readJson, readResource, writeAtomic } from './files'

/** The project file in `start` or the nearest directory above it that has one; null if none. */
export function findProjectFile(start: string): string | null {
  let dir = start
  for (;;) {
    const candidate = join(dir, PROJECT_FILE)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Why the project file itself could not be used. */
export interface ProjectFailure {
  ok: false
  file: string
  problems: Problem[]
}

/** The project summary, or why the project file could not be used. */
export type LoadResult = { ok: true; summary: ProjectSummary } | ProjectFailure

/**
 * Reads the project file and every resource it names, fresh from disk. Problems in a resource
 * are reported alongside the summary; only a broken project file stops the load.
 */
export async function loadProject(projectFile: string): Promise<LoadResult> {
  const root = dirname(projectFile)
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { project } = opened
  const problems: Problem[] = []

  const cast = await readCast(root, project, problems)
  const dialogs: Record<string, DialogState> = {}
  for (const part of project.narration.parts) {
    dialogs[part.id] = await readDialog(root, project, part, problems)
  }
  return { ok: true, summary: summarize({ project, root, dialogs, cast, problems }) }
}

/** One part with the state of every clip in it. */
export interface PartDetail extends PartState {
  id: string
  title: string
  dialog: DialogState['status']
  dialogPath: string
  clipsPath: string
  lockPath: string
  problems: Problem[]
}

/** A part's detail, why the project file could not be used, or null for an unknown part. */
export type PartResult = { ok: true; part: PartDetail } | ProjectFailure | null

/** Reads a part's dialog, cues, lock, manifest and clips folder, and plans every line. */
export async function loadPart(projectFile: string, partId: string): Promise<PartResult> {
  const read = await readPart(projectFile, partId)
  if (!read || !read.ok) return read
  const { project, part, input, dialog, problems } = read
  const paths = project.narration.paths
  return {
    ok: true,
    part: {
      id: part.id,
      title: part.title,
      dialog: dialog.status,
      dialogPath: partPathFor(paths.dialog, part.id),
      clipsPath: partPathFor(paths.clips, part.id),
      lockPath: partPathFor(paths.lock, part.id),
      problems,
      ...planPart(input),
    },
  }
}

/** What adopting a part's clips did, or why it did nothing. */
export type AdoptResult =
  | { ok: true; adopted: number; lockPath: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/**
 * Takes every clip of a part that nothing knows the inputs of as made from today's inputs, and
 * writes the lock. Refuses while any of the part's files has a problem, since a broken cast or
 * lock would make it record the wrong inputs or drop entries.
 */
export async function adoptPart(
  projectFile: string,
  partId: string,
  now: Date = new Date(),
): Promise<AdoptResult> {
  const read = await readPart(projectFile, partId)
  if (!read || !read.ok) return read
  if (read.problems.length) return { ok: false, problems: read.problems }
  const { lock, adopted } = adoptUntracked(read.input, now.toISOString())
  const lockPath = partPathFor(read.project.narration.paths.lock, partId)
  if (adopted) await writeAtomic(dirname(projectFile), lockPath, formatEntriesPerLine(lock))
  return { ok: true, adopted, lockPath }
}

/** The absolute path of a clip in a part's clips folder, or null if the part or file is unknown. */
export async function clipFile(
  projectFile: string,
  partId: string,
  file: string,
): Promise<string | null> {
  if (!/^[\w.-]+$/.test(file) || file.startsWith('.')) return null
  const opened = await openProject(projectFile)
  if (!opened.ok) return null
  const { narration } = opened.project
  if (!narration.parts.some((p) => p.id === partId)) return null
  const path = resolveInRoot(dirname(projectFile), partPathFor(narration.paths.clips, partId))
  const full = join(path, file)
  return existsSync(full) ? full : null
}

async function readPart(projectFile: string, partId: string) {
  const root = dirname(projectFile)
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { project } = opened
  const part = project.narration.parts.find((p) => p.id === partId)
  if (!part) return null

  const problems: Problem[] = []
  const paths = project.narration.paths
  const at = (template: string) => partPathFor(template, part.id)
  const orEmpty = <T>(value: T | 'missing' | 'invalid', empty: T): T =>
    value === 'missing' || value === 'invalid' ? empty : value

  const dialog = await readDialog(root, project, part, problems)
  const cast = await readCast(root, project, problems)
  const cues = orEmpty(await readResource(root, at(paths.cues), CuesSchema, problems), {})
  const lock = orEmpty(await readResource(root, at(paths.lock), LockSchema, problems), {})
  const manifest = orEmpty(
    await readResource(root, at(paths.manifest), ManifestSchema, problems),
    {},
  )
  const files = await listFiles(resolveInRoot(root, at(paths.clips)))

  const input: PlanInput = {
    lines: dialog.status === 'ok' ? dialog.lines : [],
    cast: cast ?? { speakers: {}, pronounce: {} },
    cues,
    lock,
    manifest,
    files,
    narration: project.narration,
  }
  return { ok: true as const, project, part, dialog, input, problems }
}

async function readCast(root: string, project: Project, problems: Problem[]): Promise<Cast | null> {
  const cast = await readResource(root, project.narration.characters, CastSchema, problems)
  return cast === 'missing' || cast === 'invalid' ? null : cast
}

async function readDialog(
  root: string,
  project: Project,
  part: Part,
  problems: Problem[],
): Promise<DialogState> {
  const path = partPathFor(project.narration.paths.dialog, part.id)
  const read = await readResource(root, path, DialogSchema, problems)
  return read === 'missing' || read === 'invalid' ? { status: read } : { status: 'ok', lines: read }
}

async function openProject(
  projectFile: string,
): Promise<{ ok: true; project: Project } | ProjectFailure> {
  const root = dirname(projectFile)
  const file = PROJECT_FILE
  const json = await readJson(projectFile)
  if (json.status === 'missing') {
    return { ok: false, file, problems: [{ file, path: '', message: 'the file is gone' }] }
  }
  if (json.status === 'invalid') {
    return { ok: false, file, problems: [{ file, path: '', message: json.message }] }
  }
  const parsed = ProjectSchema.safeParse(json.value)
  if (!parsed.success) return { ok: false, file, problems: problemsFrom(file, parsed.error) }

  const outside = projectPaths(parsed.data).flatMap(([path, value]) => {
    try {
      resolveInRoot(root, value)
      return []
    } catch {
      return [{ file, path, message: `${value} is outside the project folder` }]
    }
  })
  if (outside.length) return { ok: false, file, problems: outside }
  return { ok: true, project: parsed.data }
}

/** Every path the project file names, with its JSON path, for the outside-the-root check. */
function projectPaths(project: Project): [string, string][] {
  const { narration } = project
  const paths: [string, string][] = [
    ['env', project.env],
    ['narration.characters', narration.characters],
  ]
  for (const [name, template] of Object.entries(narration.paths)) {
    for (const part of narration.parts) {
      paths.push([`narration.paths.${name}`, partPathFor(template, part.id)])
    }
  }
  return paths
}

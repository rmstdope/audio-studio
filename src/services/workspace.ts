import { statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
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
import { inPartTurn } from './partFiles'

/** The project file in `start` or the nearest directory above it that has one; null if none. */
export function findProjectFile(start: string): string | null {
  let dir = start
  for (;;) {
    const candidate = join(dir, PROJECT_FILE)
    if (isFile(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Why `path` cannot be used as a project file, or null if it can. */
export function projectFileProblem(path: string): string | null {
  try {
    if (statSync(path).isDirectory()) return `${path} is a folder, not a project file.`
    return null
  } catch {
    return `${path} does not exist.`
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
  const loaded = await loadWorkspace(projectFile)
  return loaded.ok ? { ok: true, summary: loaded.summary } : loaded
}

/** True if the project has the character (in the cast or speaking in a part); null if not. */
export async function knownCharacter(
  projectFile: string,
  characterId: string,
): Promise<true | ProjectFailure | null> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  return loaded.summary.characters.some((c) => c.id === characterId) ? true : null
}

/** The parsed project file, the cast and the summary of the project, for the server's own use. */
export async function loadWorkspace(projectFile: string): Promise<
  | {
      ok: true
      project: Project
      /** The cast; null when it is broken (the summary's problems say why). */
      cast: Cast | null
      summary: ProjectSummary
    }
  | ProjectFailure
> {
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
  return {
    ok: true,
    project,
    cast,
    summary: summarize({ project, root, dialogs, cast, problems }),
  }
}

/** One part with the state of every clip in it. */
export interface PartDetail extends PartState {
  id: string
  title: string
  dialog: DialogState['status']
  dialogPath: string
  clipsPath: string
  lockPath: string
  manifestPath: string
  /** The share of words a take must be heard at to count as good (the project's `minHeard`). */
  minHeard: number
  /** The model everyday plans record with (the project's draft stage). */
  draftModel: string
  /** The model of the final recording; the same as the draft one when there is no final step. */
  finalModel: string
  problems: Problem[]
}

/** A part's detail, why the project file could not be used, or null for an unknown part. */
export type PartResult = { ok: true; part: PartDetail } | ProjectFailure | null

/** Reads a part's dialog, cues, lock, manifest and clips folder, and plans every line. */
export async function loadPart(projectFile: string, partId: string): Promise<PartResult> {
  const read = await readPart(projectFile, partId)
  if (!read || !read.ok) return read
  const { project, part, input, dialog, problems } = read
  return {
    ok: true,
    part: {
      id: part.id,
      title: part.title,
      dialog: dialog.status,
      ...read.paths,
      minHeard: project.narration.quality.minHeard,
      draftModel: project.narration.models.draft,
      finalModel: project.narration.models.final,
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
  // In the part's turn, reading the part afresh: a line recorded meanwhile keeps its lock entry.
  return inPartTurn(projectFile, partId, async () => {
    const read = await readPart(projectFile, partId)
    if (!read || !read.ok) return read
    if (read.problems.length) return { ok: false, problems: read.problems }
    const { lock, adopted } = adoptUntracked(read.input, now.toISOString())
    const { lockPath } = read.paths
    if (adopted) await writeAtomic(dirname(projectFile), lockPath, formatEntriesPerLine(lock))
    return { ok: true, adopted, lockPath }
  })
}

/**
 * The absolute path of a clip in a part's clips folder, or null if the part is unknown or the
 * name is not a plain file there. Folders, symbolic links and hidden files are never served; the
 * planner never counts the first two as clips either.
 */
export async function clipFile(
  projectFile: string,
  partId: string,
  file: string,
): Promise<string | null> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return null
  const { narration } = opened.project
  if (!narration.parts.some((p) => p.id === partId) || file.startsWith('.')) return null
  const folder = resolveInRoot(dirname(projectFile), partPathFor(narration.paths.clips, partId))
  return (await listFiles(folder)).has(file) ? join(folder, file) : null
}

/** Everything read about a part, for planning it or acting on it. */
export interface PartRead {
  ok: true
  project: Project
  part: Part
  dialog: DialogState
  input: PlanInput
  paths: {
    dialogPath: string
    cuesPath: string
    clipsPath: string
    lockPath: string
    manifestPath: string
  }
  problems: Problem[]
}

/** A part's files, read and validated, or why the project file cannot be used; null for an unknown part. */
export async function readPart(
  projectFile: string,
  partId: string,
): Promise<PartRead | ProjectFailure | null> {
  const root = dirname(projectFile)
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { project } = opened
  const part = project.narration.parts.find((p) => p.id === partId)
  if (!part) return null

  const problems: Problem[] = []
  const templates = project.narration.paths
  const at = (template: string) => partPathFor(template, part.id)

  const dialog = await readDialog(root, project, part, problems)
  const cast = await readCast(root, project, problems)
  const cues = usable(await readResource(root, at(templates.cues), CuesSchema, problems))
  const lock = usable(await readResource(root, at(templates.lock), LockSchema, problems))
  const manifest = usable(
    await readResource(root, at(templates.manifest), ManifestSchema, problems),
  )
  const files = await listFiles(resolveInRoot(root, at(templates.clips)))

  return {
    ok: true,
    project,
    part,
    dialog,
    input: {
      lines: dialog.status === 'ok' ? dialog.lines : [],
      cast: cast ?? { speakers: {}, pronounce: {} },
      cues: cues ?? {},
      lock: lock ?? {},
      manifest: manifest ?? {},
      files,
      narration: project.narration,
    },
    paths: {
      dialogPath: at(templates.dialog),
      cuesPath: at(templates.cues),
      clipsPath: at(templates.clips),
      lockPath: at(templates.lock),
      manifestPath: at(templates.manifest),
    },
    problems,
  }
}

/** A resource read's value, or null when there is no file or it is broken (already a problem). */
function usable<T>(read: T | 'missing' | 'invalid'): T | null {
  return read === 'missing' || read === 'invalid' ? null : read
}

/** The project's cast: empty if there is none yet, null (with the problem added) if it is broken. */
async function readCast(root: string, project: Project, problems: Problem[]): Promise<Cast | null> {
  const read = await readResource(root, project.narration.characters, CastSchema, problems)
  if (read === 'invalid') return null
  return read === 'missing' ? { speakers: {}, pronounce: {} } : read
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

/** The validated project file, or why it cannot be used. */
export async function openProject(
  projectFile: string,
): Promise<{ ok: true; project: Project } | ProjectFailure> {
  const root = dirname(projectFile)
  const file = basename(projectFile)
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

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

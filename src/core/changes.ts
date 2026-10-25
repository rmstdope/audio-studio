import { posix } from 'node:path'
import { partPathFor, type Project } from './project'

/** How git sees a changed file; a conflict is a merge left to resolve before committing. */
export type ChangeKind = 'new' | 'modified' | 'deleted' | 'renamed' | 'conflict'

/** One changed file, by its path from the project root. */
export interface Change {
  path: string
  change: ChangeKind
  /** Where a renamed file was. */
  from?: string
}

/** What a part's file is for. */
export type FileRole = 'dialog' | 'cues' | 'lock' | 'manifest'

/** A part's changes: its own files one by one, its clips counted. */
export interface PartChanges {
  id: string
  title: string
  files: (Change & { role: FileRole })[]
  clips: Record<ChangeKind, number>
}

/** The project's changes, grouped as the user commits them. */
export interface ChangeGroups {
  total: number
  /** The project file and the cast. */
  project: Change[]
  parts: PartChanges[]
}

/** A part's files by path (with their role) and its clips folders, one per language (ending in `/`). */
export interface PartPaths {
  id: string
  title: string
  files: Record<string, FileRole>
  clips: string[]
}

/** Every path the studio writes, from the project root, normalised as git writes them. */
export interface ProjectPaths {
  /** The project file and the cast. */
  own: string[]
  parts: PartPaths[]
}

/** A path from the project file as git writes it: no `./`, no doubled or trailing slashes. */
function normal(path: string): string {
  return posix.normalize(path).replace(/^\.\//, '').replace(/\/+$/, '')
}

/** The paths the studio reads and writes for a project: what git is asked about, and grouped by. */
export function projectPaths(project: Project, projectPath: string): ProjectPaths {
  const { narration } = project
  return {
    own: [normal(projectPath), normal(narration.characters)],
    parts: narration.parts.map((part) => {
      const at = (template: string, language: string) =>
        normal(partPathFor(template, part.id, language))
      return {
        id: part.id,
        title: part.title,
        files: Object.fromEntries(
          narration.languages.flatMap((language) => [
            [at(narration.paths.dialog, language), 'dialog'],
            [at(narration.paths.cues, language), 'cues'],
            [at(narration.paths.lock, language), 'lock'],
            [at(narration.paths.manifest, language), 'manifest'],
          ]),
        ),
        clips: narration.languages.map((language) => `${at(narration.paths.clips, language)}/`),
      }
    }),
  }
}

/**
 * The changes in `git status --porcelain=v1 -z` output: two status letters, a space and the
 * path, separated by NULs; a rename or copy is followed by the path it came from. Paths are from
 * the repository's top, so `prefix` (the project root's place in it, `git rev-parse
 * --show-prefix`) is taken off. A copy counts as new: its source is still there.
 */
export function parsePorcelain(text: string, prefix = ''): Change[] {
  const fields = text.split('\0')
  const changes: Change[] = []
  const local = (path: string) => (path.startsWith(prefix) ? path.slice(prefix.length) : path)
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    if (field.length < 4) continue
    const [x, y] = [field[0]!, field[1]!]
    const path = local(field.slice(3))
    const code = x + y
    if (x === 'R' || x === 'C') {
      const from = local(fields[++i] ?? '')
      changes.push(x === 'R' ? { path, change: 'renamed', from } : { path, change: 'new' })
    } else if (code.includes('U') || code === 'AA' || code === 'DD') {
      changes.push({ path, change: 'conflict' })
    } else if (code.includes('D')) {
      changes.push({ path, change: 'deleted' })
    } else if (code === '??' || x === 'A') {
      changes.push({ path, change: 'new' })
    } else {
      changes.push({ path, change: 'modified' })
    }
  }
  return changes
}

/**
 * The changes grouped by what they belong to: the project file and the cast, then each part's
 * dialog, cues, lock and manifest, and its clips (`.mp3`) counted by kind. Parts without changes
 * are left out; a path that belongs nowhere is not counted.
 */
export function groupChanges(
  project: Project,
  projectPath: string,
  changes: Change[],
): ChangeGroups {
  const paths = projectPaths(project, projectPath)
  const own = new Set(paths.own)
  const projectChanges = changes.filter((c) => own.has(c.path))
  let total = projectChanges.length

  const parts = paths.parts.flatMap((part): PartChanges[] => {
    const files: PartChanges['files'] = []
    const clips: Record<ChangeKind, number> = {
      new: 0,
      modified: 0,
      deleted: 0,
      renamed: 0,
      conflict: 0,
    }
    for (const change of changes) {
      const role = Object.hasOwn(part.files, change.path) ? part.files[change.path] : undefined
      if (role) files.push({ ...change, role })
      else if (
        part.clips.some((folder) => change.path.startsWith(folder)) &&
        change.path.endsWith('.mp3')
      ) {
        clips[change.change]++
      }
    }
    const count = files.length + Object.values(clips).reduce((a, b) => a + b, 0)
    total += count
    return count ? [{ id: part.id, title: part.title, files, clips }] : []
  })
  return { total, project: projectChanges, parts }
}

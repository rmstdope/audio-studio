import { partPathFor, type Project } from './project'

/** How git sees a changed file. */
export type ChangeKind = 'new' | 'modified' | 'deleted' | 'renamed'

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

/**
 * The changes in `git status --porcelain=v1 -z` output: two status letters, a space and the
 * path, separated by NULs; a rename or copy is followed by the path it came from.
 */
export function parsePorcelain(text: string): Change[] {
  const fields = text.split('\0')
  const changes: Change[] = []
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    if (field.length < 4) continue
    const code = field.slice(0, 2)
    const path = field.slice(3)
    if (code.includes('R') || code.includes('C')) {
      changes.push({ path, change: 'renamed', from: fields[++i] ?? '' })
    } else if (code === '??' || code.includes('A')) {
      changes.push({ path, change: 'new' })
    } else if (code.includes('D')) {
      changes.push({ path, change: 'deleted' })
    } else {
      changes.push({ path, change: 'modified' })
    }
  }
  return changes
}

/**
 * The changes grouped by what they belong to: the project file and the cast, then each part's
 * dialog, cues, lock and manifest, and its clips counted by kind. Parts without changes are left
 * out; a path that belongs nowhere is not counted.
 */
export function groupChanges(
  project: Project,
  projectPath: string,
  changes: Change[],
): ChangeGroups {
  const { narration } = project
  const own = new Set([projectPath, narration.characters])
  const projectChanges = changes.filter((c) => own.has(c.path))
  let total = projectChanges.length

  const parts = narration.parts.flatMap((part): PartChanges[] => {
    const at = (template: string) => partPathFor(template, part.id)
    const roles = new Map<string, FileRole>([
      [at(narration.paths.dialog), 'dialog'],
      [at(narration.paths.cues), 'cues'],
      [at(narration.paths.lock), 'lock'],
      [at(narration.paths.manifest), 'manifest'],
    ])
    const clipsDir = `${at(narration.paths.clips).replace(/\/+$/, '')}/`
    const files: PartChanges['files'] = []
    const clips: Record<ChangeKind, number> = { new: 0, modified: 0, deleted: 0, renamed: 0 }
    for (const change of changes) {
      const role = roles.get(change.path)
      if (role) files.push({ ...change, role })
      else if (change.path.startsWith(clipsDir) && change.path.endsWith('.mp3'))
        clips[change.change]++
    }
    const count = files.length + Object.values(clips).reduce((a, b) => a + b, 0)
    total += count
    return count ? [{ id: part.id, title: part.title, files, clips }] : []
  })
  return { total, project: projectChanges, parts }
}

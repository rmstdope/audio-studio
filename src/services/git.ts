import { basename, dirname } from 'node:path'
import { groupChanges, parsePorcelain, type ChangeGroups } from '../core/changes'
import { partPathFor } from '../core/project'
import { openProject, type ProjectFailure } from './workspace'

/** The project's uncommitted changes, or why they cannot be read. */
export type ChangesResult =
  | { ok: true; groups: ChangeGroups }
  | { ok: false; reason: 'no-git' | 'git'; message: string }
  | ProjectFailure

/**
 * What would be committed: `git status` for the project's own files only (the project file, the
 * cast, and each part's dialog, cues, lock, manifest and clips), grouped. Only reads: the studio
 * never changes the repository.
 */
export async function gitChanges(projectFile: string): Promise<ChangesResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const root = dirname(projectFile)
  const { narration } = opened.project

  // git gives paths from the repository's top; the project may sit in a folder of it.
  const prefix = await run(root, ['rev-parse', '--show-prefix'])
  if (!prefix.ok) {
    return { ok: false, reason: 'no-git', message: 'The project is not in a git repository.' }
  }
  const top = prefix.text.trim()

  const projectPath = basename(projectFile)
  const paths = [
    projectPath,
    narration.characters,
    ...narration.parts.flatMap((part) =>
      [
        narration.paths.dialog,
        narration.paths.cues,
        narration.paths.lock,
        narration.paths.manifest,
        narration.paths.clips,
      ].map((template) => partPathFor(template, part.id)),
    ),
  ]
  const status = await run(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    ...new Set(paths.map((path) => `:(literal)${path}`)),
  ])
  if (!status.ok) return { ok: false, reason: 'git', message: status.text }
  const changes = parsePorcelain(status.text).map((change) => ({
    ...change,
    path: change.path.slice(top.length),
    ...(change.from === undefined ? {} : { from: change.from.slice(top.length) }),
  }))
  return { ok: true, groups: groupChanges(opened.project, projectPath, changes) }
}

/** Runs a read-only git command in `cwd`: its output, or its error. */
async function run(cwd: string, args: string[]): Promise<{ ok: boolean; text: string }> {
  try {
    const child = Bun.spawn(['git', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      timeout: 30_000,
    })
    const [text, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return code === 0
      ? { ok: true, text }
      : { ok: false, text: error.trim() || `exit code ${code}` }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) }
  }
}

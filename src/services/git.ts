import { basename, dirname } from 'node:path'
import { groupChanges, parsePorcelain, projectPaths, type ChangeGroups } from '../core/changes'
import { openProject, type ProjectFailure } from './workspace'

/** The project's uncommitted changes, or why they cannot be read. */
export type ChangesResult =
  | { ok: true; groups: ChangeGroups }
  | { ok: false; reason: 'no-git' | 'git'; message: string }
  | ProjectFailure

/**
 * What would be committed: `git status` for the project's own files only (the project file, the
 * cast, and each part's dialog, cues, lock, manifest and clips), grouped. Only reads: the studio
 * never changes the repository. `git` replaces the command (tests).
 */
export async function gitChanges(
  projectFile: string,
  { git = 'git' }: { git?: string } = {},
): Promise<ChangesResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const root = dirname(projectFile)

  // git gives paths from the repository's top; the project may sit in a folder of it.
  const prefix = await run(git, root, ['rev-parse', '--show-prefix'])
  if (!prefix.ok) {
    return /not a git repository/i.test(prefix.text)
      ? { ok: false, reason: 'no-git', message: 'The project is not in a git repository.' }
      : { ok: false, reason: 'git', message: prefix.text }
  }

  const projectPath = basename(projectFile)
  const paths = projectPaths(opened.project, projectPath)
  const pathspecs = [
    ...paths.own,
    ...paths.parts.flatMap((part) => [...Object.keys(part.files), ...part.clips]),
  ]
  const status = await run(git, root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    ...new Set(pathspecs.map((path) => `:(literal)${path}`)),
  ])
  if (!status.ok) return { ok: false, reason: 'git', message: status.text }
  const changes = parsePorcelain(status.text, prefix.text.replace(/\n$/, ''))
  return { ok: true, groups: groupChanges(opened.project, projectPath, changes) }
}

/**
 * The environment for git: the studio's own, without what would point git at another repository
 * or index than the project's, and without optional locks, so a status never writes the index.
 */
function gitEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete env[name]
  return env
}

/** Runs a read-only git command in `cwd`: its output, or its error. */
async function run(
  git: string,
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; text: string }> {
  let child
  try {
    child = Bun.spawn([git, ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: gitEnv(),
      timeout: 30_000,
    })
  } catch {
    return { ok: false, text: `git could not be run (${git}); is it installed?` }
  }
  const [text, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return code === 0 ? { ok: true, text } : { ok: false, text: error.trim() || `exit code ${code}` }
}

import {
  BriefsSchema,
  LoopListSchema,
  StingerListSchema,
  summarizeMusic,
  type Briefs,
  type MusicListInput,
  type MusicListState,
  type MusicSummary,
} from '../core/music'
import { lstat, realpath } from 'node:fs/promises'
import { relative, isAbsolute } from 'node:path'
import { resolveInRoot } from '../core/paths'
import { partPathFor, type Problem, type Project } from '../core/project'
import { readResource } from './files'
import { readChosen } from './musicClips'

/** The path of an act's loops list. */
export function loopsPath(project: Project, partId: string): string | null {
  return project.music ? partPathFor(project.music.paths.loops, partId) : null
}

/**
 * The Music pages of a project: each act's loops, the stingers and the studio's changes to the
 * briefs, read fresh from disk. Null without a `music` section. Broken files are added to
 * `problems` with their file and JSON path, and their list is left out; a missing list is not a
 * problem, the game has not written it yet.
 */
export async function readMusic(
  root: string,
  project: Project,
  problems: Problem[],
): Promise<MusicSummary | null> {
  const { music, narration } = project
  if (!music) return null
  const lists: MusicListInput[] = []
  for (const part of narration.parts) {
    const file = partPathFor(music.paths.loops, part.id)
    lists.push({
      id: part.id,
      kind: 'act',
      title: part.title,
      file,
      state: await readList(root, file, LoopListSchema, problems),
      canRefresh: Boolean(narration.refreshDialog),
    })
  }
  lists.push({
    id: 'stingers',
    kind: 'stingers',
    title: 'Stingers',
    file: music.paths.stingers,
    state: await readList(root, music.paths.stingers, StingerListSchema, problems),
    canRefresh: Boolean(music.refreshShared),
  })
  const briefs = await readResource(root, music.paths.briefs, BriefsSchema, problems)
  const shown: Briefs = briefs === 'missing' || briefs === 'invalid' ? {} : briefs
  const gameFiles = await presentGameFiles(root, lists)
  const summary = summarizeMusic(lists, shown, await readChosen(root, music, problems), gameFiles)
  problems.push(...summary.problems)
  return summary.music
}

/** One track list as `MusicListState`. */
export async function readList(
  root: string,
  path: string,
  schema: typeof LoopListSchema | typeof StingerListSchema,
  problems: Problem[],
): Promise<MusicListState> {
  const read = await readResource(root, path, schema, problems)
  return read === 'missing' || read === 'invalid'
    ? { status: read }
    : { status: 'ok', tracks: read }
}

/**
 * The path of a music file the game names, when it is a plain file inside the project root (a
 * folder, a link or a path outside the root is not one); null otherwise. Only looked at, never
 * written.
 */
export async function gameFilePath(root: string, file: string): Promise<string | null> {
  try {
    const full = resolveInRoot(root, file)
    if (!(await lstat(full)).isFile()) return null
    // A linked folder on the way must not lead out of the root.
    const real = relative(await realpath(root), await realpath(full))
    return real.startsWith('..') || isAbsolute(real) ? null : full
  } catch {
    return null
  }
}

/** Whether the file each listed track names is there, by track id. */
async function presentGameFiles(
  root: string,
  lists: MusicListInput[],
): Promise<Record<string, boolean>> {
  const found: Record<string, boolean> = {}
  for (const list of lists) {
    if (list.state.status !== 'ok') continue
    for (const track of list.state.tracks) {
      if (track.file) found[track.id] = (await gameFilePath(root, track.file)) !== null
    }
  }
  return found
}

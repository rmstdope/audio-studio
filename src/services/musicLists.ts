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
  const summary = summarizeMusic(lists, shown, await readChosen(root, music, problems))
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

import type { EffectsSummary } from '../core/effects'
import type { MusicSummary } from '../core/music'
import { resolveInRoot } from '../core/paths'
import { partPathFor, type Problem, type Project } from '../core/project'
import {
  readSceneDeclarations,
  readSceneMix,
  summarizeScenes,
  type DeclarationsState,
  type MixState,
  type ScenesSummary,
} from '../core/scenes'
import { readJson } from './files'

/** An act's declarations at `path`: what the game wrote, entry by entry. Problems join `problems`. */
async function readDeclarations(
  root: string,
  path: string,
  problems: Problem[],
): Promise<DeclarationsState> {
  const json = await readJson(resolveInRoot(root, path))
  if (json.status === 'missing') return { status: 'missing' }
  const read =
    json.status === 'invalid'
      ? { ok: false as const, problems: [{ file: path, path: '', message: json.message }] }
      : readSceneDeclarations(json.value, path)
  problems.push(...read.problems)
  return read.ok
    ? { status: 'ok', scenes: read.scenes, problems: read.problems }
    : { status: 'invalid', problems: read.problems }
}

/** An act's mix at `path`: a missing file is an empty mix; one that cannot be read is never written over. */
async function readMix(root: string, path: string, problems: Problem[]): Promise<MixState> {
  const json = await readJson(resolveInRoot(root, path))
  if (json.status === 'missing') return { status: 'ok', scenes: {}, badIds: new Set() }
  const read =
    json.status === 'invalid'
      ? { ok: false as const, problems: [{ file: path, path: '', message: json.message }] }
      : readSceneMix(json.value, path)
  problems.push(...read.problems)
  return read.ok
    ? { status: 'ok', scenes: read.scenes, badIds: read.badIds }
    : { status: 'unreadable' }
}

/**
 * The Scenes pages of a project, read fresh from disk, against the music and sound effects the
 * project has already read. Null without a `scenes` section. Broken files are added to `problems`.
 */
export async function readScenes(
  root: string,
  project: Project,
  known: { music: MusicSummary | null; effects: EffectsSummary | null },
  problems: Problem[],
): Promise<ScenesSummary | null> {
  const { scenes } = project
  if (!scenes) return null
  const acts = []
  for (const part of project.narration.parts) {
    acts.push({
      id: part.id,
      title: part.title,
      canRefresh: Boolean(project.narration.refreshDialog),
      declarations: await readDeclarations(
        root,
        partPathFor(scenes.paths.declarations, part.id),
        problems,
      ),
      mix: await readMix(root, partPathFor(scenes.paths.mix, part.id), problems),
    })
  }
  return summarizeScenes({ acts, effects: known.effects, music: known.music?.lists ?? [] })
}

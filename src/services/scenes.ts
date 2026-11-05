import { dirname } from 'node:path'
import type { EffectsSummary } from '../core/effects'
import type { MusicSummary } from '../core/music'
import { resolveInRoot } from '../core/paths'
import { partPathFor, type Problem, type Project } from '../core/project'
import {
  readSceneDeclarations,
  readSceneMix,
  SceneMixSchema,
  summarizeScenes,
  type DeclarationsState,
  type MixState,
  type SceneMix,
  type ScenesSummary,
} from '../core/scenes'
import { sameMix } from '../core/sceneEdit'
import { readJson, writeAtomic, writeFailure } from './files'
import { readMeasures, sceneSaved } from './sceneMeasures'
import { createSerial } from './serial'
import { openProject } from './workspace'

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
  const measures = await readMeasures(root, problems)
  for (const part of project.narration.parts) {
    const mixFile = partPathFor(scenes.paths.mix, part.id)
    acts.push({
      mixFile,
      id: part.id,
      title: part.title,
      canRefresh: Boolean(project.narration.refreshDialog),
      declarations: await readDeclarations(
        root,
        partPathFor(scenes.paths.declarations, part.id),
        problems,
      ),
      mix: await readMix(root, mixFile, problems),
      loudness: measures[part.id],
    })
  }
  return summarizeScenes({
    acts,
    effects: known.effects,
    music: known.music?.lists ?? [],
    target: scenes.loudness ?? null,
  })
}

/** The widest a line of the mix may be before its object is written over several lines. */
const MIX_WIDTH = 100

/**
 * A value as the mix file shows it, two spaces to a level: the file and the scenes are open, and so
 * is a scene's entry that has effects, with a line to each effect, so a change shows as a change
 * to a line. Anything else is on one line while it fits (`"music": { "track": … }`). `at` is the
 * width already used on the line (the indent and the key).
 */
function mixText(value: unknown, depth = 0, indent = '', at = 0): string {
  const flat = flatText(value)
  if (typeof value !== 'object' || value === null) return flat
  const list = Array.isArray(value)
  const effects = !list && Array.isArray((value as { effects?: unknown }).effects)
  const open =
    depth <= 1 ||
    (depth === 2 && effects && (value as { effects: unknown[] }).effects.length > 0) ||
    (depth === 3 && list && value.length > 0)
  if (!open && at + flat.length <= MIX_WIDTH) return flat
  const inner = `${indent}  `
  if (list) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((v) => inner + mixText(v, depth + 1, inner, inner.length)).join(',\n')}\n${indent}]`
  }
  const keys = Object.keys(value)
  if (keys.length === 0) return '{}'
  const lines = keys.map((k) => {
    const head = `${inner}${JSON.stringify(k)}: `
    return head + mixText((value as Record<string, unknown>)[k], depth + 1, inner, head.length)
  })
  return `{\n${lines.join(',\n')}\n${indent}}`
}

/** A value on one line, with spaces inside braces and after commas: `{ "a": 1, "b": [1, 2] }`. */
function flatText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(flatText).join(', ')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${flatText(v)}`)
    return entries.length ? `{ ${entries.join(', ')} }` : '{}'
  }
  return JSON.stringify(value)
}

/** What saving a scene answered. */
export type SceneSave =
  | { ok: true }
  /** The scene was saved since the page read it; `current` is what is saved now. */
  | { ok: false; kind: 'stale'; current: SceneMix | null }
  | { ok: false; kind: 'unknown' | 'invalid' | 'unreadable' | 'failed'; message: string }

/** One write of an act's mix at a time. */
const mixWrites = createSerial()

/**
 * Saves one scene of an act into the act's mix file (§8.11), and nothing else: the other entries,
 * those the game no longer declares and those that cannot be read stay as they are. `was` is the
 * entry the page read (null: none); if the file's differs, someone saved meanwhile and nothing is
 * written. A mix that cannot be read is never written over. The file is written whole, scenes in
 * the declarations' order and then the rest in their old order, two-space indented.
 */
export function saveScene(
  projectFile: string,
  part: string,
  sceneId: string,
  scene: SceneMix,
  was: SceneMix | null,
): Promise<SceneSave> {
  const refuse = (kind: 'unknown' | 'invalid' | 'unreadable', message: string): SceneSave => ({
    ok: false,
    kind,
    message,
  })
  return mixWrites.run(`${projectFile}\0${part}`, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return refuse('unknown', opened.problems[0]?.message ?? 'the project is broken')
    const { project } = opened
    const act = project.narration.parts.find((p) => p.id === part)
    if (!project.scenes || !act) return refuse('unknown', `${part} has no scenes`)
    const root = dirname(projectFile)
    const problems: Problem[] = []
    const declarations = await readDeclarations(
      root,
      partPathFor(project.scenes.paths.declarations, part),
      problems,
    )
    if (declarations.status !== 'ok')
      return refuse('unknown', `the game has not listed ${part}'s scenes`)
    const declared = declarations.scenes.map((s) => s.id)
    if (!declared.includes(sceneId)) return refuse('unknown', `the game has no scene ${sceneId}`)
    const checked = SceneMixSchema.safeParse(scene)
    if (!checked.success) return refuse('invalid', 'the scene cannot be saved as it is')

    const mixFile = partPathFor(project.scenes.paths.mix, part)
    const json = await readJson(resolveInRoot(root, mixFile))
    let raw: Record<string, unknown> = { scenes: {} }
    if (json.status === 'invalid') return refuse('unreadable', `${mixFile} cannot be read`)
    if (json.status === 'ok') {
      const read = readSceneMix(json.value, mixFile)
      if (!read.ok || read.badIds.has(sceneId)) {
        return refuse('unreadable', `${sceneId} in ${mixFile} cannot be read`)
      }
      raw = json.value as Record<string, unknown>
      const current = read.scenes[sceneId] ?? null
      if (!sameMix(current, was)) return { ok: false, kind: 'stale', current }
    } else if (!sameMix(null, was)) {
      return { ok: false, kind: 'stale', current: null }
    }
    const old = raw.scenes as Record<string, unknown>
    const entries: Record<string, unknown> = {}
    for (const id of declared) {
      if (id === sceneId) entries[id] = checked.data
      else if (id in old) entries[id] = old[id]
    }
    for (const id of Object.keys(old)) if (!(id in entries)) entries[id] = old[id]
    try {
      await writeAtomic(root, mixFile, `${mixText({ ...raw, scenes: entries })}\n`)
    } catch (error) {
      return { ok: false, kind: 'failed', message: writeFailure(error) }
    }
    // The figures kept for the scene follow the Save; failing to keep them is not failing to save.
    await sceneSaved(projectFile, part, sceneId, checked.data).catch(() => {})
    return { ok: true }
  })
}

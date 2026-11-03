import {
  EffectOverridesSchema,
  readEffectEntries,
  summarizeEffects,
  type EffectOverrides,
  type EffectsListState,
  type EffectsSummary,
} from '../core/effects'
import { resolveInRoot } from '../core/paths'
import type { Problem, Project } from '../core/project'
import { readJson, readResource } from './files'

/** The studio's own descriptions of sound effects: its state, not the game's. */
export const EFFECTS_OVERRIDES_FILE = '.content-studio/effects.json'

/**
 * The game's effects list at `path`, entry by entry. Its problems (with their file and place) are
 * in the state, for the Sound effects page to list; a missing file is none, the game has not
 * written it yet.
 */
export async function readEffectsList(root: string, path: string): Promise<EffectsListState> {
  const json = await readJson(resolveInRoot(root, path))
  if (json.status === 'missing') return { status: 'missing' }
  if (json.status === 'invalid') {
    return { status: 'invalid', problems: [{ file: path, path: '', message: json.message }] }
  }
  const read = readEffectEntries(json.value, path)
  return read.ok ? { status: 'ok', ...read } : { status: 'invalid', problems: read.problems }
}

/**
 * The studio's own descriptions: none when there is no file; `invalid` (reported in `problems`)
 * when it cannot be read, in which case nothing may write over it.
 */
export async function readEffectOverrides(
  root: string,
  problems: Problem[],
): Promise<EffectOverrides | 'invalid'> {
  const read = await readResource(root, EFFECTS_OVERRIDES_FILE, EffectOverridesSchema, problems)
  return read === 'missing' ? {} : read
}

/**
 * The Sound effects pages of a project, read fresh from disk. Null without an `effects` section.
 * Broken files are added to `problems`.
 */
export async function readEffects(
  root: string,
  project: Project,
  problems: Problem[],
): Promise<EffectsSummary | null> {
  const { effects } = project
  if (!effects) return null
  const list = await readEffectsList(root, effects.paths.list)
  const overrides = await readEffectOverrides(root, problems)
  return summarizeEffects({
    list,
    overrides: overrides === 'invalid' ? {} : overrides,
    canRefresh: Boolean(effects.refresh),
  })
}

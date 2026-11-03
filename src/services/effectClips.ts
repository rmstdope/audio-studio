import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pyRound } from '../core/align'
import {
  EffectLockSchema,
  EffectManifestSchema,
  effectAcceptable,
  effectChangedFields,
  type EffectBoardTake,
  type EffectInputs,
  type EffectLock,
  type EffectLockEntry,
  type EffectManifest,
} from '../core/effectTakes'
import { resolveInRoot } from '../core/paths'
import type { EffectsConfig, Problem } from '../core/project'
import { pythonJson } from '../core/pyjson'
import type { Encoder } from './audio'
import { formatEntriesPerLine, listFiles, readResource, writeAtomic } from './files'
import { choices, sorted, type CommitResult } from './musicClips'

/** How the game's sound effects are encoded: stereo, 160 kbps, at the level the model made them. */
export const EFFECT_OUTPUT = { bitrate: '160k', channels: 2 } as const

/** The effects lock as it is now: empty if there is none; null (with the problems added) if broken. */
async function lockNow(
  root: string,
  effects: EffectsConfig,
  problems: Problem[],
): Promise<EffectLock | null> {
  const read = await readResource(root, effects.paths.lock, EffectLockSchema, problems)
  return read === 'invalid' ? null : read === 'missing' ? {} : read
}

/** The effects manifest as it is now: empty if there is none; null (with the problems added) if broken. */
async function manifestNow(
  root: string,
  effects: EffectsConfig,
  problems: Problem[],
): Promise<EffectManifest | null> {
  const read = await readResource(root, effects.paths.manifest, EffectManifestSchema, problems)
  return read === 'invalid' ? null : read === 'missing' ? {} : read
}

/**
 * Every effect the lock says is chosen, with whether its clip is a plain file in the clips folder.
 * A lock that cannot be read adds its problems and gives null: which take is chosen is then not known.
 */
export async function readEffectChosen(
  root: string,
  effects: EffectsConfig,
  problems: Problem[],
): Promise<Record<string, { lock: EffectLockEntry; fileExists: boolean }> | null> {
  const lock = await lockNow(root, effects, problems)
  if (!lock) return null
  const files = await listFiles(resolveInRoot(root, effects.paths.clips))
  return Object.fromEntries(
    Object.entries(lock).map(([id, entry]) => [
      id,
      { lock: entry, fileExists: files.has(`${id}.mp3`) },
    ]),
  )
}

/** The queue key of a project's choices: one at a time, each reading what the one before wrote. */
const turn = (projectFile: string) => `effect-choice\0${projectFile}`

/**
 * Makes a take the effect's clip: encoded beside the clip under a hidden name (never served, never a
 * stray clip), then, in the project's turn and once the manifest and lock could be read, moved into
 * place with the manifest entry written after it and the lock last. If anything fails before the
 * lock, the effect shows as it did. The manifest keeps the take's real length.
 */
export async function commitEffect({
  root,
  projectFile = root,
  effects,
  id,
  take,
  inUse,
  wav,
  encode,
  now = () => new Date(),
}: {
  root: string
  /** What names the project in the queue; the root by default. */
  projectFile?: string
  effects: EffectsConfig
  id: string
  take: EffectBoardTake
  /**
   * The effect's inputs now. Choosing any take counts the effect as made from the description in
   * use (so it clears an out-of-date box); the length stays the take's own, since a changed length
   * needs a new take.
   */
  inUse: EffectInputs
  wav: Uint8Array
  encode: Encoder
  now?: () => Date
}): Promise<CommitResult> {
  const file = `${id}.mp3`
  const target = resolveInRoot(root, join(effects.paths.clips, file))
  const temporary = resolveInRoot(root, join(effects.paths.clips, `.${id}.${randomUUID()}.mp3`))
  try {
    await encode(wav, temporary, EFFECT_OUTPUT)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  try {
    return await choices().run(turn(projectFile), async (): Promise<CommitResult> => {
      const found: Problem[] = []
      const manifest = await manifestNow(root, effects, found)
      const lock = await lockNow(root, effects, found)
      if (!manifest || !lock) {
        const unread = !manifest ? 'manifest' : 'lock'
        const message = `Take ${take.n} could not be chosen: the sound effects ${unread} could not be read.`
        return { ok: false, message: `${message} Nothing was changed.` }
      }
      manifest[id] = { file, duration: pyRound(take.seconds) }
      lock[id] = {
        fp: take.hash,
        model: take.model,
        ...(take.seed !== undefined && { seed: take.seed }),
        take: take.n,
        inputs: {
          description: inUse.description,
          seconds: take.inputs.seconds,
          ...(take.inputs.loops && { loops: true }),
        },
        at: now().toISOString(),
      }
      await rename(temporary, target)
      await writeAtomic(root, effects.paths.manifest, `${pythonJson(sorted(manifest))}\n`)
      await writeAtomic(root, effects.paths.lock, formatEntriesPerLine(sorted(lock)))
      return { ok: true }
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    // Gone already once renamed; otherwise never left behind.
    await rm(temporary, { force: true }).catch(() => {})
  }
}

/**
 * Takes the chosen take back: in the project's turn, once the manifest and lock could be read, the
 * effect's manifest entry, then its clip, then its lock entry last, so a failure part-way leaves it
 * chosen and the same click can be pressed again. An effect with no lock entry is refused; the
 * caller has asked the user.
 */
export async function uncommitEffect({
  root,
  projectFile = root,
  effects,
  id,
}: {
  root: string
  projectFile?: string
  effects: EffectsConfig
  id: string
}): Promise<CommitResult> {
  try {
    return await choices().run(turn(projectFile), async (): Promise<CommitResult> => {
      const found: Problem[] = []
      const manifest = await manifestNow(root, effects, found)
      const lock = await lockNow(root, effects, found)
      if (!manifest) return { ok: false, message: 'The sound effects manifest could not be read.' }
      if (!lock) return { ok: false, message: 'The sound effects lock could not be read.' }
      if (!(id in lock)) return { ok: false, message: 'No take is chosen for this effect.' }
      if (id in manifest) {
        delete manifest[id]
        await writeAtomic(root, effects.paths.manifest, `${pythonJson(sorted(manifest))}\n`)
      }
      await rm(resolveInRoot(root, join(effects.paths.clips, `${id}.mp3`)), { force: true })
      delete lock[id]
      await writeAtomic(root, effects.paths.lock, formatEntriesPerLine(sorted(lock)))
      return { ok: true }
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Accepts a changed description: in the project's turn, the effect's lock entry comes to count the
 * chosen take as made from `now`, so the effect is up to date with the same sound. A changed length
 * needs a new take and is refused, as is an effect with nothing changed or none chosen.
 */
export async function acceptEffect({
  root,
  projectFile = root,
  effects,
  id,
  now,
}: {
  root: string
  projectFile?: string
  effects: EffectsConfig
  id: string
  /** The effect's inputs now. */
  now: EffectInputs
}): Promise<CommitResult> {
  try {
    return await choices().run(turn(projectFile), async (): Promise<CommitResult> => {
      const lock = await lockNow(root, effects, [])
      if (!lock) return { ok: false, message: 'The sound effects lock could not be read.' }
      const entry = lock[id]
      if (!entry) return { ok: false, message: 'No take is chosen for this effect.' }
      const changed = effectChangedFields(entry, now)
      if (!changed.length)
        return { ok: false, message: 'Nothing has changed since the take was chosen.' }
      if (!effectAcceptable(changed)) {
        const plays = changed.some((f) => f === 'now loops' || f === 'no longer loops')
        return {
          ok: false,
          message: plays
            ? 'A change of how the effect plays cannot be accepted: the effect needs a new take.'
            : 'A changed length cannot be accepted: the effect needs a new take.',
        }
      }
      lock[id] = { ...entry, inputs: { ...entry.inputs, description: now.description } }
      await writeAtomic(root, effects.paths.lock, formatEntriesPerLine(sorted(lock)))
      return { ok: true }
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

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
import { LOCK_UNREAD, type LockRead } from '../core/lockRead'
import { resolveInRoot } from '../core/paths'
import { EFFECTS_LOCK_FILE, type EffectsConfig, type Problem } from '../core/project'
import { pythonJson } from '../core/pyjson'
import { FileNotWritten, type Encoder } from './audio'
import {
  WriteRefused,
  formatEntriesPerLine,
  listFiles,
  readResource,
  refuseWrite,
  writeFailure,
  writeOrRefuse,
} from './files'
import {
  choiceRefused,
  choices,
  commitFailure,
  sorted,
  takeOut,
  without,
  type CommitResult,
} from './musicClips'

/** How the game's sound effects are encoded: stereo, 160 kbps, at the level the model made them. */
export const EFFECT_OUTPUT = { bitrate: '160k', channels: 2 } as const

/** The lock file's text: one entry per line in id order, each entry's description written as `text`. */
export function formatEffectLock(lock: EffectLock): string {
  const written = Object.entries(lock).map(([id, entry]) => {
    const { description, ...rest } = entry.inputs
    return [id, { ...entry, inputs: { text: description, ...rest } }]
  })
  return formatEntriesPerLine(Object.fromEntries(written))
}

/** The effects lock as it is now: empty if there is none; null (with the problems added) if broken. */
async function lockNow(root: string, problems: Problem[]): Promise<EffectLock | null> {
  const read = await readResource(root, EFFECTS_LOCK_FILE, EffectLockSchema, problems)
  return read === 'invalid' ? null : read === 'missing' ? {} : read
}

/** The effects manifest as it is now: empty if there is none; null (with the problems added) if broken. */
async function manifestNow(
  root: string,
  effects: EffectsConfig,
  problems: Problem[],
): Promise<EffectManifest | null> {
  const read = await readResource(root, effects.manifest, EffectManifestSchema, problems)
  return read === 'invalid' ? null : read === 'missing' ? {} : read
}

/**
 * Every effect the lock says is chosen, with whether its clip is a plain file in the clips folder.
 * A lock that cannot be read adds its problems and is `LOCK_UNREAD`: which take is chosen is then not known.
 */
export async function readEffectChosen(
  root: string,
  effects: EffectsConfig,
  problems: Problem[],
): Promise<LockRead<{ lock: EffectLockEntry; fileExists: boolean }>> {
  const lock = await lockNow(root, problems)
  if (!lock) return LOCK_UNREAD
  const files = await listFiles(resolveInRoot(root, effects.clips))
  const entries = Object.fromEntries(
    Object.entries(lock).map(([id, entry]) => [
      id,
      { lock: entry, fileExists: files.has(`${id}.mp3`) },
    ]),
  )
  return { read: true, entries }
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
  soundOnly = false,
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
  /** Only the clip is written again; the manifest and the lock entry stay exactly as they are (fades). */
  soundOnly?: boolean
}): Promise<CommitResult> {
  const file = `${id}.mp3`
  const target = resolveInRoot(root, join(effects.clips, file))
  const temporary = resolveInRoot(root, join(effects.clips, `.${id}.${randomUUID()}.mp3`))
  try {
    await encode(wav, temporary, EFFECT_OUTPUT)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    // The encoder knows only the temporary file's folder: the refusal names the game's file.
    return commitFailure(
      error instanceof FileNotWritten
        ? new WriteRefused(join(effects.clips, file), writeFailure(error), error)
        : error,
    )
  }
  try {
    return await choices().run(turn(projectFile), async (): Promise<CommitResult> => {
      const found: Problem[] = []
      // Only the sound is written for fades: the manifest is neither read nor written.
      const manifest = soundOnly ? {} : await manifestNow(root, effects, found)
      const lock = await lockNow(root, found)
      if (!manifest || !lock) {
        const unread = !manifest ? 'manifest' : 'lock'
        return choiceRefused(take.n, `the sound effects ${unread} could not be read`)
      }
      if (soundOnly) {
        await rename(temporary, target).catch(refuseWrite(join(effects.clips, file)))
        return { ok: true }
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
      await rename(temporary, target).catch(refuseWrite(join(effects.clips, file)))
      await writeOrRefuse(root, effects.manifest, `${pythonJson(sorted(manifest))}\n`)
      await writeOrRefuse(root, EFFECTS_LOCK_FILE, formatEffectLock(lock))
      return { ok: true }
    })
  } catch (error) {
    return commitFailure(error)
  } finally {
    // Gone already once renamed; otherwise never left behind.
    await rm(temporary, { force: true }).catch(() => {})
  }
}

/**
 * What the game has of one effect now (its clip, manifest entry and lock entry), and a way to put
 * exactly that back later. The put-back runs in the project's turn and touches only this effect's
 * entries, so what other effects chose meanwhile stays.
 */
export async function keepEffect({
  root,
  projectFile = root,
  effects,
  id,
}: {
  root: string
  projectFile?: string
  effects: EffectsConfig
  id: string
}): Promise<() => Promise<void>> {
  const clip = join(effects.clips, `${id}.mp3`)
  const sound = await Bun.file(resolveInRoot(root, clip))
    .bytes()
    .catch(() => null)
  const manifestWas = (await manifestNow(root, effects, []))?.[id]
  const lockWas = (await lockNow(root, []))?.[id]
  return () =>
    choices().run(turn(projectFile), async () => {
      if (sound) await writeOrRefuse(root, clip, sound)
      else await rm(resolveInRoot(root, clip), { force: true })
      const found: Problem[] = []
      const manifest = await manifestNow(root, effects, found)
      const lock = await lockNow(root, found)
      if (!manifest || !lock)
        throw new Error('The sound effects manifest or lock could not be read.')
      if (manifestWas) manifest[id] = manifestWas
      else delete manifest[id]
      await writeOrRefuse(root, effects.manifest, `${pythonJson(sorted(manifest))}\n`)
      if (lockWas) lock[id] = lockWas
      else delete lock[id]
      await writeOrRefuse(root, EFFECTS_LOCK_FILE, formatEffectLock(lock))
    })
}

/**
 * Takes the chosen take back: in the project's turn, once the manifest and lock could be read, the
 * effect's manifest entry, then its clip, then its lock entry last (`takeOut`), so a failure
 * part-way puts back what was changed and the effect stays chosen. An effect with no lock entry
 * is refused; the caller has asked the user.
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
      const lock = await lockNow(root, found)
      if (!manifest) return { ok: false, message: 'The sound effects manifest could not be read.' }
      if (!lock) return { ok: false, message: 'The sound effects lock could not be read.' }
      if (!(id in lock)) return { ok: false, message: 'No take is chosen for this effect.' }
      delete lock[id]
      return takeOut({
        root,
        clips: effects.clips,
        id,
        manifest: id in manifest ? effects.manifest : null,
        manifestNow: `${pythonJson(sorted(without(manifest, id)))}\n`,
        lock: EFFECTS_LOCK_FILE,
        lockNow: formatEffectLock(lock),
      })
    })
  } catch (error) {
    return commitFailure(error)
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
  id,
  now,
}: {
  root: string
  projectFile?: string
  id: string
  /** The effect's inputs now. */
  now: EffectInputs
}): Promise<CommitResult> {
  try {
    return await choices().run(turn(projectFile), async (): Promise<CommitResult> => {
      const lock = await lockNow(root, [])
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
      await writeOrRefuse(root, EFFECTS_LOCK_FILE, formatEffectLock(lock))
      return { ok: true }
    })
  } catch (error) {
    return commitFailure(error)
  }
}

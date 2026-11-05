import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pyRound } from '../core/align'
import type { ChosenState } from '../core/music'
import {
  MusicLockSchema,
  MusicManifestSchema,
  formatMusicLock,
  acceptable,
  changedFields,
  type LockEntry,
  type MusicLock,
  type MusicManifest,
} from '../core/musicChoose'
import { MUSIC_MODEL, type BoardTake, type TakeInputs } from '../core/musicTake'
import { resolveInRoot } from '../core/paths'
import { MUSIC_LOCK_FILE, type MusicConfig, type Problem } from '../core/project'
import { pythonJson } from '../core/pyjson'
import { FileNotWritten, type Encoder } from './audio'
import { isWriteFailure, listFiles, readResource, writeAtomic } from './files'
import { createSerial, type Serial } from './serial'
import type { ProjectFailure } from './workspace'

/** How the game's music is encoded: stereo, 160 kbps, levelled to −20 LUFS as RetroQuest levels it. */
export const MUSIC_OUTPUT = { bitrate: '160k', channels: 2, lufs: -20 } as const

/** What choosing a take answered: written, refused with a reason, or a lock or manifest that cannot be used. */
export type CommitResult = { ok: true } | { ok: false; message: string } | ProjectFailure

/** The music lock as it is now: empty if there is none; null (with the problems added) if broken. */
export async function lockNow(root: string, problems: Problem[]): Promise<MusicLock | null> {
  const read = await readResource(root, MUSIC_LOCK_FILE, MusicLockSchema, problems)
  return read === 'invalid' ? null : read === 'missing' ? {} : read
}

/** The music manifest as it is now: empty if there is none; null (with the problems added) if broken. */
export async function manifestNow(
  root: string,
  music: MusicConfig,
  problems: Problem[],
): Promise<MusicManifest | null> {
  const read = await readResource(root, music.manifest, MusicManifestSchema, problems)
  return read === 'invalid' ? null : read === 'missing' ? {} : read
}

/**
 * Every track the lock says is chosen, with whether its music file is a plain file in the clips
 * folder. A lock that cannot be read adds its problems and gives null: which take is chosen is
 * then not known.
 */
export async function readChosen(
  root: string,
  music: MusicConfig,
  problems: Problem[],
): Promise<Record<string, ChosenState> | null> {
  const lock = await lockNow(root, problems)
  if (!lock) return null
  const files = await listFiles(resolveInRoot(root, music.clips))
  return Object.fromEntries(
    Object.entries(lock).map(([id, entry]) => [
      id,
      { lock: entry, fileExists: files.has(`${id}.mp3`) },
    ]),
  )
}

/** One choice at a time per project: each reads the manifest and lock the one before wrote. */
export function choices(): Serial {
  const shared = globalThis as { contentStudioMusicChoices?: Serial }
  return (shared.contentStudioMusicChoices ??= createSerial())
}

/**
 * Makes a take the track's music: levelled and encoded beside the clip under a hidden name (never
 * served, never a stray clip), then, in the project's turn and once the manifest and lock could be
 * read, moved into place with the manifest entry written after it and the lock last. If anything
 * fails before the lock, the track shows as it did, never as up to date with a file it does not
 * have. The lock records the take's own inputs, seed and model, and the list it came from.
 */
export async function commitChoice({
  root,
  projectFile = root,
  music,
  id,
  listId,
  take,
  wav,
  encode,
  now = () => new Date(),
  soundOnly = false,
}: {
  root: string
  /** What names the project in the queue; the root by default. */
  projectFile?: string
  music: MusicConfig
  id: string
  /** The act's id, or `stingers`. */
  listId: string
  take: BoardTake
  wav: Uint8Array
  encode: Encoder
  now?: () => Date
  /** Only the music file is written again; the manifest and the lock entry stay exactly as they are (fades). */
  soundOnly?: boolean
}): Promise<CommitResult> {
  const file = `${id}.mp3`
  const target = resolveInRoot(root, join(music.clips, file))
  const temporary = resolveInRoot(root, join(music.clips, `.${id}.${randomUUID()}.mp3`))
  try {
    await encode(wav, temporary, MUSIC_OUTPUT)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    if (error instanceof FileNotWritten) {
      return { ok: false, message: 'The game’s file could not be written.' }
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  try {
    return await choices().run(`music-choice\0${projectFile}`, async (): Promise<CommitResult> => {
      const found: Problem[] = []
      const manifest = await manifestNow(root, music, found)
      const lock = await lockNow(root, found)
      if (!manifest || !lock) {
        const unread = !manifest ? 'manifest' : 'lock'
        const message = `Take ${take.n} could not be chosen: the music ${unread} could not be read.`
        return { ok: false, message: `${message} Nothing was changed.` }
      }
      if (soundOnly) {
        await rename(temporary, target)
        return { ok: true }
      }
      manifest[id] = { file, duration: pyRound(take.seconds) }
      const entry: LockEntry = {
        fp: take.hash,
        model: take.model ?? MUSIC_MODEL,
        ...(take.seed !== undefined && { seed: take.seed }),
        list: listId,
        take: take.n,
        inputs: take.inputs,
        at: now().toISOString(),
      }
      lock[id] = entry
      await rename(temporary, target)
      await writeAtomic(root, music.manifest, `${pythonJson(sorted(manifest))}\n`)
      await writeAtomic(root, MUSIC_LOCK_FILE, formatMusicLock(lock))
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
 * Takes the chosen take back: in the project's choice turn, once the manifest and lock could be
 * read, the track's manifest entry, then its music file, then its lock entry last, so a failure
 * part-way leaves the track chosen and the same click can be pressed again (as removing an
 * orphan). A track with no lock entry is refused; the caller has asked the user.
 */
export async function uncommitChoice({
  root,
  projectFile = root,
  music,
  id,
}: {
  root: string
  /** What names the project in the queue; the root by default. */
  projectFile?: string
  music: MusicConfig
  id: string
}): Promise<CommitResult> {
  try {
    return await choices().run(`music-choice\0${projectFile}`, async (): Promise<CommitResult> => {
      const found: Problem[] = []
      const manifest = await manifestNow(root, music, found)
      const lock = await lockNow(root, found)
      if (!manifest) return { ok: false, message: 'The music manifest could not be read.' }
      if (!lock) return { ok: false, message: 'The music lock could not be read.' }
      if (!(id in lock)) return { ok: false, message: 'No take is chosen for this track.' }
      if (id in manifest) {
        delete manifest[id]
        await writeAtomic(root, music.manifest, `${pythonJson(sorted(manifest))}\n`)
      }
      await rm(resolveInRoot(root, join(music.clips, `${id}.mp3`)), { force: true })
      delete lock[id]
      await writeAtomic(root, MUSIC_LOCK_FILE, formatMusicLock(lock))
      return { ok: true }
    })
  } catch (error) {
    if (isWriteFailure(error))
      return { ok: false, message: 'The game’s file could not be written.' }
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Accepts a track's changed brief, tempo or key: in the project's choice turn, its lock entry comes
 * to count the chosen take as made from what `now` has, so the track is up to date again with the
 * same music. A changed length needs a new take and is refused, as is a track with nothing changed
 * or none chosen.
 */
export async function acceptChange({
  root,
  projectFile = root,
  id,
  now,
}: {
  root: string
  /** What names the project in the queue; the root by default. */
  projectFile?: string
  id: string
  /** The track's inputs now. */
  now: TakeInputs
}): Promise<CommitResult> {
  try {
    return await choices().run(`music-choice\0${projectFile}`, async (): Promise<CommitResult> => {
      const lock = await lockNow(root, [])
      if (!lock) return { ok: false, message: 'The music lock could not be read.' }
      const entry = lock[id]
      if (!entry) return { ok: false, message: 'No take is chosen for this track.' }
      const changed = changedFields(entry, now)
      if (!changed.length)
        return { ok: false, message: 'Nothing has changed since the take was chosen.' }
      if (!acceptable(changed)) {
        return {
          ok: false,
          message: 'A changed length cannot be accepted: the track needs a new take.',
        }
      }
      lock[id] = {
        ...entry,
        inputs: { ...entry.inputs, brief: now.brief, bpm: now.bpm, key: now.key },
      }
      await writeAtomic(root, MUSIC_LOCK_FILE, formatMusicLock(lock))
      return { ok: true }
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]!]),
  )
}

import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pyRound } from '../core/align'
import type { ChosenState } from '../core/music'
import {
  MusicLockSchema,
  MusicManifestSchema,
  type LockEntry,
  type MusicLock,
  type MusicManifest,
} from '../core/musicChoose'
import { MUSIC_MODEL, type BoardTake } from '../core/musicTake'
import { resolveInRoot } from '../core/paths'
import type { MusicConfig, Problem } from '../core/project'
import { pythonJson } from '../core/pyjson'
import type { Encoder } from './audio'
import { formatEntriesPerLine, listFiles, readResource, writeAtomic } from './files'
import { createSerial, type Serial } from './serial'
import type { ProjectFailure } from './workspace'

/** How the game's music is encoded: stereo, 160 kbps, levelled to −20 LUFS as RetroQuest levels it. */
export const MUSIC_OUTPUT = { bitrate: '160k', channels: 2, lufs: -20 } as const

/** What choosing a take answered: written, refused with a reason, or a lock or manifest that cannot be used. */
export type CommitResult = { ok: true } | { ok: false; message: string } | ProjectFailure

/** The music lock as it is now: empty if there is none; null (with the problems added) if broken. */
export async function lockNow(
  root: string,
  music: MusicConfig,
  problems: Problem[],
): Promise<MusicLock | null> {
  const read = await readResource(root, music.paths.lock, MusicLockSchema, problems)
  return read === 'invalid' ? null : read === 'missing' ? {} : read
}

/** The music manifest as it is now: empty if there is none; null (with the problems added) if broken. */
export async function manifestNow(
  root: string,
  music: MusicConfig,
  problems: Problem[],
): Promise<MusicManifest | null> {
  const read = await readResource(root, music.paths.manifest, MusicManifestSchema, problems)
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
  const lock = await lockNow(root, music, problems)
  if (!lock) return null
  const files = await listFiles(resolveInRoot(root, music.paths.clips))
  return Object.fromEntries(
    Object.entries(lock).map(([id, entry]) => [
      id,
      { lock: entry, fileExists: files.has(`${id}.mp3`) },
    ]),
  )
}

/** One choice at a time per project: each reads the manifest and lock the one before wrote. */
export function choices(): Serial {
  const shared = globalThis as { audioStudioMusicChoices?: Serial }
  return (shared.audioStudioMusicChoices ??= createSerial())
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
}): Promise<CommitResult> {
  const file = `${id}.mp3`
  const target = resolveInRoot(root, join(music.paths.clips, file))
  const temporary = resolveInRoot(root, join(music.paths.clips, `.${id}.${randomUUID()}.mp3`))
  try {
    await encode(wav, temporary, MUSIC_OUTPUT)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  try {
    return await choices().run(`music-choice\0${projectFile}`, async (): Promise<CommitResult> => {
      const found: Problem[] = []
      const manifest = await manifestNow(root, music, found)
      const lock = await lockNow(root, music, found)
      if (!manifest || !lock) return { ok: false, file: found[0]!.file, problems: found }
      manifest[id] = { file, duration: pyRound(take.seconds) }
      const entry: LockEntry = {
        fp: take.hash,
        model: take.model ?? MUSIC_MODEL,
        seed: take.seed,
        list: listId,
        take: take.n,
        inputs: take.inputs,
        at: now().toISOString(),
      }
      lock[id] = entry
      await rename(temporary, target)
      await writeAtomic(root, music.paths.manifest, `${pythonJson(sorted(manifest))}\n`)
      await writeAtomic(root, music.paths.lock, formatEntriesPerLine(lock))
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
      const lock = await lockNow(root, music, found)
      if (!manifest || !lock) return { ok: false, file: found[0]!.file, problems: found }
      if (!(id in lock)) return { ok: false, message: 'No take is chosen for this track.' }
      if (id in manifest) {
        delete manifest[id]
        await writeAtomic(root, music.paths.manifest, `${pythonJson(sorted(manifest))}\n`)
      }
      await rm(resolveInRoot(root, join(music.paths.clips, `${id}.mp3`)), { force: true })
      delete lock[id]
      await writeAtomic(root, music.paths.lock, formatEntriesPerLine(lock))
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

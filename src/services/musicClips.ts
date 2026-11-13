import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pyRound } from '../core/align'
import { LOCK_UNREAD, type LockRead } from '../core/lockRead'
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
import {
  WriteRefused,
  listFiles,
  readResource,
  refuseWrite,
  writeFailure,
  refusalSentence,
  writeOrRefuse,
} from './files'
import { createSerial, type Serial } from './serial'
import type { ProjectFailure } from './workspace'

/** How the game's music is encoded: stereo, 160 kbps, levelled to −20 LUFS as RetroQuest levels it. */
export const MUSIC_OUTPUT = { bitrate: '160k', channels: 2, lufs: -20 } as const

/** What choosing a take answered: written, refused with a reason, or a lock or manifest that cannot be used. */
export type CommitResult =
  | { ok: true }
  /**
   * `reason` is the failure without the framing around it, when the framing is the module's;
   * `gameChanged` when part of the change reached the game's files and could not be put back.
   */
  | { ok: false; message: string; reason?: string; gameChanged?: true }
  | ProjectFailure

/** A choice refused because the lock or manifest could not be read: nothing was changed. */
export function choiceRefused(n: number, reason: string): CommitResult {
  return {
    ok: false,
    message: `Take ${n} could not be chosen: ${reason}. Nothing was changed.`,
    reason,
  }
}

/**
 * What a choice, un-choice or accept that threw answers: a refused write names its file, anything
 * else gives its own message.
 */
export function commitFailure(error: unknown): CommitResult {
  const sentence = refusalSentence(error)
  if (sentence !== null) {
    // Kept in the server log: the person is told which file, the log says why.
    console.error('writing the game’s files failed', error)
    return { ok: false, message: `${sentence}.`, reason: sentence }
  }
  return { ok: false, message: error instanceof Error ? error.message : String(error) }
}

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
 * folder. A lock that cannot be read adds its problems and is `LOCK_UNREAD`: which take is
 * chosen is then not known.
 */
export async function readChosen(
  root: string,
  music: MusicConfig,
  problems: Problem[],
): Promise<LockRead<ChosenState>> {
  const lock = await lockNow(root, problems)
  if (!lock) return LOCK_UNREAD
  const files = await listFiles(resolveInRoot(root, music.clips))
  const entries = Object.fromEntries(
    Object.entries(lock).map(([id, entry]) => [
      id,
      { lock: entry, fileExists: files.has(`${id}.mp3`) },
    ]),
  )
  return { read: true, entries }
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
    // The encoder knows only the temporary file's folder: the refusal names the game's file.
    return commitFailure(
      error instanceof FileNotWritten
        ? new WriteRefused(join(music.clips, file), writeFailure(error), error)
        : error,
    )
  }
  try {
    return await choices().run(`music-choice\0${projectFile}`, async (): Promise<CommitResult> => {
      const found: Problem[] = []
      const manifest = await manifestNow(root, music, found)
      const lock = await lockNow(root, found)
      if (!manifest || !lock) {
        const unread = !manifest ? 'manifest' : 'lock'
        return choiceRefused(take.n, `the music ${unread} could not be read`)
      }
      if (soundOnly) {
        await rename(temporary, target).catch(refuseWrite(join(music.clips, file)))
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
      await rename(temporary, target).catch(refuseWrite(join(music.clips, file)))
      await writeOrRefuse(root, music.manifest, `${pythonJson(sorted(manifest))}\n`)
      await writeOrRefuse(root, MUSIC_LOCK_FILE, formatMusicLock(lock))
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
 * What the game has of one track now (its music file, manifest entry and lock entry), and a way to
 * put exactly that back later. The put-back runs in the project's choice turn and touches only this
 * track's entries, so what other tracks chose meanwhile stays.
 */
export async function keepMusicChoice({
  root,
  projectFile = root,
  music,
  id,
}: {
  root: string
  projectFile?: string
  music: MusicConfig
  id: string
}): Promise<() => Promise<void>> {
  const clip = join(music.clips, `${id}.mp3`)
  const sound = await Bun.file(resolveInRoot(root, clip))
    .bytes()
    .catch(() => null)
  const manifestWas = (await manifestNow(root, music, []))?.[id]
  const lockWas = (await lockNow(root, []))?.[id]
  return () =>
    choices().run(`music-choice\0${projectFile}`, async () => {
      if (sound) await writeOrRefuse(root, clip, sound)
      else await rm(resolveInRoot(root, clip), { force: true })
      const found: Problem[] = []
      const manifest = await manifestNow(root, music, found)
      const lock = await lockNow(root, found)
      if (!manifest || !lock) throw new Error('The music manifest or lock could not be read.')
      if (manifestWas) manifest[id] = manifestWas
      else delete manifest[id]
      await writeOrRefuse(root, music.manifest, `${pythonJson(sorted(manifest))}\n`)
      if (lockWas) lock[id] = lockWas
      else delete lock[id]
      await writeOrRefuse(root, MUSIC_LOCK_FILE, formatMusicLock(lock))
    })
}

/**
 * Takes the chosen take back: in the project's choice turn, once the manifest and lock could be
 * read, the track's manifest entry, then its music file, then its lock entry last (`takeOut`), so
 * a failure part-way puts back what was changed and the track stays chosen. A track with no lock
 * entry is refused; the caller has asked the user.
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
      delete lock[id]
      return takeOut({
        root,
        clips: music.clips,
        id,
        manifest: id in manifest ? music.manifest : null,
        manifestNow: () => {
          delete manifest[id]
          return `${pythonJson(sorted(manifest))}\n`
        },
        lock: MUSIC_LOCK_FILE,
        lockNow: formatMusicLock(lock),
      })
    })
  } catch (error) {
    return commitFailure(error)
  }
}

/**
 * Takes one chosen clip out of the game, in a choice turn that has read the manifest and lock: the
 * manifest entry (when `manifest` names the file holding it), then the clip, set aside under a
 * hidden name, then the lock last. A write that fails puts back what was already changed, so the
 * game's files and the lock still agree and "nothing was changed" is true; the clip is deleted only
 * once the lock is written. A clip already gone is no failure.
 */
export async function takeOut({
  root,
  clips,
  id,
  manifest,
  manifestNow,
  lock,
  lockNow,
}: {
  root: string
  clips: string
  id: string
  /** The manifest's path when it holds the entry; null to leave it alone. */
  manifest: string | null
  /** The manifest's text without the entry. */
  manifestNow: () => string
  lock: string
  /** The lock's text without the entry. */
  lockNow: string
}): Promise<CommitResult> {
  const clip = join(clips, `${id}.mp3`)
  const aside = resolveInRoot(root, join(clips, `.${id}.${randomUUID()}.mp3`))
  const putBack: (() => Promise<unknown>)[] = []
  try {
    if (manifest) {
      const was = await Bun.file(resolveInRoot(root, manifest)).bytes()
      await writeOrRefuse(root, manifest, manifestNow())
      putBack.push(() => writeOrRefuse(root, manifest, was))
    }
    const moved = await rename(resolveInRoot(root, clip), aside).then(
      () => true,
      (error: unknown) => {
        if ((error as { code?: unknown }).code === 'ENOENT') return false
        return refuseWrite(clip)(error)
      },
    )
    if (moved) putBack.push(() => rename(aside, resolveInRoot(root, clip)))
    await writeOrRefuse(root, lock, lockNow)
  } catch (error) {
    try {
      for (const step of putBack.reverse()) await step()
    } catch (stuck) {
      console.error('putting the game’s files back failed', stuck)
      const sentence =
        refusalSentence(error) ?? (error instanceof Error ? error.message : String(error))
      return {
        ok: false,
        message: `${sentence.replace(/\.$/, '')}, and the game’s files could not be put back.`,
        gameChanged: true,
      }
    }
    return commitFailure(error)
  }
  await rm(aside, { force: true }).catch(() => {})
  return { ok: true }
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
      await writeOrRefuse(root, MUSIC_LOCK_FILE, formatMusicLock(lock))
      return { ok: true }
    })
  } catch (error) {
    return commitFailure(error)
  }
}

export function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]!]),
  )
}

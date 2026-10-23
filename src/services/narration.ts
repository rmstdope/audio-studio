import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spreadWords } from '../core/align'
import { clipInputs, fingerprint } from '../core/fingerprint'
import { planPart } from '../core/planner'
import { resolveInRoot } from '../core/paths'
import type { Problem } from '../core/project'
import { pythonJson } from '../core/pyjson'
import { LockSchema, ManifestSchema, type Lock, type Manifest } from '../core/resources'
import { spokenPieces } from '../core/spoken'
import { joinWavs } from '../core/wav'
import type { FishFactory } from './auditions'
import { ffmpegEncoder, type Encoder } from './audio'
import { formatEntriesPerLine, readResource, writeAtomic } from './files'
import type { Limiter } from './limit'
import { inPartTurn } from './partFiles'
import { readPart, type ProjectFailure } from './workspace'

/** Seconds of silence between the pieces of a long line (as in RetroQuest's narrate.py). */
export const GAP_SECONDS = 0.25

/** A recorded line, or why it was not recorded. Null for an unknown part or line. */
export type RecordResult =
  | { ok: true; key: string; duration: number }
  /** Asked to record only if needed, and the line is up to date by now: nothing was done. */
  | { ok: true; key: string; skipped: true }
  | {
      ok: false
      reason: 'uncast' | 'no-key' | 'fish' | 'audio' | 'encode' | 'write'
      message: string
    }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/** Recordings in progress, by project, part and line. */
const recordings = new Map<string, Promise<RecordResult>>()

/** How lines are recorded: the encoder (ffmpeg unless replaced, in tests) and the Fish limiter. */
export interface RecordOptions {
  encode?: Encoder
  limiter: Limiter
  /**
   * Record the line only if it is still missing or stale when its turn comes (a job's lines may
   * have been recorded or adopted meanwhile), so a job never pays for a line twice.
   */
  onlyIfNeeded?: boolean
}

/**
 * Records one line: its text in sentence-sized pieces, each spoken by Fish in the speaker's voice
 * with its cue (the draft model), joined with a short pause, encoded as the project's output; then
 * the clip's manifest entry (with the words spread over it until clips are transcribed) and its
 * lock entry are written. Nothing is written unless the clip was made and the manifest and lock
 * could be read; the clip, then the manifest, then the lock are written last of all, so a failure
 * part-way leaves the line stale or untracked, never passing as up to date. At most
 * `quality.parallel` lines are spoken by Fish at once, and a line already being recorded is not
 * recorded twice.
 */
export async function recordLine(
  projectFile: string,
  partId: string,
  key: string,
  fishFor: FishFactory,
  { encode = ffmpegEncoder, limiter, onlyIfNeeded = false }: RecordOptions,
): Promise<RecordResult> {
  const read = await readPart(projectFile, partId)
  if (!read || !read.ok) return read
  if (read.problems.length) return { ok: false, problems: read.problems }
  const line = read.input.lines.find((l) => l.key === key)
  if (!line) return null
  const { cast, cues } = read.input
  const { narration } = read.project
  const inputs = clipInputs(line, cast.speakers[line.speaker], cues, cast.pronounce, narration)
  if (!inputs) {
    return {
      ok: false,
      reason: 'uncast',
      message: `${line.speaker} has no voice yet; cast one first.`,
    }
  }
  const root = dirname(projectFile)
  const fish = await fishFor(root, read.project)
  if (!fish) {
    return {
      ok: false,
      reason: 'no-key',
      message: 'Set FISH_AUDIO_API_KEY in the project’s env file, or in the environment.',
    }
  }

  // The same line asked for again while it is being recorded shares that recording.
  const id = `${projectFile}\n${partId}\n${key}`
  const running = recordings.get(id)
  if (running) return running
  const recording = record()
  recordings.set(id, recording)
  const forget = () => recordings.delete(id)
  recording.then(forget, forget)
  return recording

  async function record(): Promise<RecordResult> {
    if (!inputs || !fish || !read || !read.ok || !line) return null
    if (onlyIfNeeded) {
      // Checked only now that this recording is registered: a recording of the same line that
      // finished meanwhile has written its files before leaving, so it is seen here.
      const fresh = await readPart(projectFile, partId)
      if (!fresh || !fresh.ok) return fresh
      const status = planPart(fresh.input).lines.find((l) => l.key === key)?.status
      if (status === 'uncast') {
        return {
          ok: false,
          reason: 'uncast',
          message: `${line.speaker} has no voice yet; cast one first.`,
        }
      }
      if (status !== 'missing' && status !== 'stale') return { ok: true, key, skipped: true }
    }
    // Only speaking holds a Fish slot; joining, encoding and writing do not.
    let pieces: Uint8Array[]
    try {
      pieces = await limiter.run(`line\n${id}`, narration.quality.parallel, async () => {
        const spoken: Uint8Array[] = []
        const texts = spokenPieces(
          line.text,
          inputs.cue,
          cast.pronounce,
          narration.quality.chunkLimit,
        )
        for (const text of texts) {
          spoken.push(
            await fish.tts({
              text,
              voice: inputs.voice,
              model: inputs.model,
              temperature: narration.tts.temperature,
              topP: narration.tts.topP,
              speed: narration.tts.speed,
              format: 'wav',
            }),
          )
        }
        return spoken
      })
    } catch (error) {
      return { ok: false, reason: 'fish', message: messageOf(error) }
    }
    let clip: { wav: Uint8Array; seconds: number }
    try {
      clip = joinWavs(pieces, GAP_SECONDS)
    } catch (error) {
      return {
        ok: false,
        reason: 'audio',
        message: `Fish sent audio that could not be joined: ${messageOf(error)}`,
      }
    }

    // Encoded beside the clip under a hidden name (never served, never a stray clip), and moved
    // into place only in the part's turn, once the manifest and lock could be read.
    const file = `${key}.mp3`
    const paths = read.paths
    const target = resolveInRoot(root, join(paths.clipsPath, file))
    const temporary = resolveInRoot(root, join(paths.clipsPath, `.${key}.${randomUUID()}.mp3`))
    try {
      await encode(clip.wav, temporary, narration.output)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      return { ok: false, reason: 'encode', message: messageOf(error) }
    }

    const duration = Math.round(clip.seconds * 1000) / 1000
    const { fp, parts } = fingerprint(inputs)
    try {
      const problems = await inPartTurn(projectFile, partId, async () => {
        // Read again in the part's turn: other lines may have been written meanwhile.
        const found: Problem[] = []
        const manifest = await manifestNow(root, paths.manifestPath, found)
        const lock = await lockNow(root, paths.lockPath, found)
        if (!manifest || !lock) return found
        manifest[key] = {
          file,
          speaker: line.speaker,
          duration,
          words: spreadWords(line.text, duration),
        }
        lock[key] = {
          fp,
          voice: inputs.voice,
          model: inputs.model,
          parts,
          takes: 1,
          at: new Date().toISOString(),
        }
        // The lock last: if anything fails before it, the line shows as stale (its old lock entry)
        // or untracked (none), never as up to date.
        await rename(temporary, target)
        await writeAtomic(root, paths.manifestPath, `${pythonJson(sorted(manifest))}\n`)
        await writeAtomic(root, paths.lockPath, formatEntriesPerLine(lock))
        return []
      })
      if (problems.length) return { ok: false, problems }
      return { ok: true, key, duration }
    } catch (error) {
      return { ok: false, reason: 'write', message: messageOf(error) }
    } finally {
      // Gone already once renamed; otherwise never left behind.
      await rm(temporary, { force: true }).catch(() => {})
    }
  }
}

/** The part's manifest as it is now: empty if there is none, null (with the problem added) if broken. */
async function manifestNow(
  root: string,
  path: string,
  problems: Problem[],
): Promise<Manifest | null> {
  const read = await readResource(root, path, ManifestSchema, problems)
  return read === 'invalid' ? null : read === 'missing' ? {} : read
}

/** The part's lock as it is now: empty if there is none, null (with the problem added) if broken. */
async function lockNow(root: string, path: string, problems: Problem[]): Promise<Lock | null> {
  const read = await readResource(root, path, LockSchema, problems)
  return read === 'invalid' ? null : read === 'missing' ? {} : read
}

function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((k) => [k, record[k]!]),
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A clip file name that stays inside the clips folder. */
const SAFE_CLIP = /^[\w-][\w.-]*$/

/**
 * Removes orphaned clips (their line left the dialog): the clip file, its manifest entry and its
 * lock entry. Only keys that are orphans now, read afresh in the part's turn, are removed, and a
 * clip file is deleted only if its name stays inside the clips folder. Returns how many orphans
 * were removed.
 */
export async function removeOrphans(
  projectFile: string,
  partId: string,
  keys: string[],
): Promise<number> {
  return inPartTurn(projectFile, partId, async () => {
    const read = await readPart(projectFile, partId)
    if (!read || !read.ok) return 0
    if (read.problems.length) {
      throw new Error(read.problems.map((p) => `${p.file}: ${p.message}`).join('; '))
    }
    const root = dirname(projectFile)
    const lines = new Set(read.input.lines.map((line) => line.key))
    const manifest = { ...read.input.manifest }
    const lock = { ...read.input.lock }
    let removed = 0
    for (const key of keys) {
      const entry = manifest[key]
      if (!entry || lines.has(key)) continue
      // Only clips (`.mp3` files inside the clips folder); anything else is left as it is.
      if (!SAFE_CLIP.test(entry.file) || !entry.file.endsWith('.mp3')) continue
      delete manifest[key]
      // The file goes only if no other line still uses it.
      const stillUsed = Object.values(manifest).some((other) => other.file === entry.file)
      if (!stillUsed) {
        await rm(resolveInRoot(root, join(read.paths.clipsPath, entry.file)), { force: true })
      }
      delete lock[key]
      removed++
    }
    if (removed) {
      await writeAtomic(root, read.paths.manifestPath, `${pythonJson(sorted(manifest))}\n`)
      await writeAtomic(root, read.paths.lockPath, formatEntriesPerLine(lock))
    }
    return removed
  })
}

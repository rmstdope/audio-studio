import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spreadWords } from '../core/align'
import { clipInputs, fingerprint } from '../core/fingerprint'
import { resolveInRoot } from '../core/paths'
import type { Problem } from '../core/project'
import { pythonJson } from '../core/pyjson'
import { LockSchema, ManifestSchema, type Lock, type Manifest } from '../core/resources'
import { chunkText, spokenText } from '../core/spoken'
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
  | { ok: false; reason: 'uncast' | 'no-key' | 'fish' | 'audio' | 'encode'; message: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/** How lines are recorded: the encoder (ffmpeg unless replaced, in tests) and the Fish limiter. */
export interface RecordOptions {
  encode?: Encoder
  limiter: Limiter
}

/**
 * Records one line: its text in sentence-sized pieces, each spoken by Fish in the speaker's voice
 * with its cue (the draft model), joined with a short pause, encoded as the project's output; then
 * the clip's manifest entry (with the words spread over it until clips are transcribed) and its
 * lock entry are written. The clip, manifest and lock change only together: nothing is written
 * unless the clip was made and both files could be read. At most
 * `quality.parallel` lines are recorded at once, and a line already being recorded is not
 * recorded twice.
 */
export async function recordLine(
  projectFile: string,
  partId: string,
  key: string,
  fishFor: FishFactory,
  { encode = ffmpegEncoder, limiter }: RecordOptions,
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

  return limiter.run(`${projectFile}\n${partId}\n${key}`, narration.quality.parallel, async () => {
    let clip: { wav: Uint8Array; seconds: number }
    const pieces: Uint8Array[] = []
    try {
      for (const chunk of chunkText(line.text, narration.quality.chunkLimit)) {
        pieces.push(
          await fish.tts({
            text: spokenText(chunk, inputs.cue, cast.pronounce),
            voice: inputs.voice,
            model: inputs.model,
            temperature: narration.tts.temperature,
            topP: narration.tts.topP,
            speed: narration.tts.speed,
            format: 'wav',
          }),
        )
      }
    } catch (error) {
      return { ok: false, reason: 'fish', message: messageOf(error) }
    }
    try {
      clip = joinWavs(pieces, GAP_SECONDS)
    } catch (error) {
      return {
        ok: false,
        reason: 'audio',
        message: `Fish sent audio that could not be joined: ${messageOf(error)}`,
      }
    }

    // Encoded beside the clip under a hidden name (never served, never a stray clip), and only
    // moved into place once the manifest and lock can be written too.
    const file = `${key}.mp3`
    const target = resolveInRoot(root, join(read.paths.clipsPath, file))
    const temporary = resolveInRoot(root, join(read.paths.clipsPath, `.${key}.${randomUUID()}.mp3`))
    try {
      await encode(clip.wav, temporary, narration.output)
    } catch (error) {
      await rm(temporary, { force: true })
      return { ok: false, reason: 'encode', message: messageOf(error) }
    }

    const duration = Math.round(clip.seconds * 1000) / 1000
    const { fp, parts } = fingerprint(inputs)
    const problems = await inPartTurn(projectFile, partId, async () => {
      // Read again in the part's turn: other lines may have been written meanwhile.
      const found: Problem[] = []
      const manifest = await manifestNow(root, read.paths.manifestPath, found)
      const lock = await lockNow(root, read.paths.lockPath, found)
      if (!manifest || !lock) {
        await rm(temporary, { force: true })
        return found
      }
      await rename(temporary, target)
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
      await writeAtomic(root, read.paths.manifestPath, `${pythonJson(sorted(manifest))}\n`)
      await writeAtomic(root, read.paths.lockPath, formatEntriesPerLine(lock))
      return []
    })
    if (problems.length) return { ok: false, problems }
    return { ok: true, key, duration }
  })
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

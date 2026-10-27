import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  alignWords,
  heardWords,
  knownNames,
  pyRound,
  saidWords,
  soundAlikes,
  type HeardSegment,
  type TimedWord,
} from '../core/align'
import { clipInputs, fingerprint, type ClipInputs } from '../core/fingerprint'
import { languageName } from '../core/languages'
import { planPart } from '../core/planner'
import { resolveInRoot } from '../core/paths'
import type { Problem, Project } from '../core/project'
import { pythonJson } from '../core/pyjson'
import {
  LockSchema,
  ManifestSchema,
  ttsFor,
  type Cast,
  type Character,
  type Line,
  type Lock,
  type Manifest,
} from '../core/resources'
import { FREE_MODELS } from '../core/project'
import { createBudget, type Budget } from '../core/spend'
import { spokenPieces } from '../core/spoken'
import { joinWavs } from '../core/wav'
import type { FishFactory } from './auditions'
import { decodeClip, ffmpegEncoder, type Encoder } from './audio'
import { formatEntriesPerLine, readResource, writeAtomic } from './files'
import type { Limiter } from './limit'
import type { Transcriber } from './transcriber'
import { keepHeard } from './heard'
import { inPartTurn } from './partFiles'
import { readPart, type Ears, type ProjectFailure } from './workspace'
import { NO_KEY } from './fish'
import type { ElevenLabsClient } from './elevenlabs'
import { ELEVEN_TTS, modelForStage, speedProblem, takesLanguage } from '../core/elevenSpeech'
import { providerId, providerOf } from '../core/voices'

/** Seconds of silence between the pieces of a long line (as in RetroQuest's narrate.py). */
export const GAP_SECONDS = 0.25

/** A recorded line, or why it was not recorded. Null for an unknown part or line. */
export type RecordResult =
  /** Recorded; with how well the kept take was heard, and how many takes it took, when checked. */
  | { ok: true; key: string; duration: number; heard?: number; takes?: number }
  /** Asked to record only if needed, and the line is up to date by now: nothing was done. */
  | { ok: true; key: string; skipped: true }
  | {
      ok: false
      reason:
        | 'uncast'
        | 'untranslated'
        | 'no-key'
        | 'speed'
        | 'spend'
        | 'fish'
        | 'audio'
        | 'transcribe'
        | 'encode'
        | 'write'
      message: string
    }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/** The budget of a recording given none: the free model only. */
const FREE_ONLY = createBudget({ model: FREE_MODELS[0], dollars: 0 })

/** A request to Fish refused by the recording's budget. */
class SpendRefused extends Error {}

/** Recordings in progress, by project, part and line. */
const recordings = new Map<string, Promise<RecordResult>>()

/** How lines are recorded: the encoder (ffmpeg unless replaced, in tests) and the Fish limiter. */
export interface RecordOptions {
  encode?: Encoder
  limiter: Limiter
  /**
   * Record the line only if it still needs it when its turn comes: missing or stale, or weak with
   * `retakeWeak` (a job's lines may have been recorded or adopted meanwhile), so a job never pays
   * for a line twice, nor retakes a line that became weak meanwhile unless asked to.
   */
  onlyIfNeeded?: boolean
  /** With `onlyIfNeeded`: weak lines need recording too (the user chose to retake them). */
  retakeWeak?: boolean
  /**
   * Which model records: the `draft` one (default), or the `final` one. With `onlyIfNeeded`, a
   * final recording needs every line whose clip is not final yet.
   */
  stage?: 'draft' | 'final'
  /**
   * What the recording may spend: the confirmed model and dollars, charged before every request
   * to Fish at that moment's price. Without it only the free model can be used.
   */
  budget?: Budget
  /** Checks each take (unless the project's `quality.transcriber` is "none"); none: unchecked. */
  transcriber?: Transcriber | null
  /** The language to record (the source language when absent or not declared). */
  language?: string
  /** The ElevenLabs client for a line with an ElevenLabs voice: none, and such a line is refused. */
  elevenlabs?: ElevenLabsFactory
}

/** The ElevenLabs client for a project, or null when it has no key. Replaced in tests. */
export type ElevenLabsFactory = (root: string, project: Project) => Promise<ElevenLabsClient | null>

/** What the studio says when a line needs ElevenLabs and there is no key. */
export const NO_ELEVENLABS_KEY =
  'Set ELEVENLABS_API_KEY in the project’s env file, or in the environment.'

/** Speaks one piece of a line's text in its voice: its audio as WAV. */
export type Speak = (text: string) => Promise<Uint8Array>

/**
 * What speaks a line's pieces: its voice's provider, Fish with its temperature, top-p and speed,
 * or ElevenLabs with its voice settings, the speed and the language; or why it cannot (no key for
 * that provider, or a speed ElevenLabs does not take).
 */
export async function speakerFor({
  root,
  project,
  inputs,
  character,
  language,
  fishFor,
  elevenlabs = async () => null,
}: {
  root: string
  project: Project
  inputs: ClipInputs
  character: Character | undefined
  language: string
  fishFor: FishFactory
  elevenlabs?: ElevenLabsFactory
}): Promise<
  { ok: true; speak: Speak } | { ok: false; reason: 'no-key' | 'speed'; message: string }
> {
  const tts = ttsFor(project.narration.tts, character)
  if (providerOf(inputs.voice) === 'elevenlabs') {
    const slow = speedProblem(tts.speed)
    if (slow) return { ok: false, reason: 'speed', message: slow }
    const client = await elevenlabs(root, project)
    if (!client) return { ok: false, reason: 'no-key', message: NO_ELEVENLABS_KEY }
    const settings = { ...ELEVEN_TTS, speed: tts.speed }
    return {
      ok: true,
      speak: (text) =>
        client.tts({
          text,
          voice: providerId(inputs.voice),
          model: inputs.model,
          settings,
          ...(takesLanguage(inputs.model) && { language }),
        }),
    }
  }
  const fish = await fishFor(root, project)
  if (!fish) return { ok: false, reason: 'no-key', message: NO_KEY }
  return {
    ok: true,
    speak: (text) =>
      fish.tts({ text, voice: inputs.voice, model: inputs.model, ...tts, format: 'wav' }),
  }
}

/**
 * One take of a line: its joined audio, its word timings, and the share of words heard. Made by
 * `speakLine` and `checkTake`, kept by a recording or as one of a line's extra takes.
 */
export interface Take {
  clip: { wav: Uint8Array; seconds: number }
  timed: TimedWord[]
  /** Null when takes are not checked. */
  heard: number | null
  /** What Whisper heard, and the shown words it missed (none when not checked). */
  words: string[]
  missed: number[]
}

/**
 * Records one line: its text in sentence-sized pieces, each spoken by Fish in the speaker's voice
 * with its cue (the draft model), joined with a short pause, encoded as the project's output; then
 * the clip's manifest entry (with Whisper's word timings, or spread evenly when takes are not checked) and its
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
  {
    encode = ffmpegEncoder,
    limiter,
    onlyIfNeeded = false,
    retakeWeak = false,
    transcriber = null,
    budget = FREE_ONLY,
    stage = 'draft',
    language,
    elevenlabs,
  }: RecordOptions,
): Promise<RecordResult> {
  const read = await readPart(projectFile, partId, language)
  if (!read || !read.ok) return read
  if (read.problems.length) return { ok: false, problems: read.problems }
  const line = read.input.lines.find((l) => l.key === key)
  if (!line || line.text.trim() === '') {
    return planPart(read.input).lines.some((l) => l.key === key && l.status === 'untranslated')
      ? {
          ok: false,
          reason: 'untranslated',
          message: `${key} has no ${languageName(read.language)} text yet; translate it first.`,
        }
      : null
  }
  const { cast, cues } = read.input
  const { narration } = read.project
  // With one model for both, there is no final step: a "final" recording is a draft one. The
  // stages are the voice's provider's.
  const voice = cast.speakers[line.speaker]?.voice ?? ''
  const draftModel = modelForStage(narration, voice, 'draft')
  const finalModel = modelForStage(narration, voice, 'final')
  const final = stage === 'final' && finalModel !== draftModel
  const model = final ? finalModel : draftModel
  // In a draft recording: the fingerprint the line would have as a final clip, so one that lands
  // meanwhile is never overwritten.
  const finalFp = final ? null : finalFingerprint(line, cast, cues, narration)
  const inputs = clipInputs(
    line,
    cast.speakers[line.speaker],
    cues,
    cast.pronounce,
    narration,
    model,
  )
  if (!inputs) {
    return {
      ok: false,
      reason: 'uncast',
      message: `${line.speaker} has no voice yet; cast one first.`,
    }
  }
  const root = dirname(projectFile)
  const speaker = await speakerFor({
    root,
    project: read.project,
    inputs,
    character: cast.speakers[line.speaker],
    language: read.language,
    fishFor,
    elevenlabs,
  })
  if (!speaker.ok) return speaker
  const { speak } = speaker

  // The same line asked for again while it is being recorded shares that recording.
  // Per model too: a final recording never takes a draft one's result as its own.
  const id = `${projectFile}\n${partId}\n${read.language}\n${key}\n${model}`
  const running = recordings.get(id)
  if (running) return running
  const recording = record()
  recordings.set(id, recording)
  const forget = () => recordings.delete(id)
  recording.then(forget, forget)
  return recording

  /** One take: the line spoken by its voice's provider (holding a slot only while speaking), joined. */
  async function makeTake(take: number): Promise<Spoken> {
    if (!inputs || !line) {
      return { ok: false, reason: 'fish', message: 'nothing to speak' }
    }
    return speakLine({
      speak,
      line,
      inputs,
      cast,
      narration,
      budget,
      limiter,
      limiterKey: `line\n${id}\n${take}`,
    })
  }

  async function record(): Promise<RecordResult> {
    if (!inputs || !read || !read.ok || !line) return null
    if (onlyIfNeeded) {
      // Checked only now that this recording is registered: a recording of the same line that
      // finished meanwhile has written its files before leaving, so it is seen here.
      const fresh = await readPart(projectFile, partId, language)
      if (!fresh || !fresh.ok) return fresh
      const now = planPart(fresh.input).lines.find((l) => l.key === key)
      const status = now?.status
      if (status === 'uncast') {
        return {
          ok: false,
          reason: 'uncast',
          message: `${line.speaker} has no voice yet; cast one first.`,
        }
      }
      const weak = status === 'weak' && retakeWeak
      const needed = final
        ? !now?.final || weak
        : // A final clip is never taken back to the draft model by a retake.
          status === 'missing' || status === 'stale' || (weak && !now?.final)
      if (!needed) {
        return { ok: true, key, skipped: true }
      }
    }
    // Takes until one is heard well enough (up to quality.takes), keeping the best: as narrate.py.
    const checker = narration.quality.transcriber === 'none' ? null : transcriber
    let best: Take | null = null
    let takes = 0
    for (let take = 1; take <= (checker ? narration.quality.takes : 1); take++) {
      const made = await makeTake(take)
      // A later take that cannot be made keeps the best one already paid for.
      if (!made.ok) {
        if (best) break
        return made
      }
      let attempt: Take
      try {
        attempt = await checkTake(checker, made.clip, line, cast, narration, read.ears)
      } catch (error) {
        if (best) break
        return { ok: false, reason: 'transcribe', message: messageOf(error) }
      }
      takes = take
      if (!best || (attempt.heard ?? 0) > (best.heard ?? 0)) best = attempt
      if (attempt.heard === null || attempt.heard >= narration.quality.minHeard) break
    }
    if (!best) return null
    return commitClip({
      projectFile,
      partId,
      line,
      inputs,
      paths: read.paths,
      cacheName: read.cacheName,
      narration,
      encode,
      take: best,
      takes,
      finalFp,
    })
  }
}

/** A line spoken by Fish: its joined audio, or why not. */
export type Spoken =
  | { ok: true; clip: { wav: Uint8Array; seconds: number } }
  | { ok: false; reason: 'spend' | 'fish' | 'audio'; message: string }

/**
 * The fingerprint a line's clip would have made with the final model, when that differs from the
 * draft one: a draft recording (or an extra take) must never write over such a clip. Null with
 * one model for both, or for an uncast line.
 */
export function finalFingerprint(
  line: Line,
  cast: Cast,
  cues: Record<string, string>,
  narration: Project['narration'],
): string | null {
  const voice = cast.speakers[line.speaker]?.voice ?? ''
  const finalModel = modelForStage(narration, voice, 'final')
  if (finalModel === modelForStage(narration, voice, 'draft')) return null
  const inputs = clipInputs(
    line,
    cast.speakers[line.speaker],
    cues,
    cast.pronounce,
    narration,
    finalModel,
  )
  return inputs ? fingerprint(inputs).fp : null
}

/**
 * Has Fish speak a line once: each sentence-sized piece in the speaker's voice with the cue, at the
 * character's settings, charged to the budget before it is sent, holding a Fish slot (`limiter`,
 * under `limiterKey`) only while speaking; the pieces joined with a short pause.
 */
export async function speakLine({
  speak,
  line,
  inputs,
  cast,
  narration,
  budget,
  limiter,
  limiterKey,
}: {
  speak: Speak
  line: Line
  inputs: ClipInputs
  cast: Cast
  narration: Project['narration']
  budget: Budget
  limiter: Limiter
  limiterKey: string
}): Promise<Spoken> {
  let pieces: Uint8Array[]
  try {
    pieces = await limiter.run(limiterKey, narration.quality.parallel, async () => {
      const spoken: Uint8Array[] = []
      const texts = spokenPieces(
        line.text,
        inputs.cue,
        cast.pronounce,
        narration.quality.chunkLimit,
        inputs.inside,
      )
      for (const text of texts) {
        // Charged before it is sent: nothing beyond what was confirmed reaches the provider.
        const refused = budget.spend(inputs.model, text, new Date())
        if (refused) throw new SpendRefused(refused)
        spoken.push(await speak(text))
      }
      return spoken
    })
  } catch (error) {
    const reason = error instanceof SpendRefused ? 'spend' : 'fish'
    return { ok: false, reason, message: messageOf(error) }
  }
  try {
    return { ok: true, clip: joinWavs(pieces, GAP_SECONDS) }
  } catch (error) {
    const provider = providerOf(inputs.voice) === 'elevenlabs' ? 'ElevenLabs' : 'Fish'
    const message = `${provider} sent audio that could not be joined: ${messageOf(error)}`
    return { ok: false, reason: 'audio', message }
  }
}

/**
 * A spoken line as a take: checked by Whisper (`checker`) and its words aligned to the text, with
 * the share heard rounded as the lock keeps it; or, without a checker, the words spread evenly over
 * the clip and no score. Throws what Whisper throws.
 */
export async function checkTake(
  checker: Transcriber | null,
  clip: { wav: Uint8Array; seconds: number },
  line: Line,
  cast: Cast,
  narration: Project['narration'],
  ears: Ears = {
    language: undefined,
    alike: soundAlikes(narration.quality.soundAlike),
    capitalNouns: false,
  },
): Promise<Take> {
  const tokens = line.text.split(' ')
  if (!checker) {
    const timed = alignWords(tokens, [], clip.seconds).timed
    return { clip, timed, heard: null, words: [], missed: [] }
  }
  const segments = await transcribeWav(
    checker,
    narration.quality.whisperModel,
    clip.wav,
    ears.language,
  )
  const words = heardWords(segments, clip.seconds)
  const said = saidWords(line.text, cast.pronounce)
  const aligned = alignWords(
    tokens,
    words,
    clip.seconds,
    said,
    knownNames(cast),
    ears.alike,
    ears.capitalNouns,
  )
  return {
    clip,
    timed: aligned.timed,
    heard: pyRound(aligned.ratio),
    words: words.map((w) => w.word.trim()),
    missed: aligned.missed,
  }
}

/**
 * Makes a take the line's clip: encoded beside the clip under a hidden name (never served, never a
 * stray clip) and moved into place only in the part's turn, once the manifest and lock could be
 * read, with the manifest entry (the take's word timings) and the lock entry (`takes` tried, the
 * share heard) written after it. The lock last: if anything fails before it, the line shows as
 * stale or untracked, never as up to date. With `finalFp`, a final clip of the line that landed
 * meanwhile is kept and the take dropped (`skipped`).
 */
export async function commitClip({
  projectFile,
  partId,
  line,
  inputs,
  paths,
  cacheName = partId,
  narration,
  encode,
  take,
  takes,
  finalFp,
}: {
  projectFile: string
  partId: string
  line: Line
  inputs: ClipInputs
  paths: { clipsPath: string; manifestPath: string; lockPath: string }
  /** What names the part's own files in the tool cache: the part's id, with the language besides the source. */
  cacheName?: string
  narration: Project['narration']
  encode: Encoder
  take: Take
  takes: number
  finalFp: string | null
}): Promise<RecordResult> {
  const root = dirname(projectFile)
  const { key } = line
  const { clip } = take
  const file = `${key}.mp3`
  const target = resolveInRoot(root, join(paths.clipsPath, file))
  const temporary = resolveInRoot(root, join(paths.clipsPath, `.${key}.${randomUUID()}.mp3`))
  try {
    await encode(clip.wav, temporary, narration.output)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    return { ok: false, reason: 'encode', message: messageOf(error) }
  }

  const duration = pyRound(clip.seconds)
  const { fp, parts } = fingerprint(inputs)
  try {
    const problems = await inPartTurn(
      projectFile,
      partId,
      async (): Promise<Problem[] | 'final'> => {
        // Read again in the part's turn: other lines may have been written meanwhile.
        const found: Problem[] = []
        const manifest = await manifestNow(root, paths.manifestPath, found)
        const lock = await lockNow(root, paths.lockPath, found)
        if (!manifest || !lock) return found
        // A final clip of the line landed while this draft was made: it is kept, paid for.
        if (finalFp && lock[key]?.fp === finalFp) return 'final'
        manifest[key] = {
          file,
          speaker: line.speaker,
          duration,
          words: take.timed,
        }
        const at = new Date().toISOString()
        lock[key] = {
          fp,
          voice: inputs.voice,
          model: inputs.model,
          parts,
          takes,
          ...(take.heard === null ? {} : { heard: take.heard }),
          at,
        }
        await rename(temporary, target)
        await writeAtomic(root, paths.manifestPath, `${pythonJson(sorted(manifest))}\n`)
        await writeAtomic(root, paths.lockPath, formatEntriesPerLine(lock))
        await keepWhatWasHeard(projectFile, cacheName, key, { ...take, at, text: line.text })
        return []
      },
    )
    if (problems === 'final') return { ok: true, key, skipped: true }
    if (problems.length) return { ok: false, problems }
    return take.heard === null
      ? { ok: true, key, duration }
      : { ok: true, key, duration, heard: take.heard, takes }
  } catch (error) {
    return { ok: false, reason: 'write', message: messageOf(error) }
  } finally {
    // Gone already once renamed; otherwise never left behind.
    await rm(temporary, { force: true }).catch(() => {})
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

/**
 * Keeps what Whisper heard of a take heard below full, for the page to show beside the text, or
 * forgets what was kept (heard in full); nothing for an unchecked take. The studio's own state, not
 * the game's: failing to keep it fails nothing, the clip and its lock entry are written already.
 */
async function keepWhatWasHeard(
  projectFile: string,
  name: string,
  key: string,
  take: { heard: number | null; at: string; text: string; words: string[]; missed: number[] },
): Promise<void> {
  const { heard, at, text, words, missed } = take
  if (heard === null) return
  const line = heard < 1 ? { at, text, words, missed } : null
  await keepHeard(projectFile, name, key, line).catch(() => {})
}

/** What Whisper heard in a WAV: written to a temporary file outside the game, then removed. */
async function transcribeWav(
  transcriber: Transcriber,
  model: string,
  wav: Uint8Array,
  language?: string,
): Promise<HeardSegment[]> {
  const file = join(tmpdir(), `audio-studio-heard-${randomUUID()}.wav`)
  await writeFile(file, wav)
  try {
    return await transcriber.transcribe(model, file, language)
  } finally {
    await rm(file, { force: true }).catch(() => {})
  }
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
  language?: string,
): Promise<number> {
  return inPartTurn(projectFile, partId, async () => {
    const read = await readPart(projectFile, partId, language)
    if (!read || !read.ok) return 0
    if (read.problems.length) {
      throw new Error(read.problems.map((p) => `${p.file}: ${p.message}`).join('; '))
    }
    // Without a readable dialog nothing is known to be orphaned: the last check before deleting.
    if (read.input.held) return 0
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

/** An accepted line, or why it was not. Null for an unknown part or line. */
export type AcceptResult =
  | { ok: true; key: string }
  | { ok: false; reason: 'not-weak'; message: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/**
 * Accepts a weak line's clip as it is: its lock entry is marked `accepted`, so the line no longer
 * shows as weak, until it is recorded again (recording writes a new entry). Only a line weak now,
 * read afresh in the part's turn, is accepted.
 */
export async function acceptLine(
  projectFile: string,
  partId: string,
  key: string,
  language?: string,
): Promise<AcceptResult> {
  return inPartTurn(projectFile, partId, async (): Promise<AcceptResult> => {
    const read = await readPart(projectFile, partId, language)
    if (!read || !read.ok) return read
    if (read.problems.length) return { ok: false, problems: read.problems }
    const state = planPart(read.input).lines.find((l) => l.key === key)
    if (!state) return null
    const entry = read.input.lock[key]
    if (state.status !== 'weak' || !entry) {
      return { ok: false, reason: 'not-weak', message: 'Only a weak line can be accepted.' }
    }
    const lock = { ...read.input.lock, [key]: { ...entry, accepted: true } }
    await writeAtomic(dirname(projectFile), read.paths.lockPath, formatEntriesPerLine(lock))
    return { ok: true, key }
  })
}

/** A measured clip, or why it was not measured. Null for an unknown part or line. */
export type MeasureResult =
  | { ok: true; key: string; heard: number; duration: number }
  | { ok: true; key: string; skipped: true }
  | { ok: false; reason: 'not-recorded' | 'unchecked' | 'decode' | 'transcribe'; message: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/** How clips are measured: Whisper, and how a clip is decoded to WAV (ffmpeg unless replaced). */
export interface MeasureOptions {
  transcriber: Transcriber | null
  /** Check a clip Whisper already checked again (Check again), with the rules of today. */
  again?: boolean
  /** In a job: a line that no longer needs it when its turn comes is skipped, not refused. */
  onlyIfNeeded?: boolean
  /** The language of the clip (the source language when absent or not declared). */
  language?: string
  decode?: (file: string) => Promise<{ wav: Uint8Array; seconds: number }>
}

/**
 * Measures a recorded clip without new audio (narrate.py `--retime`): its length from the decoded
 * audio, what Whisper hears in it, the words aligned. The manifest gets the word timings and
 * length, the lock how well the clip is heard, so a clip heard poorly shows as weak. Only
 * up-to-date clips never measured are, or, `again`, weak lines, scored with the rules of today;
 * nothing is written if the clip was recorded again meanwhile (its lock entry's time changed).
 */
export async function measureLine(
  projectFile: string,
  partId: string,
  key: string,
  {
    transcriber,
    decode = decodeClip,
    again = false,
    onlyIfNeeded = false,
    language,
  }: MeasureOptions,
): Promise<MeasureResult> {
  const read = await readPart(projectFile, partId, language)
  if (!read || !read.ok) return read
  if (read.problems.length) return { ok: false, problems: read.problems }
  const line = read.input.lines.find((l) => l.key === key)
  if (!line) return null
  const { narration } = read.project
  if (narration.quality.transcriber === 'none' || !transcriber) {
    return {
      ok: false,
      reason: 'unchecked',
      message: 'Clips are not checked (quality.transcriber is "none").',
    }
  }
  const state = planPart(read.input).lines.find((l) => l.key === key)
  const entry = read.input.manifest[key]
  const before = read.input.lock[key]
  // What plans offer: up-to-date clips never measured (adopted, or recorded unchecked); asked
  // again, weak lines (an accepted one is ok as it is).
  const checked = before?.heard !== undefined
  const fits = again ? state?.status === 'weak' : state?.status === 'ok' && !checked
  if (!fits || !entry || !before) {
    // Accepted, checked or recorded again since the job began: nothing left to do for it.
    if (onlyIfNeeded && state) return { ok: true, key, skipped: true }
    return {
      ok: false,
      reason: 'not-recorded',
      message: again
        ? 'Only a weak line can be checked again.'
        : 'Only up-to-date clips never checked by Whisper can be measured.',
    }
  }
  const root = dirname(projectFile)
  const clip = resolveInRoot(root, join(read.paths.clipsPath, entry.file))

  let decoded: { wav: Uint8Array; seconds: number }
  try {
    decoded = await decode(clip)
  } catch (error) {
    return { ok: false, reason: 'decode', message: messageOf(error) }
  }
  const { seconds } = decoded
  let aligned: { timed: TimedWord[]; ratio: number; missed: number[] }
  let words: string[]
  try {
    // The decoded WAV, as narrate.py --retime transcribes it, so the timings come out the same.
    const segments = await transcribeWav(
      transcriber,
      narration.quality.whisperModel,
      decoded.wav,
      read.ears.language,
    )
    const said = saidWords(line.text, read.input.cast.pronounce)
    const heardNow = heardWords(segments, seconds)
    const names = knownNames(read.input.cast)
    const alike = read.ears.alike
    aligned = alignWords(
      line.text.split(' '),
      heardNow,
      seconds,
      said,
      names,
      alike,
      read.ears.capitalNouns,
    )
    words = heardNow.map((w) => w.word.trim())
  } catch (error) {
    return { ok: false, reason: 'transcribe', message: messageOf(error) }
  }
  const duration = pyRound(seconds)
  const heard = pyRound(aligned.ratio)

  const result = await inPartTurn(projectFile, partId, async (): Promise<MeasureResult> => {
    const found: Problem[] = []
    const manifest = await manifestNow(root, read.paths.manifestPath, found)
    const lock = await lockNow(root, read.paths.lockPath, found)
    if (!manifest || !lock) return { ok: false, problems: found }
    const now = manifest[key]
    const locked = lock[key]
    // Recorded again while it was being measured: the new clip is measured by its own recording.
    if (!now || !locked || now.file !== entry.file || locked.at !== before.at) {
      return { ok: true, key, skipped: true }
    }
    manifest[key] = { ...now, duration, words: aligned.timed }
    lock[key] = { ...locked, heard }
    await writeAtomic(root, read.paths.manifestPath, `${pythonJson(sorted(manifest))}\n`)
    await writeAtomic(root, read.paths.lockPath, formatEntriesPerLine(lock))
    await keepWhatWasHeard(projectFile, read.cacheName, key, {
      heard,
      at: locked.at,
      text: line.text,
      words,
      missed: aligned.missed,
    })
    return { ok: true, key, heard, duration }
  })
  return result
}

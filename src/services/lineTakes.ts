import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { clipInputs, fingerprint, type ClipInputs } from '../core/fingerprint'
import { LineTakeSchema, takesView, type LineTake, type LineTakeView } from '../core/lineTakes'
import { resolveInRoot } from '../core/paths'
import { partCacheName, type Problem } from '../core/project'
import type { Line } from '../core/resources'
import { createBudget, type Budget, type SpendProblem } from '../core/spend'
import type { FishFactory } from './auditions'
import { ffmpegEncoder, type Encoder } from './audio'
import { characterFile, listFiles, readJson, writeAtomic } from './files'
import type { Limiter } from './limit'
import {
  checkTake,
  commitClip,
  finalFingerprint,
  speakLine,
  speakerFor,
  type RecordResult,
} from './narration'
import type { ElevenLabsFactory } from './elevenlabs'
import type { Transcriber } from './transcriber'
import { DEFAULT_ELEVEN_MODEL } from '../core/elevenSpeech'
import { providerOf } from '../core/voices'
import { openProject, readPart, type PartRead, type ProjectFailure } from './workspace'

/** The ElevenLabs budget of a take given none: nothing may be spent. */
const NO_CREDITS = createBudget({ model: DEFAULT_ELEVEN_MODEL, dollars: 0 })

/** Where a line's extra takes are kept, in the project's tool cache: a folder per part and line. */
const LINE_TAKES_DIR = '.audio-studio/line-takes'

/** A line's extra takes, newest first, or why they cannot be listed. Null for an unknown part or line. */
export type LineTakesResult =
  { ok: true; takes: LineTakeView[] } | { ok: false; problems: Problem[] } | ProjectFailure | null

/** A new take of a line, or why there is none. Null for an unknown part or line. */
export type TakeLineResult =
  | { ok: true; take: LineTakeView }
  | {
      ok: false
      reason: 'uncast' | 'no-key' | 'speed' | 'spend' | 'fish' | 'audio' | 'transcribe'
      message: string
    }
  | { ok: false; problems: Problem[] }
  | (SpendProblem & { ok: false })
  | ProjectFailure
  | null

/** Making a take the line's clip: as a recording, or refused because the take is stale. */
export type UseTakeResult = RecordResult | { ok: false; reason: 'stale' | 'final'; message: string }

/**
 * A line's extra takes: the ones the user asked for from the lines page, to compare and choose
 * from, each marked current when made from the line's inputs as they are now.
 */
export async function listLineTakes(
  projectFile: string,
  partId: string,
  key: string,
  language?: string,
): Promise<LineTakesResult> {
  const found = await lineAndInputs(projectFile, partId, key, language)
  if (found.kind === 'problems') return { ok: false, problems: found.problems }
  if (found.kind === 'failed') return found.failure
  const takes = await readTakes(dirname(projectFile), found.read.cacheName, key)
  return { ok: true, takes: takesView(takes, found.fp) }
}

/**
 * Records one more take of a line into the tool cache, with the draft model, charged to `budget`
 * (a zero one for the free model; a paid model's is what the user confirmed), or to `credits` for
 * a line with an ElevenLabs voice, checked by Whisper
 * when the project checks takes. The take is kept as a WAV beside what was made of it; nothing
 * of the game's is written
 * until the user chooses it (`useLineTake`).
 */
export async function takeLine(
  projectFile: string,
  partId: string,
  key: string,
  fishFor: FishFactory,
  {
    limiter,
    elevenLimiter = limiter,
    transcriber = null,
    budget,
    credits = NO_CREDITS,
    language,
    elevenlabs,
  }: {
    /** Fish's limiter, and ElevenLabs' (Fish's when absent): a take waits for its provider's. */
    limiter: Limiter
    elevenLimiter?: Limiter
    transcriber?: Transcriber | null
    /** What a Fish line's take may spend, in dollars. */
    budget: Budget
    /** What an ElevenLabs line's take may spend, in credits; none when absent. */
    credits?: Budget
    language?: string
    /** The ElevenLabs client, for a line with an ElevenLabs voice. */
    elevenlabs?: ElevenLabsFactory
  },
): Promise<TakeLineResult> {
  const found = await lineAndInputs(projectFile, partId, key, language)
  if (found.kind === 'problems') return { ok: false, problems: found.problems }
  if (found.kind === 'failed') return found.failure
  const { read, line, inputs, fp } = found
  if (!inputs) {
    return {
      ok: false,
      reason: 'uncast',
      message: `${line.speaker} has no voice yet; cast one first.`,
    }
  }
  const { narration } = read.project
  const root = dirname(projectFile)
  const speaker = await speakerFor({
    root,
    project: read.project,
    inputs,
    character: read.input.cast.speakers[line.speaker],
    language: read.language,
    fishFor,
    elevenlabs,
  })
  if (!speaker.ok) return speaker
  const id = randomBytes(8).toString('hex')
  const eleven = providerOf(inputs.voice) === 'elevenlabs'
  const spoken = await speakLine({
    speak: speaker.speak,
    line,
    inputs,
    cast: read.input.cast,
    narration,
    budget: eleven ? credits : budget,
    limiter: eleven ? elevenLimiter : limiter,
    limiterKey: `line-take\n${projectFile}\n${partId}\n${read.language}\n${key}\n${id}`,
  })
  if (!spoken.ok) return spoken
  const checker = narration.quality.transcriber === 'none' ? null : transcriber
  let checked
  try {
    checked = await checkTake(checker, spoken.clip, line, read.input.cast, narration, read.ears)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'transcribe', message }
  }
  const take: LineTake = {
    version: 1,
    id,
    at: new Date().toISOString(),
    fp,
    model: inputs.model,
    seconds: checked.clip.seconds,
    heard: checked.heard,
    timed: checked.timed,
    words: checked.words,
    missed: checked.missed,
  }
  const folder = takesFolder(read.cacheName, key)
  // The WAV first: a take file without its audio would be listed but could not be heard.
  await writeAtomic(root, `${folder}/${id}.wav`, checked.clip.wav)
  await writeAtomic(root, `${folder}/${id}.json`, `${JSON.stringify(take, null, 1)}\n`)
  return { ok: true, take: takesView([take], fp)[0]! }
}

/**
 * Makes one of a line's extra takes its clip: encoded, levelled and written with the manifest and
 * lock exactly as a recording is, with the take's word timings and share heard. Refused for a
 * take made from other inputs than today's (the cue, the text or the voice changed since).
 */
export async function useLineTake(
  projectFile: string,
  partId: string,
  key: string,
  id: string,
  { encode = ffmpegEncoder, language }: { encode?: Encoder; language?: string } = {},
): Promise<UseTakeResult> {
  const found = await lineAndInputs(projectFile, partId, key, language)
  if (found.kind === 'problems') return { ok: false, problems: found.problems }
  if (found.kind === 'failed') return found.failure
  const { read, line, inputs, fp } = found
  if (!inputs) {
    return {
      ok: false,
      reason: 'uncast',
      message: `${line.speaker} has no voice yet; cast one first.`,
    }
  }
  const root = dirname(projectFile)
  const take = (await readTakes(root, read.cacheName, key)).find((t) => t.id === id)
  if (!take) return null
  // A take is a draft one: a final clip is never taken back to the draft model (§8.4).
  const { cast, cues, lock } = read.input
  const finalFp = finalFingerprint(line, cast, cues, read.project.narration)
  if (finalFp && lock[key]?.fp === finalFp) {
    return {
      ok: false,
      reason: 'final',
      message:
        'This line has a final clip, and a take is a draft one: it would replace the paid clip. Record the line again from its row with the final model instead.',
    }
  }
  if (take.fp !== fp) {
    return {
      ok: false,
      reason: 'stale',
      message:
        'This take was made before the line changed (its cue, text, voice or settings); take it again.',
    }
  }
  const wav = new Uint8Array(
    await Bun.file(
      resolveInRoot(root, `${takesFolder(read.cacheName, key)}/${id}.wav`),
    ).arrayBuffer(),
  )
  return commitClip({
    projectFile,
    partId,
    line,
    inputs,
    paths: read.paths,
    cacheName: read.cacheName,
    narration: read.project.narration,
    encode,
    take: {
      clip: { wav, seconds: take.seconds },
      timed: take.timed,
      heard: take.heard,
      words: take.words,
      missed: take.missed,
    },
    takes: 1,
    finalFp,
  })
}

/** Removes one of a line's extra takes from the cache. Null for an unknown part, line or take. */
export async function dropLineTake(
  projectFile: string,
  partId: string,
  key: string,
  id: string,
  language?: string,
): Promise<{ ok: true } | ProjectFailure | null> {
  const found = await lineAndInputs(projectFile, partId, key, language)
  // A take can be dropped though a file of the part is broken: it is the studio's own file.
  if (found.kind === 'failed') return found.failure
  const root = dirname(projectFile)
  // The name comes from the project file alone: the part's own files may be broken.
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const name = partCacheName(opened.project.narration, partId, language)
  const takes = await readTakes(root, name, key)
  if (!takes.some((t) => t.id === id)) return null
  const folder = takesFolder(name, key)
  await rm(resolveInRoot(root, `${folder}/${id}.json`), { force: true })
  await rm(resolveInRoot(root, `${folder}/${id}.wav`), { force: true })
  return { ok: true }
}

/** The WAV of one of a line's extra takes, or null if there is none (or the id is not one). */
export async function lineTakeFile(
  projectFile: string,
  partId: string,
  key: string,
  id: string,
  language?: string,
): Promise<string | null> {
  if (!/^[0-9a-f]{16}$/.test(id) || !/^[A-Za-z0-9_-]+$/.test(key)) return null
  const root = dirname(projectFile)
  const opened = await openProject(projectFile)
  if (!opened.ok) return null
  const name = partCacheName(opened.project.narration, partId, language)
  const file = resolveInRoot(root, `${takesFolder(name, key)}/${id}.wav`)
  return (await Bun.file(file).exists()) ? file : null
}

/**
 * The folder of a line's extra takes: a readable part name plus a hash, then the line's key. The
 * part is named by its cache name: its id, with the language besides the source.
 */
function takesFolder(name: string, key: string): string {
  return `${characterFile(LINE_TAKES_DIR, name).replace(/\.json$/, '')}/${key}`
}

/** The takes kept for a line, each as its file says; a file that does not fit is left out. */
async function readTakes(root: string, name: string, key: string): Promise<LineTake[]> {
  const folder = resolveInRoot(root, takesFolder(name, key))
  const takes: LineTake[] = []
  for (const name of await listFiles(folder)) {
    if (!name.endsWith('.json')) continue
    const json = await readJson(join(folder, name))
    if (json.status !== 'ok') continue
    const parsed = LineTakeSchema.safeParse(json.value)
    if (!parsed.success || name !== `${parsed.data.id}.json`) continue
    // A take whose audio is gone (a half-done drop, a hand clean-up) is not a take.
    if (await Bun.file(join(folder, `${parsed.data.id}.wav`)).exists()) takes.push(parsed.data)
  }
  return takes
}

/** A line found with its inputs as they are now, or why not. */
type Found =
  | {
      kind: 'found'
      read: PartRead
      line: Line
      inputs: ClipInputs | null
      /** The fingerprint of the inputs; empty for an uncast line. */
      fp: string
    }
  /** A file of the part cannot be read: the problems, with file and path. */
  | { kind: 'problems'; problems: Problem[] }
  /** The project file cannot be used, or (null) the part or line is unknown. */
  | { kind: 'failed'; failure: ProjectFailure | null }

/**
 * The part read, the line and its inputs as they are now (null when uncast) with their
 * fingerprint; or why not: a broken file of the part, the project file's failure, or null for an
 * unknown part or line.
 */
async function lineAndInputs(
  projectFile: string,
  partId: string,
  key: string,
  language?: string,
): Promise<Found> {
  const read = await readPart(projectFile, partId, language)
  if (!read || !read.ok) return { kind: 'failed', failure: read }
  // As a recording: any broken file of the part is reported, with its file and path.
  if (read.problems.length) return { kind: 'problems', problems: read.problems }
  const line = read.input.lines.find((l) => l.key === key)
  if (!line) return { kind: 'failed', failure: null }
  const { cast, cues } = read.input
  const inputs = clipInputs(
    line,
    cast.speakers[line.speaker],
    cues,
    cast.pronounce,
    read.project.narration,
  )
  return { kind: 'found', read, line, inputs, fp: inputs ? fingerprint(inputs).fp : '' }
}

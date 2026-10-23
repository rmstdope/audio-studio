import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  AuditionSessionSchema,
  addVoice,
  bringMore,
  finalist,
  queueMore,
  startSession,
  type AuditionSession,
} from '../core/audition'
import { resolveInRoot } from '../core/paths'
import type { Problem } from '../core/project'
import type { Appearance } from '../core/summary'
import type { AuditionText } from '../core/takes'
import { findCandidates, setVoice, type FishFactory } from './auditions'
import { readJson, writeAtomic } from './files'
import { createSerial } from './serial'
import { auditionTakes } from './takes'
import { loadPart, loadWorkspace, openProject, type ProjectFailure } from './workspace'

/** Where audition sessions are kept, in the project's tool cache. */
export const SESSIONS_DIR = '.audio-studio/auditions'

/** Why a session action did nothing. */
export type SessionFailure =
  | {
      ok: false
      reason: 'no-session' | 'no-key' | 'fish' | 'seen' | 'exhausted'
      message: string
    }
  | { ok: false; problems: Problem[] }
  | ProjectFailure

/** A session, or why there is none. Null for an unknown character. */
export type SessionResult = { ok: true; session: AuditionSession } | SessionFailure | null

/** Changes to one character's session, one at a time. */
const sessionWrites = createSerial()

/** The character's saved audition, or null when none is going on. */
export async function sessionFor(
  projectFile: string,
  characterId: string,
): Promise<{ ok: true; session: AuditionSession | null } | ProjectFailure | null> {
  const known = await knownCharacter(projectFile, characterId)
  if (known !== true) return known
  return { ok: true, session: await readSession(projectFile, characterId) }
}

/**
 * Starts (or starts over) a character's audition from a fresh search with its keywords: the
 * current voice and the top candidates in round 1, the rest queued.
 */
export function startAudition(
  projectFile: string,
  characterId: string,
  fishFor: FishFactory,
): Promise<SessionResult> {
  return sessionWrites.run(key(projectFile, characterId), async () => {
    const found = await findCandidates(projectFile, characterId, fishFor)
    if (!found || !found.ok) return found
    const session = startSession({
      character: characterId,
      keywords: found.keywords,
      current: found.current,
      candidates: found.candidates,
      perRound: found.perRound,
    })
    await writeSession(projectFile, characterId, session)
    return { ok: true, session }
  })
}

/**
 * Applies `change` to the character's saved session and saves the result; a change may instead
 * say why it did nothing, and then nothing is saved.
 */
export function changeSession(
  projectFile: string,
  characterId: string,
  change: (session: AuditionSession) => AuditionSession | Promise<AuditionSession | SessionFailure>,
): Promise<SessionResult> {
  return sessionWrites.run(key(projectFile, characterId), async () => {
    const known = await knownCharacter(projectFile, characterId)
    if (known !== true) return known
    const session = await readSession(projectFile, characterId)
    if (!session) {
      return {
        ok: false,
        reason: 'no-session',
        message: `There is no audition for ${characterId}; start one.`,
      }
    }
    const changed = await change(session)
    if ('ok' in changed) return changed
    await writeSession(projectFile, characterId, changed)
    return { ok: true, session: changed }
  })
}

/**
 * Brings a round's worth of new candidates into the current round: from the queue, searching
 * Fish again (with the keywords the audition started with, leaving out every voice it has shown)
 * when the queue is short. Says so when no new voice is left to find.
 */
export async function moreVoices(
  projectFile: string,
  characterId: string,
  fishFor: FishFactory,
): Promise<SessionResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const perRound = opened.project.narration.audition.candidatesPerRound
  return changeSession(projectFile, characterId, async (session) => {
    let next = session
    if (next.queue.length < perRound) {
      const found = await findCandidates(projectFile, characterId, fishFor, {
        keywords: session.keywords,
        exclude: [...session.pool, ...session.dropped, ...session.queue],
      })
      if (!found) return { ok: false, reason: 'fish', message: 'The character is gone.' }
      if (!found.ok) return found
      next = queueMore(next, found.candidates)
    }
    if (!next.queue.length) {
      return {
        ok: false,
        reason: 'exhausted',
        message: 'No more voices match these keywords. Try other keywords, or add one by its id.',
      }
    }
    return bringMore(next, perRound)
  })
}

/** Brings a voice into the current round by its Fish id; says so if the audition has seen it. */
export async function addVoiceById(
  projectFile: string,
  characterId: string,
  voiceId: string,
  fishFor: FishFactory,
): Promise<SessionResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  return changeSession(projectFile, characterId, async (session) => {
    const seen = seenMessage(session, voiceId)
    if (seen) return { ok: false, reason: 'seen', message: seen }
    const fish = await fishFor(dirname(projectFile), opened.project)
    if (!fish) {
      return { ok: false, reason: 'no-key', message: 'Set FISH_AUDIO_API_KEY to look voices up.' }
    }
    try {
      return addVoice(session, await fish.getVoice(voiceId))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: 'fish', message }
    }
  })
}

/** Why a voice cannot be added to the audition, or null if it can. */
function seenMessage(session: AuditionSession, voiceId: string): string | null {
  if (session.pool.includes(voiceId)) return 'That voice is already in this round.'
  if (session.dropped.includes(voiceId)) return 'That voice was dropped earlier in this audition.'
  return null
}

/**
 * The character's recorded lines per part: the lines with a clip, which casting another voice
 * makes stale. Lines not recorded yet are missing either way, so they are not counted.
 */
export async function recordedLines(
  projectFile: string,
  characterId: string,
): Promise<Appearance[]> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return []
  const character = loaded.summary.characters.find((c) => c.id === characterId)
  const recorded: Appearance[] = []
  for (const { part } of character?.appearances ?? []) {
    const read = await loadPart(projectFile, part)
    if (!read?.ok) continue
    const lines = read.part.lines.filter((l) => l.speaker === characterId && l.file).length
    if (lines) recorded.push({ part, lines })
  }
  return recorded
}

/** What casting did: the voice cast, whether it changed, and the lines that are now stale. */
export type CastResult =
  | {
      ok: true
      voice: { id: string; name: string }
      changed: boolean
      /** The character's recorded lines per part, all stale now that its voice changed. */
      stale: Appearance[]
    }
  | { ok: false; reason: 'no-session' | 'no-finalist'; message: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/**
 * Casts the one voice left in the audition: writes it to the cast and ends the audition. When the
 * current voice wins, the cast is left as it is.
 */
export function castFinalist(projectFile: string, characterId: string): Promise<CastResult> {
  return sessionWrites.run(key(projectFile, characterId), async () => {
    const loaded = await loadWorkspace(projectFile)
    if (!loaded.ok) return loaded
    const character = loaded.summary.characters.find((c) => c.id === characterId)
    if (!character) return null
    const session = await readSession(projectFile, characterId)
    if (!session) {
      return { ok: false, reason: 'no-session', message: 'There is no audition to cast from.' }
    }
    const winner = finalist(session)
    if (!winner) {
      return {
        ok: false,
        reason: 'no-finalist',
        message: 'Drop voices until one is left, then cast it.',
      }
    }
    const voice = { id: winner, name: session.voices[winner]?.title ?? winner }
    const changed = winner !== character.voice
    const stale = changed ? await recordedLines(projectFile, characterId) : []
    if (changed) {
      const written = await setVoice(projectFile, characterId, voice)
      if (!written || !written.ok) return written
    }
    await rm(sessionPath(projectFile, characterId), { force: true })
    return { ok: true, voice, changed, stale }
  })
}

/** Ends the character's audition without casting; null for an unknown character. */
export function discardSession(projectFile: string, characterId: string): Promise<true | null> {
  return sessionWrites.run(key(projectFile, characterId), async () => {
    if ((await knownCharacter(projectFile, characterId)) !== true) return null
    await rm(sessionPath(projectFile, characterId), { force: true })
    return true
  })
}

/** A session as the page shows it: the session, the phrase, the takes, and what a cast would make stale. */
export type SessionView =
  | {
      ok: true
      session: AuditionSession | null
      audition: AuditionText | null
      takes: Record<string, string>
      /** The character's recorded lines per part, which casting another voice would make stale. */
      recorded: Appearance[]
    }
  | SessionFailure

/** A session result with the phrase, the takes of the voices in the round, and the recorded lines. */
export async function viewOf(
  projectFile: string,
  characterId: string,
  result: { ok: true; session: AuditionSession | null } | SessionFailure,
): Promise<SessionView> {
  if (!result.ok) return result
  const empty = { ok: true as const, audition: null, takes: {}, recorded: [] }
  if (!result.session) return { ...empty, session: null }
  const recorded = await recordedLines(projectFile, characterId)
  const lookup = await auditionTakes(projectFile, characterId, result.session.pool)
  if (!lookup?.ok) return { ...empty, session: result.session, recorded }
  return {
    ok: true,
    session: result.session,
    audition: lookup.audition,
    takes: lookup.takes,
    recorded,
  }
}

async function knownCharacter(
  projectFile: string,
  characterId: string,
): Promise<true | ProjectFailure | null> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  return loaded.summary.characters.some((c) => c.id === characterId) ? true : null
}

/** The saved session; none if there is no file, or it does not fit (an older version, a hand edit). */
async function readSession(
  projectFile: string,
  characterId: string,
): Promise<AuditionSession | null> {
  const json = await readJson(sessionPath(projectFile, characterId))
  if (json.status !== 'ok') return null
  const parsed = AuditionSessionSchema.safeParse(json.value)
  return parsed.success && parsed.data.character === characterId ? parsed.data : null
}

async function writeSession(projectFile: string, characterId: string, session: AuditionSession) {
  await writeAtomic(
    dirname(projectFile),
    sessionFile(characterId),
    JSON.stringify(session, null, 1),
  )
}

function key(projectFile: string, characterId: string): string {
  return `${projectFile}\n${characterId}`
}

/** A session's file: a readable name plus a short hash, so any character id makes a safe name. */
function sessionFile(characterId: string): string {
  const readable = characterId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)
  const hash = createHash('sha256').update(characterId).digest('hex').slice(0, 8)
  return `${SESSIONS_DIR}/${readable}-${hash}.json`
}

function sessionPath(projectFile: string, characterId: string): string {
  return resolveInRoot(dirname(projectFile), sessionFile(characterId))
}

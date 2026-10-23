import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
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
import { loadWorkspace, openProject, type ProjectFailure } from './workspace'

/** Where audition sessions are kept, in the project's tool cache. */
export const SESSIONS_DIR = '.audio-studio/auditions'

/** A session, or why there is none. Null for an unknown character. */
export type SessionResult =
  | { ok: true; session: AuditionSession }
  | { ok: false; reason: 'no-session' | 'no-key' | 'fish'; message: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/**
 * A saved session as read back: checked for its shape only, since the studio wrote it. A session
 * that does not fit (an older version, a hand edit) counts as none.
 */
const SessionSchema = z.looseObject({
  version: z.literal(1),
  character: z.string(),
  keywords: z.array(z.string()),
  current: z.string().nullable(),
  round: z.number().int().min(1),
  rounds: z.array(z.object({ round: z.number(), voices: z.number() })),
  pool: z.array(z.string()),
  verdicts: z.record(z.string(), z.enum(['keep', 'drop'])),
  dropped: z.array(z.string()),
  queue: z.array(z.string()),
  voices: z.record(z.string(), z.looseObject({ id: z.string(), title: z.string() })),
  matched: z.record(z.string(), z.array(z.string())),
})

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
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
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

/** Applies `change` to the character's saved session and saves the result. */
export function changeSession(
  projectFile: string,
  characterId: string,
  change: (session: AuditionSession) => AuditionSession | Promise<AuditionSession | SessionResult>,
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
    if (!changed || !('pool' in changed)) return changed
    await writeSession(projectFile, characterId, changed)
    return { ok: true, session: changed }
  })
}

/**
 * Brings a round's worth of new candidates into the current round: from the queue, searching
 * Fish again first when the queue is short. Voices seen before in the audition never come back.
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
    if (session.queue.length >= perRound) return bringMore(session, perRound)
    const found = await findCandidates(projectFile, characterId, fishFor)
    if (!found || !found.ok) return found
    return bringMore(queueMore(session, found.candidates), perRound)
  })
}

/** Brings a voice into the current round by its Fish id. */
export async function addVoiceById(
  projectFile: string,
  characterId: string,
  voiceId: string,
  fishFor: FishFactory,
): Promise<SessionResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const fish = await fishFor(dirname(projectFile), opened.project)
  if (!fish) {
    return { ok: false, reason: 'no-key', message: 'Set FISH_AUDIO_API_KEY to look voices up.' }
  }
  return changeSession(projectFile, characterId, async (session) => {
    try {
      return addVoice(session, await fish.getVoice(voiceId))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: 'fish', message }
    }
  })
}

/** What casting did: the voice cast, whether it changed, and the lines that are now stale. */
export type CastResult =
  | {
      ok: true
      voice: { id: string; name: string }
      changed: boolean
      /** The character's lines per part, all stale now that its voice changed. */
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
    if (changed) {
      const written = await setVoice(projectFile, characterId, voice)
      if (!written || !written.ok) return written
    }
    await rm(sessionPath(projectFile, characterId), { force: true })
    return { ok: true, voice, changed, stale: changed ? character.appearances : [] }
  })
}

/** Ends the character's audition without casting. */
export function discardSession(projectFile: string, characterId: string): Promise<void> {
  return sessionWrites.run(key(projectFile, characterId), () =>
    rm(sessionPath(projectFile, characterId), { force: true }),
  )
}

async function knownCharacter(
  projectFile: string,
  characterId: string,
): Promise<true | ProjectFailure | null> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  return loaded.summary.characters.some((c) => c.id === characterId) ? true : null
}

async function readSession(
  projectFile: string,
  characterId: string,
): Promise<AuditionSession | null> {
  const json = await readJson(sessionPath(projectFile, characterId))
  if (json.status !== 'ok') return null
  const parsed = SessionSchema.safeParse(json.value)
  return parsed.success && parsed.data.character === characterId
    ? (parsed.data as unknown as AuditionSession)
    : null
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

/** A session as the page shows it: the session, the phrase, and the takes of the voices in it. */
export type SessionView =
  | {
      ok: true
      session: AuditionSession | null
      audition: AuditionText | null
      takes: Record<string, string>
    }
  | Exclude<SessionResult, { ok: true } | null>

/** A session result with the phrase and the takes recorded for the voices in the round. */
export async function viewOf(
  projectFile: string,
  characterId: string,
  result:
    { ok: true; session: AuditionSession | null } | Exclude<SessionResult, { ok: true } | null>,
): Promise<SessionView> {
  if (!result.ok) return result
  if (!result.session) return { ok: true, session: null, audition: null, takes: {} }
  const lookup = await auditionTakes(projectFile, characterId, result.session.pool)
  if (!lookup?.ok) return { ok: true, session: result.session, audition: null, takes: {} }
  return { ok: true, session: result.session, audition: lookup.audition, takes: lookup.takes }
}

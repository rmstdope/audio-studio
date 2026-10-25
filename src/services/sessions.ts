import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  AuditionSessionSchema,
  addVoice,
  setDesigned,
  addSpent,
  bringMore,
  drop,
  placeOf,
  queueMore,
  setOwnVoices,
  shortlist,
  startSession,
  undoDrop,
  unlist,
  type AuditionSession,
} from '../core/audition'
import { listDesigns } from '../core/designs'
import { resolveInRoot } from '../core/paths'
import { perTakeCost } from '../core/sitting'
import { declaredLanguage, type Problem } from '../core/project'
import type { Appearance } from '../core/summary'
import type { AuditionText } from '../core/takes'
import type { Candidate, Voice } from '../core/voiceSearch'
import { findCandidates, setVoice, type FishFactory } from './auditions'
import { designTakes, readDesigns } from './designStore'
import { characterFile, readJson, writeAtomic } from './files'
import { NO_KEY } from './fish'
import { ruledOutIds, updateRuledOut } from './ruledOut'
import { createSerial } from './serial'
import { auditionIn, auditionTakes } from './takes'
import {
  cacheNameFor,
  knownCharacter,
  loadPart,
  loadWorkspace,
  openProject,
  type ProjectFailure,
} from './workspace'

/** Where audition sessions are kept, in the project's tool cache. */
export const SESSIONS_DIR = '.audio-studio/auditions'

/** Why a session action did nothing. */
export type SessionFailure =
  | {
      ok: false
      reason: 'no-session' | 'no-key' | 'fish' | 'seen' | 'exhausted' | 'no-phrase'
      message: string
    }
  | { ok: false; problems: Problem[] }
  | ProjectFailure

/** A session, or why there is none. Null for an unknown character. */
export type SessionResult = { ok: true; session: AuditionSession } | SessionFailure | null

/** Changes to one character's session, one at a time. */
const sessionWrites = createSerial()

/** The character's saved audition in a language (the source language's when none is named), or null when none is going on. */
export async function sessionFor(
  projectFile: string,
  characterId: string,
  language?: string,
): Promise<{ ok: true; session: AuditionSession | null } | ProjectFailure | null> {
  const known = await knownCharacter(projectFile, characterId)
  if (known !== true) return known
  return { ok: true, session: await readSession(projectFile, characterId, language) }
}

/**
 * Starts (or starts over) a character's audition from a fresh search with its keywords: the
 * current voice on the shortlist, the top candidates to hear, the rest queued.
 */
export async function startAudition(
  projectFile: string,
  characterId: string,
  fishFor: FishFactory,
  language?: string,
): Promise<SessionResult> {
  const name = await cacheNameFor(projectFile, characterId, language)
  return sessionWrites.run(key(projectFile, name), async () => {
    const found = await findCandidates(projectFile, characterId, fishFor, {}, language)
    if (!found || !found.ok) return found
    if (found.audition.phrase === null) {
      return {
        ok: false,
        reason: 'no-phrase',
        message: 'There is no audition phrase to start with; write one first.',
      }
    }
    const { voice, voiceName } = found.casting
    // Fish not finding the cast voice just now does not make the character uncast.
    const current = found.current ?? (voice ? unknownVoice(voice, voiceName) : null)
    const started = startSession({
      character: characterId,
      keywords: found.keywords,
      current,
      others: found.others,
      candidates: found.candidates,
      perRound: found.perRound,
    })
    // The designs kept for the character in this language come back, except those dropped for good.
    const designs = listDesigns(await readDesigns(projectFile, characterId, language))
    const session = setDesigned(
      started,
      designs,
      await ruledOutIds(projectFile, characterId, language),
    )
    await writeSession(projectFile, characterId, session, language)
    return { ok: true, session }
  })
}

/** A voice known only by its id (and the name the cast gives it), when Fish does not answer. */
function unknownVoice(id: string, name: string | null): Voice {
  return {
    id,
    title: name ?? '',
    description: '',
    tags: [],
    languages: [],
    uses: 0,
    likes: 0,
    author: '',
    sample: null,
  }
}

/**
 * Applies `change` to the character's saved session and saves the result; a change may instead
 * say why it did nothing, and then nothing is saved; a change that changes nothing saves nothing
 * either. `alongside` writes what goes with the change (the ruled-out voices), before the session
 * and before the next change may start: what it writes follows the session's changes in their
 * order, and if it fails, the session is left as it was.
 */
export async function changeSession(
  projectFile: string,
  characterId: string,
  change: (
    session: AuditionSession,
  ) => AuditionSession | SessionFailure | Promise<AuditionSession | SessionFailure>,
  alongside?: (session: AuditionSession, before: AuditionSession) => Promise<unknown>,
  language?: string,
): Promise<SessionResult> {
  const name = await cacheNameFor(projectFile, characterId, language)
  return sessionWrites.run(key(projectFile, name), async () => {
    const known = await knownCharacter(projectFile, characterId)
    if (known !== true) return known
    const session = await readSession(projectFile, characterId, language)
    if (!session) {
      return {
        ok: false,
        reason: 'no-session',
        message: `There is no audition for ${characterId}; start one.`,
      }
    }
    const changed = await change(session)
    if ('ok' in changed) return changed
    if (changed === session) return { ok: true, session }
    await alongside?.(changed, session)
    await writeSession(projectFile, characterId, changed, language)
    return { ok: true, session: changed }
  })
}

/** What can be done with a voice on the board. */
export type VoiceMove = 'shortlist' | 'unlist' | 'drop'

/**
 * Shortlists a voice, unlists it, or drops it. A dropped voice is ruled out for the character, so
 * no later search shows it again. The current voice can be dropped from the board but is never
 * ruled out: it takes part in every audition.
 */
export function moveVoice(
  projectFile: string,
  characterId: string,
  voice: string,
  move: VoiceMove,
  language?: string,
): Promise<SessionResult> {
  const apply = { shortlist, unlist, drop }[move]
  return changeSession(
    projectFile,
    characterId,
    (s) => apply(s, voice),
    async (session) => {
      if (move !== 'drop' || voice === session.current) return
      const title = session.voices[voice]?.title ?? voice
      await updateRuledOut(projectFile, characterId, { out: [{ id: voice, title }], language })
    },
    language,
  )
}

/** Undoes the last drop: the voice goes back where it was, and is no longer ruled out. */
export function undoLastDrop(
  projectFile: string,
  characterId: string,
  language?: string,
): Promise<SessionResult> {
  return changeSession(
    projectFile,
    characterId,
    undoDrop,
    async (_session, before) => {
      const undone = before.dropped.at(-1)?.id
      if (undone) await updateRuledOut(projectFile, characterId, { allowed: [undone], language })
    },
    language,
  )
}

/**
 * Fetches the voices on the user's own Fish account and puts them in Your voices (see
 * `setOwnVoices`), leaving out those ruled out for the character. Fish is asked outside the
 * session's turn, so the board keeps working meanwhile; if Fish cannot list them, says why and
 * leaves the session as it was.
 */
export async function refreshOwnVoices(
  projectFile: string,
  characterId: string,
  fishFor: FishFactory,
  language?: string,
): Promise<SessionResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  if ((await readSession(projectFile, characterId, language)) === null) {
    return changeSession(projectFile, characterId, (s) => s, undefined, language)
  }
  const fish = await fishFor(dirname(projectFile), opened.project)
  if (!fish) return { ok: false, reason: 'no-key', message: NO_KEY }
  let own: Voice[]
  try {
    own = await fish.listOwnVoices()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'fish', message }
  }
  const ruledOut = await ruledOutIds(projectFile, characterId, language)
  return changeSession(
    projectFile,
    characterId,
    (s) => setOwnVoices(s, own, ruledOut),
    undefined,
    language,
  )
}

/**
 * Brings a round's worth of new candidates in to hear: from the queue, searching Fish again (with
 * the keywords the audition started with, leaving out every voice it has shown) when the queue is
 * short. Says so when no new voice is left to find.
 */
export async function moreVoices(
  projectFile: string,
  characterId: string,
  fishFor: FishFactory,
  language?: string,
): Promise<SessionResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const perRound = opened.project.narration.audition.candidatesPerRound
  // Search outside the session's queue, so verdicts and casting don't wait on Fish; whatever the
  // session gained meanwhile, queueMore leaves out what it has seen.
  const snapshot = await readSession(projectFile, characterId, language)
  let found: Candidate[] = []
  if (snapshot && snapshot.queue.length < perRound) {
    const search = await findCandidates(
      projectFile,
      characterId,
      fishFor,
      {
        keywords: snapshot.keywords,
        exclude: [
          ...snapshot.shortlist,
          ...snapshot.toHear,
          ...snapshot.dropped.map((d) => d.id),
          ...snapshot.queue,
        ],
      },
      language,
    )
    if (!search) return null
    if (!search.ok) return search
    found = search.candidates
  }
  return changeSession(
    projectFile,
    characterId,
    (session) => {
      const next = queueMore(session, found)
      if (!next.queue.length) {
        return {
          ok: false,
          reason: 'exhausted',
          message:
            'No more voices found for these keywords. Try other keywords, or bring in a specific voice.',
        }
      }
      return bringMore(next, perRound)
    },
    undefined,
    language,
  )
}

/**
 * Brings a voice in to hear by its Fish id, also one dropped or ruled out before (it is then no
 * longer ruled out); says so if it is on the board already.
 */
export async function addVoiceById(
  projectFile: string,
  characterId: string,
  voiceId: string,
  fishFor: FishFactory,
  language?: string,
): Promise<SessionResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  return changeSession(
    projectFile,
    characterId,
    async (session) => {
      if (placeOf(session, voiceId)) {
        return { ok: false, reason: 'seen', message: 'That voice is in this audition already.' }
      }
      // A voice the audition knows (queued or dropped) needs no asking Fish.
      const known = session.voices[voiceId]
      if (known) return addVoice(session, known)
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
    },
    // Asking for a voice by its id is wanting to hear it: it is no longer ruled out.
    () => updateRuledOut(projectFile, characterId, { allowed: [voiceId], language }),
    language,
  )
}

/**
 * The character's recorded lines per part in a language: the lines with a clip, which casting
 * another voice there makes stale. Lines not recorded yet are missing either way, so they are not counted.
 */
export async function recordedLines(
  projectFile: string,
  characterId: string,
  asked?: string,
): Promise<Appearance[]> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return []
  const language = declaredLanguage(loaded.project.narration, asked)
  const character = loaded.summary.characters.find((c) => c.id === characterId)
  const recorded: Appearance[] = []
  for (const { part } of character?.languages[language]?.appearances ?? []) {
    const read = await loadPart(projectFile, part, language)
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
  | { ok: false; reason: 'no-session' | 'not-shortlisted'; message: string }
  /** A designed voice that Fish could not save to the account, so was not cast. */
  | { ok: false; reason: 'save'; voice: string; message: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/**
 * Casts a shortlisted voice: writes it to the cast and ends the audition. Keeping the current
 * voice leaves the cast as it is.
 */
export async function castVoice(
  projectFile: string,
  characterId: string,
  winner: string,
  asked?: string,
): Promise<CastResult> {
  const name = await cacheNameFor(projectFile, characterId, asked)
  return sessionWrites.run(key(projectFile, name), async () => {
    const loaded = await loadWorkspace(projectFile)
    if (!loaded.ok) return loaded
    const character = loaded.summary.characters.find((c) => c.id === characterId)
    if (!character) return null
    const language = declaredLanguage(loaded.project.narration, asked)
    const session = await readSession(projectFile, characterId, language)
    if (!session) {
      return { ok: false, reason: 'no-session', message: 'There is no audition to cast from.' }
    }
    if (!session.shortlist.includes(winner)) {
      return {
        ok: false,
        reason: 'not-shortlisted',
        message: 'Only a shortlisted voice can be cast; shortlist it first.',
      }
    }
    const voice = { id: winner, name: session.voices[winner]?.title ?? winner }
    return writeCast(
      projectFile,
      characterId,
      character.languages[language]?.voice,
      voice,
      language,
    )
  })
}

/**
 * Casts a voice that is on no audition's shortlist, such as one just made from the user's own
 * recordings. Like casting from an audition it ends the audition going on, if any.
 */
export async function castOwnVoice(
  projectFile: string,
  characterId: string,
  voice: { id: string; name: string },
  asked?: string,
): Promise<CastResult> {
  const name = await cacheNameFor(projectFile, characterId, asked)
  return sessionWrites.run(key(projectFile, name), async () => {
    const loaded = await loadWorkspace(projectFile)
    if (!loaded.ok) return loaded
    const character = loaded.summary.characters.find((c) => c.id === characterId)
    if (!character) return null
    const language = declaredLanguage(loaded.project.narration, asked)
    return writeCast(
      projectFile,
      characterId,
      character.languages[language]?.voice,
      voice,
      language,
    )
  })
}

/** Writes the voice to the cast (for the language) unless it is the one cast now, and ends the audition. */
async function writeCast(
  projectFile: string,
  characterId: string,
  current: string | null | undefined,
  voice: { id: string; name: string },
  language?: string,
): Promise<CastResult> {
  const changed = voice.id !== current
  const stale = changed ? await recordedLines(projectFile, characterId, language) : []
  if (changed) {
    const written = await setVoice(projectFile, characterId, voice, language)
    if (!written || !written.ok) return written
  }
  await rm(await sessionPath(projectFile, characterId, language), { force: true })
  return { ok: true, voice, changed, stale }
}

/** Ends the character's audition without casting; null for an unknown character. */
export async function discardSession(
  projectFile: string,
  characterId: string,
  language?: string,
): Promise<true | ProjectFailure | null> {
  const name = await cacheNameFor(projectFile, characterId, language)
  return sessionWrites.run(key(projectFile, name), async () => {
    const known = await knownCharacter(projectFile, characterId)
    if (known !== true) return known
    await rm(await sessionPath(projectFile, characterId, language), { force: true })
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
      /**
       * The character's recorded lines per part, which casting another voice would make stale.
       * Left out after a change to the board, which cannot change it: keep the last one shown.
       */
      recorded?: Appearance[]
    }
  | SessionFailure

/** A session result with the phrase, the takes of the voices on the board, and the recorded lines. */
export async function viewOf(
  projectFile: string,
  characterId: string,
  result: { ok: true; session: AuditionSession | null } | SessionFailure,
  { recorded: withRecorded = true, language }: { recorded?: boolean; language?: string } = {},
): Promise<SessionView> {
  if (!result.ok) return result
  const empty = { ok: true as const, audition: null, takes: {}, recorded: [] }
  if (!result.session) return { ...empty, session: null }
  // Counting recorded lines plans every part the character is in: only when it may have changed.
  const recorded = withRecorded
    ? await recordedLines(projectFile, characterId, language)
    : undefined
  const { shortlist: listed, yours, designed, toHear } = result.session
  const lookup = await auditionTakes(
    projectFile,
    characterId,
    [...listed, ...yours, ...toHear],
    language,
  )
  if (!lookup?.ok) return { ...empty, session: result.session, recorded }
  return {
    ok: true,
    session: result.session,
    audition: lookup.audition,
    // A design's preview is its take, kept apart from the takes the audition phrase is recorded to.
    takes: { ...lookup.takes, ...designTakes(projectFile, [...listed, ...designed]) },
    recorded,
  }
}

/** The saved session; none if there is no file, or it does not fit (an older version, a hand edit). */
async function readSession(
  projectFile: string,
  characterId: string,
  language?: string,
): Promise<AuditionSession | null> {
  const json = await readJson(await sessionPath(projectFile, characterId, language))
  if (json.status !== 'ok') return null
  const parsed = AuditionSessionSchema.safeParse(json.value)
  return parsed.success && parsed.data.character === characterId ? parsed.data : null
}

async function writeSession(
  projectFile: string,
  characterId: string,
  session: AuditionSession,
  language?: string,
) {
  const name = await cacheNameFor(projectFile, characterId, language)
  await writeAtomic(dirname(projectFile), sessionFile(name), JSON.stringify(session, null, 1))
}

/** What serialises a character's session changes: its project and the name of its file. */
function key(projectFile: string, name: string): string {
  return `${projectFile}\n${name}`
}

function sessionFile(name: string): string {
  return characterFile(SESSIONS_DIR, name)
}

async function sessionPath(
  projectFile: string,
  characterId: string,
  language?: string,
): Promise<string> {
  const name = await cacheNameFor(projectFile, characterId, language)
  return resolveInRoot(dirname(projectFile), sessionFile(name))
}

/** What an audition's takes cost: the model, the price of a take of the phrase, and what was charged so far. */
export type AuditionMoney =
  { ok: true; model: string; perTake: number; spentBefore: number } | ProjectFailure | null

/**
 * What a board take of the character's current phrase costs on the audition model (nothing on a
 * free one), and the dollars already charged to the audition in earlier sittings. Null for an
 * unknown character.
 */
export async function auditionMoney(
  projectFile: string,
  characterId: string,
  language?: string,
): Promise<AuditionMoney> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  if (!loaded.summary.characters.some((c) => c.id === characterId)) return null
  const { project, cast, summary } = loaded
  const model = project.narration.models.audition
  const spentBefore = (await readSession(projectFile, characterId, language))?.spent ?? 0
  if (!cast) return { ok: true, model, perTake: 0, spentBefore }
  const { spoken } = auditionIn(project, cast, summary, characterId, language).audition
  const perTake = perTakeCost(model, new TextEncoder().encode(spoken).length, new Date()) ?? 0
  return { ok: true, model, perTake, spentBefore }
}

/** Adds `dollars` charged for a take to the character's audition; nothing if none is going on. */
export function recordSpent(
  projectFile: string,
  characterId: string,
  dollars: number,
  language?: string,
): Promise<SessionResult> {
  return changeSession(
    projectFile,
    characterId,
    (session) => addSpent(session, dollars),
    undefined,
    language,
  )
}

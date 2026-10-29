import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  AuditionSessionSchema,
  addVoice,
  setDesigned,
  addSpent,
  bringFound,
  bringMore,
  markAdded,
  unmarkAdded,
  drop,
  placeOf,
  seen,
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
import { providerOf, type VoiceProvider } from '../core/voices'
import {
  elevenVoiceFor,
  findCandidates,
  searchLanguage,
  setVoice,
  type FishFactory,
} from './auditions'
import { designTakes, readDesigns } from './designStore'
import { characterFile, readJson, writeAtomic } from './files'
import { NO_ELEVENLABS_KEY, type ElevenLabsFactory } from './elevenlabs'
import { NO_KEY } from './fish'
import { ruledOutIds, updateRuledOut } from './ruledOut'
import { createSerial } from './serial'
import { auditionIn, auditionTakes, castProblems, elevenTakeCost } from './takes'
import { searchLibrary } from './voiceSearch'
import { readAddedVoices } from './elevenVoices'
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
      reason: 'no-session' | 'no-key' | 'fish' | 'elevenlabs' | 'seen' | 'exhausted' | 'no-phrase'
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
 * Starts (or starts over) a character's audition: the current voice on the shortlist (an
 * ElevenLabs one looked up with `elevenFor`), her voices in other languages, her designs. Nothing
 * is searched and nothing is to hear: the user brings voices in (more, a specific one, a design).
 */
export async function startAudition(
  projectFile: string,
  characterId: string,
  fishFor: FishFactory,
  language?: string,
  elevenFor?: ElevenLabsFactory,
): Promise<SessionResult> {
  const name = await cacheNameFor(projectFile, characterId, language)
  return sessionWrites.run(key(projectFile, name), async () => {
    const found = await findCandidates(
      projectFile,
      characterId,
      fishFor,
      { elevenFor, search: false },
      language,
    )
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
  from: { provider: VoiceProvider; elevenFor?: ElevenLabsFactory } = { provider: 'fish' },
): Promise<SessionResult> {
  if (from.provider === 'elevenlabs') {
    return moreFromLibrary(projectFile, characterId, from.elevenFor, language)
  }
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
 * A round's worth more voices to hear from ElevenLabs' shared library, found with the audition's
 * keywords in its language, leaving out voices ruled out for the character; Fish's queue is left
 * as it is.
 */
async function moreFromLibrary(
  projectFile: string,
  characterId: string,
  elevenFor: ElevenLabsFactory = async () => null,
  asked?: string,
): Promise<SessionResult> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  const { project, cast, summary } = loaded
  if (!summary.characters.some((c) => c.id === characterId)) return null
  if (!cast) return { ok: false, problems: castProblems(project, summary.problems) }
  const language = auditionIn(project, cast, summary, characterId, asked).language
  const snapshot = await readSession(projectFile, characterId, asked)
  if (!snapshot) {
    return { ok: false, reason: 'no-session', message: 'There is no audition in progress.' }
  }
  const client = await elevenFor(dirname(projectFile), project)
  if (!client) return { ok: false, reason: 'no-key', message: NO_ELEVENLABS_KEY }
  const character = summary.characters.find((c) => c.id === characterId)!
  const castIds = new Set(Object.values(character.languages).map((l) => l.voice))
  let found: Candidate[]
  try {
    found = await searchLibrary(client, snapshot.keywords, {
      language: searchLanguage(project, language),
      exclude: new Set([
        ...(await ruledOutIds(projectFile, characterId, language)),
        // A voice the studio added is on the board, or cast, as the voice it became.
        ...(await readAddedVoices(projectFile)).added
          .filter((a) => seen(snapshot, a.voice) || castIds.has(a.voice))
          .map((a) => a.library),
      ]),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'elevenlabs', message }
  }
  const perRound = project.narration.audition.candidatesPerRound
  return changeSession(
    projectFile,
    characterId,
    (session) => {
      const next = bringFound(session, found, perRound)
      if (next === session) {
        return {
          ok: false,
          reason: 'exhausted',
          message:
            'No more ElevenLabs voices found for these keywords. Try other keywords, or bring in a specific voice.',
        }
      }
      return next
    },
    undefined,
    asked,
  )
}

/**
 * Brings a voice in to hear by its id, also one dropped or ruled out before (it is then no
 * longer ruled out); says so if it is on the board already. A Fish voice is looked up on Fish, an
 * ElevenLabs one on ElevenLabs (with `elevenFor`; none means no key).
 */
export async function addVoiceById(
  projectFile: string,
  characterId: string,
  voiceId: string,
  fishFor: FishFactory,
  language?: string,
  elevenFor: ElevenLabsFactory = async () => null,
): Promise<SessionResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const root = dirname(projectFile)
  return changeSession(
    projectFile,
    characterId,
    async (session) => {
      if (placeOf(session, voiceId)) {
        return { ok: false, reason: 'seen', message: 'That voice is in this audition already.' }
      }
      // A voice the audition knows (queued or dropped) needs no asking.
      const known = session.voices[voiceId]
      if (known) return addVoice(session, known)
      if (providerOf(voiceId) === 'elevenlabs') {
        const found = await elevenVoiceFor(elevenFor, root, opened.project, voiceId)
        return found.ok ? addVoice(session, found.voice) : found
      }
      const fish = await fishFor(root, opened.project)
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
  /** A designed voice that Fish could not save to the account, or a library voice ElevenLabs would not add, so not cast. */
  | { ok: false; reason: 'save'; voice: string; message: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/**
 * Casts a shortlisted voice: writes it to the cast and ends the audition. Keeping the current
 * voice leaves the cast as it is. A voice of ElevenLabs' library is cast as the voice `saveAs`
 * gives (it adds it to the user's voices); if it cannot be added nothing is cast.
 */
export async function castVoice(
  projectFile: string,
  characterId: string,
  winner: string,
  asked?: string,
  saveAs?: (voice: Voice) => Promise<string>,
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
    const shown = session.voices[winner]
    let id = winner
    if (shown?.library && saveAs) {
      try {
        id = await saveAs(shown)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, reason: 'save', voice: winner, message }
      }
    }
    const voice = { id, name: shown?.title ?? winner }
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

/**
 * Marks a voice of ElevenLabs' library on the character's board as among the user's voices, once
 * the studio added it, so the board no longer says its take or cast will add it.
 */
export function voiceAdded(
  projectFile: string,
  characterId: string,
  voiceId: string,
  language?: string,
): Promise<SessionResult> {
  return changeSession(
    projectFile,
    characterId,
    (session) => markAdded(session, voiceId),
    undefined,
    language,
  )
}

/**
 * Marks library voices (their library ids) as no longer among the user's voices on every
 * audition in progress, once removed to free their slots, so a take or cast adds them again.
 */
export async function voicesRemoved(projectFile: string, voices: string[]): Promise<void> {
  if (!voices.length) return
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return
  for (const character of loaded.summary.characters) {
    for (const language of loaded.project.narration.languages) {
      await changeSession(
        projectFile,
        character.id,
        (session) => unmarkAdded(session, voices),
        undefined,
        language,
      )
    }
  }
}

/** A voice as the character's audition in progress shows it; undefined if it is not in one. */
export async function boardVoice(
  projectFile: string,
  characterId: string,
  voiceId: string,
  language?: string,
): Promise<Voice | undefined> {
  return (await readSession(projectFile, characterId, language))?.voices[voiceId]
}

/**
 * The voices in use: every voice cast for a character in a language, and every voice on an
 * audition in progress (shortlisted, to hear, queued, the last one dropped, which Undo brings
 * back, or the voice it started with). Null when that cannot be known (the project, the cast or a saved
 * audition cannot be read), so nothing is taken for unused.
 */
export async function voicesInUse(projectFile: string): Promise<Set<string> | null> {
  const used = new Set<string>()
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok || !loaded.cast) return null
  for (const character of loaded.summary.characters) {
    for (const casting of Object.values(character.languages)) {
      if (casting.voice) used.add(casting.voice)
    }
    for (const language of loaded.project.narration.languages) {
      const json = await readJson(await sessionPath(projectFile, character.id, language))
      if (json.status === 'missing') continue
      // One of an earlier version is no longer an audition in progress (see the schema).
      if (json.status === 'ok' && isOlderSession(json.value)) continue
      const parsed = json.status === 'ok' ? AuditionSessionSchema.safeParse(json.value) : null
      if (!parsed?.success) return null
      const { current, shortlist, yours, designed, toHear, queue, dropped } = parsed.data
      for (const id of [...shortlist, ...yours, ...designed, ...toHear, ...queue]) used.add(id)
      // Undo brings back the last voice dropped.
      const undoable = dropped.at(-1)
      if (undoable) used.add(undoable.id)
      if (current) used.add(current)
    }
  }
  return used
}

/** Whether a saved session is of an earlier version than the studio reads. */
function isOlderSession(value: unknown): boolean {
  const version = (value as { version?: unknown } | null)?.version
  return typeof version === 'number' && version < 2
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
  | {
      ok: true
      model: string
      perTake: number
      spentBefore: number
      /** Whether the character has an audition going on (or paused). */
      going: boolean
      /** An ElevenLabs voice's board take: ElevenLabs' audition model and its credits. */
      eleven: { model: string; perTake: number }
    }
  | ProjectFailure
  | null

/**
 * What a board take of the character's current phrase costs on the audition model (nothing on a
 * free one) and, for an ElevenLabs voice, in credits on ElevenLabs' audition model, and the
 * dollars already charged to the audition in earlier sittings, and whether one is going on. Null
 * for an unknown character.
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
  const session = await readSession(projectFile, characterId, language)
  const spentBefore = session?.spent ?? 0
  const going = session !== null
  const elevenModel = project.narration.elevenlabs.models.audition
  if (!cast) {
    const eleven = { model: elevenModel, perTake: 0 }
    return { ok: true, model, perTake: 0, spentBefore, going, eleven }
  }
  const seen = auditionIn(project, cast, summary, characterId, language)
  const { spoken } = seen.audition
  const perTake = perTakeCost(model, new TextEncoder().encode(spoken).length, new Date()) ?? 0
  const eleven = elevenTakeCost(project, seen.cast, characterId, seen.audition)
  return { ok: true, model, perTake, spentBefore, going, eleven }
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

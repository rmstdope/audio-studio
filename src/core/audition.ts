import { z } from 'zod'
import { VoiceSchema, type Candidate, type Voice } from './voiceSearch'

/** Where a voice on the board is: the user's own, up to hear, or on the shortlist. */
const PlaceSchema = z.enum(['yours', 'toHear', 'shortlist'])

/** Where a voice on the board is: the user's own, up to hear, or on the shortlist. */
export type Place = z.infer<typeof PlaceSchema>

/**
 * An audition in progress for one character: the voices up to hear, the shortlist the cast is
 * chosen from, the voices dropped in it (each with where it was, so the last drop can be undone),
 * and the candidates waiting to be brought in. Every voice shown is kept in `voices`, so a saved
 * session can be shown again without searching Fish. Saved sessions are checked against this
 * schema when read back; one of an earlier version is no longer an audition in progress.
 */
export const AuditionSessionSchema = z.object({
  version: z.literal(2),
  character: z.string(),
  /** The keywords the candidates were found with. */
  keywords: z.array(z.string()),
  /** The character's voice when the audition started, if any; it starts on the shortlist. */
  current: z.string().nullable(),
  /** The voices that can be cast, in the order shortlisted. */
  shortlist: z.array(z.string()),
  /** The user's own Fish voices not shortlisted or dropped, in the order shown (Your voices). */
  yours: z.array(z.string()).default([]),
  /** Every voice on the user's account when last fetched; empty until then. */
  mine: z.array(z.string()).default([]),
  /** The voices being listened to, in the order shown. */
  toHear: z.array(z.string()),
  /** Voices dropped in this audition, the latest last, and where each was. */
  dropped: z.array(z.object({ id: z.string(), from: PlaceSchema })),
  /** Ranked candidates not brought in yet. */
  queue: z.array(z.string()),
  voices: z.record(z.string(), VoiceSchema),
  /** The keywords each candidate matched. */
  matched: z.record(z.string(), z.array(z.string())),
})

/** An audition in progress for one character. */
export type AuditionSession = z.infer<typeof AuditionSessionSchema>

/** The start: the current voice (if any) on the shortlist, the top `perRound` candidates to hear. */
export function startSession(options: {
  character: string
  keywords: string[]
  current: Voice | null
  candidates: Candidate[]
  perRound: number
}): AuditionSession {
  const { character, keywords, current, candidates, perRound } = options
  const ranked = candidates.filter((c) => c.voice.id !== current?.id)
  const voices: Record<string, Voice> = {}
  const matched: Record<string, string[]> = {}
  for (const { voice, matched: words } of ranked) {
    voices[voice.id] = voice
    matched[voice.id] = words
  }
  if (current) voices[current.id] = current
  const ids = ranked.map((c) => c.voice.id)
  return {
    version: 2,
    character,
    keywords,
    current: current?.id ?? null,
    shortlist: current ? [current.id] : [],
    yours: [],
    mine: [],
    toHear: ids.slice(0, perRound),
    dropped: [],
    queue: ids.slice(perRound),
    voices,
    matched,
  }
}

/**
 * The session with the user's own voices: all of them in Your voices (an own voice the search
 * found leaves To hear and the queue), except those already shortlisted, dropped or ruled out
 * for the character. Each is marked as own wherever it is, the current voice included. Voices gone from the account leave the section.
 */
export function setOwnVoices(
  session: AuditionSession,
  own: Voice[],
  ruledOut: string[] = [],
): AuditionSession {
  const ids = own.map((v) => v.id)
  const known = new Set(ids)
  const placed = new Set([...session.shortlist, ...session.dropped.map((d) => d.id), ...ruledOut])
  const keep = session.yours.filter((id) => known.has(id))
  const added = ids.filter((id) => !placed.has(id) && !keep.includes(id))
  const marked = Object.fromEntries(own.map((v) => [v.id, { ...v, own: true }]))
  const next = {
    ...session,
    yours: [...keep, ...added],
    mine: ids,
    toHear: session.toHear.filter((id) => !known.has(id)),
    queue: session.queue.filter((id) => !known.has(id)),
    voices: { ...session.voices, ...marked },
  }
  // Nothing new: the same session, so nothing is written again.
  return JSON.stringify(next) === JSON.stringify(session) ? session : next
}

/** The session with a voice moved from Your voices or those to hear to the end of the shortlist. */
export function shortlist(session: AuditionSession, voice: string): AuditionSession {
  if (!session.toHear.includes(voice) && !session.yours.includes(voice)) return session
  return {
    ...session,
    yours: session.yours.filter((v) => v !== voice),
    toHear: session.toHear.filter((v) => v !== voice),
    shortlist: [...session.shortlist, voice],
  }
}

/**
 * The session with a voice moved off the shortlist: back to the front of Your voices if it is the
 * user's own, else to the front of those to hear.
 */
export function unlist(session: AuditionSession, voice: string): AuditionSession {
  if (!session.shortlist.includes(voice)) return session
  const own = session.voices[voice]?.own === true
  return {
    ...session,
    shortlist: session.shortlist.filter((v) => v !== voice),
    yours: own ? [voice, ...session.yours] : session.yours,
    toHear: own ? session.toHear : [voice, ...session.toHear],
  }
}

/** The session with a voice taken off the board (to hear or shortlisted) and counted as dropped. */
export function drop(session: AuditionSession, voice: string): AuditionSession {
  const from = placeOf(session, voice)
  if (!from) return session
  return {
    ...session,
    [from]: session[from].filter((v) => v !== voice),
    dropped: [...session.dropped, { id: voice, from }],
  }
}

/** The session with the last drop undone: that voice back where it was (at the front of it). */
export function undoDrop(session: AuditionSession): AuditionSession {
  const last = session.dropped.at(-1)
  if (!last) return session
  return {
    ...session,
    [last.from]: [last.id, ...session[last.from]],
    dropped: session.dropped.slice(0, -1),
  }
}

/** The session with up to `count` more candidates brought in from the queue, to hear. */
export function bringMore(session: AuditionSession, count: number): AuditionSession {
  if (!session.queue.length || count < 1) return session
  return {
    ...session,
    toHear: [...session.toHear, ...session.queue.slice(0, count)],
    queue: session.queue.slice(count),
  }
}

/**
 * The session with more candidates queued (from a new search), leaving out voices already in it.
 */
export function queueMore(session: AuditionSession, candidates: Candidate[]): AuditionSession {
  const fresh = candidates.filter((c) => !seen(session, c.voice.id))
  if (!fresh.length) return session
  return {
    ...session,
    queue: [...session.queue, ...fresh.map((c) => c.voice.id)],
    voices: { ...session.voices, ...Object.fromEntries(fresh.map((c) => [c.voice.id, c.voice])) },
    matched: {
      ...session.matched,
      ...Object.fromEntries(fresh.map((c) => [c.voice.id, c.matched])),
    },
  }
}

/**
 * The session with a voice brought in by id, at the front of those to hear (of Your voices, if it
 * is on the user's account): from the queue, one dropped earlier, or a new one. Unchanged if the
 * voice is on the board already.
 */
export function addVoice(session: AuditionSession, voice: Voice): AuditionSession {
  if (placeOf(session, voice.id)) return session
  const own = session.mine.includes(voice.id)
  return {
    ...session,
    yours: own ? [voice.id, ...session.yours] : session.yours,
    toHear: own ? session.toHear : [voice.id, ...session.toHear],
    queue: session.queue.filter((id) => id !== voice.id),
    dropped: session.dropped.filter((d) => d.id !== voice.id),
    voices: { ...session.voices, [voice.id]: own ? { ...voice, own: true } : voice },
  }
}

/** Where a voice is on the board, or null if it is not on it. */
export function placeOf(session: AuditionSession, voice: string): Place | null {
  if (session.yours.includes(voice)) return 'yours'
  if (session.toHear.includes(voice)) return 'toHear'
  if (session.shortlist.includes(voice)) return 'shortlist'
  return null
}

/** Whether the session has shown, queued or dropped the voice, or it is the current one. */
export function seen(session: AuditionSession, voice: string): boolean {
  return (
    placeOf(session, voice) !== null ||
    session.dropped.some((d) => d.id === voice) ||
    session.queue.includes(voice) ||
    session.current === voice
  )
}

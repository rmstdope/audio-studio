import { z } from 'zod'
import { VoiceSchema, type Candidate, type Voice } from './voiceSearch'

/** Where a voice on the board is: up to hear, or on the shortlist. */
const PlaceSchema = z.enum(['toHear', 'shortlist'])

/** Where a voice on the board is: up to hear, or on the shortlist. */
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
  /** The voices being listened to, in the order shown. */
  toHear: z.array(z.string()),
  /** Voices dropped in this audition, the latest last, and where each was. */
  dropped: z.array(z.object({ id: z.string(), from: PlaceSchema })),
  /** Ranked candidates not brought in yet. */
  queue: z.array(z.string()),
  voices: z.record(z.string(), VoiceSchema),
  /** The keywords each candidate matched. */
  matched: z.record(z.string(), z.array(z.string())),
  /** Dollars charged to this audition's paid takes over all its sittings (an estimate at list price). */
  spent: z.number().nonnegative().default(0),
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
    toHear: ids.slice(0, perRound),
    dropped: [],
    queue: ids.slice(perRound),
    voices,
    matched,
    spent: 0,
  }
}

/** The session with a voice moved from those to hear to the end of the shortlist. */
export function shortlist(session: AuditionSession, voice: string): AuditionSession {
  if (!session.toHear.includes(voice)) return session
  return {
    ...session,
    toHear: session.toHear.filter((v) => v !== voice),
    shortlist: [...session.shortlist, voice],
  }
}

/** The session with a voice moved off the shortlist, to the front of those to hear. */
export function unlist(session: AuditionSession, voice: string): AuditionSession {
  if (!session.shortlist.includes(voice)) return session
  return {
    ...session,
    shortlist: session.shortlist.filter((v) => v !== voice),
    toHear: [voice, ...session.toHear],
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
 * The session with a voice brought in by id, at the front of those to hear: from the queue, one
 * dropped earlier, or a new one. Unchanged if the voice is on the board already.
 */
export function addVoice(session: AuditionSession, voice: Voice): AuditionSession {
  if (placeOf(session, voice.id)) return session
  return {
    ...session,
    toHear: [voice.id, ...session.toHear],
    queue: session.queue.filter((id) => id !== voice.id),
    dropped: session.dropped.filter((d) => d.id !== voice.id),
    voices: { ...session.voices, [voice.id]: voice },
  }
}

/** Where a voice is on the board, or null if it is not on it. */
export function placeOf(session: AuditionSession, voice: string): Place | null {
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

/** The session with `dollars` more charged to its takes. */
export function addSpent(session: AuditionSession, dollars: number): AuditionSession {
  return dollars > 0 ? { ...session, spent: session.spent + dollars } : session
}

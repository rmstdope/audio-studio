import type { Candidate, Voice } from './voiceSearch'

/** What the user thinks of a voice in this round. */
export type Verdict = 'keep' | 'drop'

/**
 * An audition in progress for one character: the voices in the current round, verdicts on them,
 * the voices dropped in earlier rounds, and the candidates waiting to be brought in. Every voice
 * shown is kept in `voices`, so a saved session can be shown again without searching Fish.
 */
export interface AuditionSession {
  version: 1
  character: string
  /** The keywords the candidates were found with. */
  keywords: string[]
  /** The character's voice when the audition started, if any; it takes part in round 1. */
  current: string | null
  round: number
  /** Earlier rounds and how many voices each had. */
  rounds: { round: number; voices: number }[]
  /** The voices in this round, in the order shown. */
  pool: string[]
  verdicts: Record<string, Verdict>
  /** Voices dropped in earlier rounds; they never come back in this audition. */
  dropped: string[]
  /** Ranked candidates not brought in yet. */
  queue: string[]
  voices: Record<string, Voice>
  /** The keywords each candidate matched. */
  matched: Record<string, string[]>
}

/** The first round: the current voice (if any) and the top `perRound` candidates; the rest queue. */
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
    version: 1,
    character,
    keywords,
    current: current?.id ?? null,
    round: 1,
    rounds: [],
    pool: [...(current ? [current.id] : []), ...ids.slice(0, perRound)],
    verdicts: {},
    dropped: [],
    queue: ids.slice(perRound),
    voices,
    matched,
  }
}

/** The session with a verdict set (or cleared with null) on a voice in this round. */
export function setVerdict(
  session: AuditionSession,
  voice: string,
  verdict: Verdict | null,
): AuditionSession {
  if (!session.pool.includes(voice)) return session
  const { [voice]: _old, ...verdicts } = session.verdicts
  return { ...session, verdicts: verdict ? { ...verdicts, [voice]: verdict } : verdicts }
}

/** The voices of this round not dropped. */
export function remaining(session: AuditionSession): string[] {
  return session.pool.filter((voice) => session.verdicts[voice] !== 'drop')
}

/** Whether the next round can start: something was dropped, and something is left. */
export function canMoveOn(session: AuditionSession): boolean {
  const left = remaining(session).length
  return left > 0 && left < session.pool.length
}

/** The next round, with the voices not dropped; unchanged if it cannot start (`canMoveOn`). */
export function nextRound(session: AuditionSession): AuditionSession {
  if (!canMoveOn(session)) return session
  const dropped = session.pool.filter((voice) => session.verdicts[voice] === 'drop')
  return {
    ...session,
    round: session.round + 1,
    rounds: [...session.rounds, { round: session.round, voices: session.pool.length }],
    pool: remaining(session),
    verdicts: {},
    dropped: [...session.dropped, ...dropped],
  }
}

/** The session with up to `count` more candidates brought in from the queue. */
export function bringMore(session: AuditionSession, count: number): AuditionSession {
  if (!session.queue.length || count < 1) return session
  return {
    ...session,
    pool: [...session.pool, ...session.queue.slice(0, count)],
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

/** The session with a voice brought into this round by id; unchanged if it was seen before. */
export function addVoice(session: AuditionSession, voice: Voice): AuditionSession {
  if (seen(session, voice.id) && !session.queue.includes(voice.id)) return session
  return {
    ...session,
    pool: [...session.pool, voice.id],
    queue: session.queue.filter((id) => id !== voice.id),
    voices: { ...session.voices, [voice.id]: voice },
  }
}

/** The one voice left in this round, or null while there are more (or none). */
export function finalist(session: AuditionSession): string | null {
  const left = remaining(session)
  return left.length === 1 ? left[0]! : null
}

/** Every voice the session has shown or queued, the dropped ones included. */
export function seen(session: AuditionSession, voice: string): boolean {
  return (
    session.pool.includes(voice) ||
    session.dropped.includes(voice) ||
    session.queue.includes(voice) ||
    session.current === voice
  )
}

import type { AuditionSession } from '../core/audition'
import type { Appearance } from '../core/summary'
import { plural } from './format'

/**
 * The voices shown that need a take recorded: none yet, not being recorded, and not failed
 * before (a failed one is recorded again only when asked, so a broken voice is not tried forever).
 */
export function takesToRecord(
  voices: string[],
  takes: Record<string, string>,
  recording: Set<string>,
  errors: Record<string, string>,
): string[] {
  return voices.filter((v) => !takes[v] && !recording.has(v) && !errors[v])
}

/** What casting a voice does, in sentences, for the page to ask before casting. */
export function castEffects({
  name,
  current,
  replacing,
  recorded,
  titles,
  dropped,
  unheard,
}: {
  /** The character's name. */
  name: string
  /** The title of the character's voice now, if it has one. */
  current: string | null
  /** Whether the voice cast is another than the character's voice now. */
  replacing: boolean
  /** The character's recorded lines per part, all stale once cast (none when not replacing). */
  recorded: Appearance[]
  /** Short part titles by id. */
  titles: Map<string, string>
  /** Voices dropped in this audition and still ruled out. */
  dropped: number
  /** Voices still to hear, and queued. */
  unheard: number
}): string[] {
  const lines = replacing ? recorded.reduce((sum, a) => sum + a.lines, 0) : 0
  const effects: string[] = []
  if (lines) {
    const where = recorded.map((a) => `${titles.get(a.part) ?? a.part}: ${a.lines}`).join(', ')
    effects.push(
      `${plural(lines, 'recorded line')} ${lines === 1 ? 'goes' : 'go'} stale (${where}). ` +
        `${lines === 1 ? 'It records' : 'They record'} again the next time you generate.`,
    )
  }
  if (current && replacing) {
    effects.push(
      `${current} is no longer ${name}’s voice. It is not ruled out: it can come back in a later audition.`,
    )
  }
  const after = [
    dropped &&
      `the ${dropped === 1 ? 'voice' : `${dropped} voices`} you dropped ` +
        `${dropped === 1 ? 'stays' : 'stay'} ruled out`,
    // Only worth saying beside the dropped ones, which are ruled out.
    dropped &&
      unheard &&
      `the ${unheard} still to hear or waiting ${unheard === 1 ? 'is' : 'are'} not`,
  ]
    .filter(Boolean)
    .join('; ')
  effects.push(
    after
      ? `The audition ends. ${after.charAt(0).toUpperCase()}${after.slice(1)}.`
      : 'The audition ends.',
  )
  return effects
}

/** What stopping an audition without casting does, in sentences, for the page to ask first. */
export function stopEffects({
  name,
  current,
  lines,
  dropped,
  shortlisted,
}: {
  /** The character's name. */
  name: string
  /** The title of the character's voice now, if it has one. */
  current: string | null
  /** The character's lines, in every part. */
  lines: number
  /** Voices dropped in this audition and still ruled out. */
  dropped: number
  /** Voices on the shortlist other than the current one. */
  shortlisted: number
}): string[] {
  const effects = [
    current
      ? `Nothing changes in the cast: ${name} keeps ${current}.`
      : lines
        ? `${name} stays uncast: ${plural(lines, 'line')} cannot be recorded until it has a voice.`
        : `${name} stays uncast.`,
  ]
  if (dropped) {
    effects.push(
      dropped === 1
        ? 'The voice you dropped stays ruled out. You can allow it again from the list of ruled-out voices.'
        : `The ${dropped} voices you dropped stay ruled out. You can allow them again from the list of ruled-out voices.`,
    )
  }
  if (shortlisted) {
    effects.push(
      `The shortlist (${plural(shortlisted, 'voice')}) is let go: shortlisted and unheard voices can turn up again next time.`,
    )
  }
  return effects
}

/**
 * The voices dropped in the audition that are still ruled out: not the cast voice (never ruled
 * out), nor one allowed again since. With the ruled-out voices not known yet, every other drop.
 */
export function droppedRuledOut(
  dropped: AuditionSession['dropped'],
  ruledOut: string[] | null,
  current: string | null,
): string[] {
  return dropped.map((d) => d.id).filter((id) => isRuledOut(id, ruledOut, current))
}

/** Whether a voice is ruled out: never the cast voice; any other while the list is not known. */
export function isRuledOut(id: string, ruledOut: string[] | null, current: string | null): boolean {
  return id !== current && (ruledOut === null || ruledOut.includes(id))
}

/** The voice whose drop the page can offer to undo: the one it dropped, while that is the last. */
export function undoFor(
  droppedHere: string | null,
  dropped: AuditionSession['dropped'],
): string | null {
  return droppedHere !== null && dropped.at(-1)?.id === droppedHere ? droppedHere : null
}

/** What stopping an audition does, from its session and the voices ruled out now. */
export function stopEffectsFor(
  session: Pick<AuditionSession, 'current' | 'shortlist' | 'dropped'> & {
    voices: Record<string, { title: string }>
  },
  { name, lines, ruledOut }: { name: string; lines: number; ruledOut: string[] | null },
): string[] {
  const { current } = session
  return stopEffects({
    name,
    current: current ? session.voices[current]?.title || 'Untitled voice' : null,
    lines,
    dropped: droppedRuledOut(session.dropped, ruledOut, current).length,
    shortlisted: session.shortlist.filter((v) => v !== current).length,
  })
}

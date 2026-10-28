import type { FreeableVoice } from './api'
import type { AuditionSession } from '../core/audition'
import type { Appearance } from '../core/summary'
import { providerOf, type VoiceProvider } from '../core/voices'
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

/**
 * What a design that did not work says. Fish refusing is the only case where nothing was charged;
 * the studio failing after Fish answered may have cost $0.01; the studio's own reasons are said
 * as they are.
 */
export function designFailureLine(
  failure: { reason?: string; message?: string } | undefined,
): string {
  if (!failure?.message) return 'The project’s files need fixing.'
  if (failure.reason === 'fish') {
    return `Fish couldn’t design voices: ${failure.message.replace(/\.$/, '')}. Nothing was charged.`
  }
  if (failure.reason === 'failed') {
    return `The voices weren’t kept: ${failure.message.replace(/\.$/, '')}. Fish may have charged $0.01.`
  }
  return failure.message
}

/**
 * The line on a card whose voice could not be cast: a design Fish could not save to the account,
 * or a library voice ElevenLabs would not add to the user's voices.
 */
export function saveFailedLine(reason: string, provider: VoiceProvider = 'fish'): string {
  const why = reason.replace(/\.$/, '')
  return provider === 'fish'
    ? `Fish couldn’t save this voice: ${why}. It wasn’t cast.`
    : `ElevenLabs couldn’t add this voice: ${why}. It wasn’t cast.`
}

/** The voices on the board that are not designs, whose preview is their take. */
function boardVoices(session: AuditionSession): string[] {
  return [...session.shortlist, ...session.yours, ...session.toHear].filter(
    (id) => !session.voices[id]?.design,
  )
}

/**
 * The voices of the board that get a take recorded: Fish's, and ElevenLabs' once the audition has
 * credits for them (`credits`), except those waiting for a free voice slot (`slotWaiting`).
 */
export function recordable(
  session: AuditionSession,
  credits: boolean,
  slotWaiting: Set<string> = new Set(),
): string[] {
  return boardVoices(session).filter(
    (id) => (credits || providerOf(id) === 'fish') && !slotWaiting.has(id),
  )
}

/**
 * The library voices on the board whose take would add them to the user's ElevenLabs voices
 * (not added, no take yet) beyond the `slotsLeft` free voice slots, in board order: they wait for
 * a slot. None while the slots are unknown (null), as ElevenLabs refuses at its limit anyway;
 * none of those in `failed`, whose take failed and is not asked again.
 */
export function slotWaiters(
  session: AuditionSession,
  takes: Record<string, string>,
  slotsLeft: number | null,
  failed: Set<string> = new Set(),
): Set<string> {
  if (slotsLeft === null) return new Set()
  // A voice whose take failed is not asked again for this phrase, so it holds no slot.
  const adding = boardVoices(session).filter((id) => {
    const library = session.voices[id]?.library
    return library && !library.added && !takes[id] && !failed.has(id)
  })
  return new Set(adding.slice(Math.max(0, slotsLeft)))
}

/**
 * The voice slots free for library voices' takes: those the account had when last read
 * (`readAt`), less one for every take that may have added a voice since (`mayHaveAdded`, when
 * each answered), until the account is read again. Null while the slots are unknown.
 */
export function slotsLeftFor(
  slots: { used: number; limit: number } | null,
  mayHaveAdded: Map<string, number>,
  readAt: number,
): number | null {
  if (!slots) return null
  const since = [...mayHaveAdded.values()].filter((at) => at > readAt).length
  return slots.limit - slots.used - since
}

/** The line that says how many of the plan's ElevenLabs voice slots are used. */
export function slotsLine({ used, limit }: { used: number; limit: number }): string {
  return used >= limit
    ? `All ${limit} ElevenLabs voice slots are used: takes that would add a library voice wait until one is free.`
    : `ElevenLabs voice slots: ${used} of ${limit} used`
}

/** What freeing voice slots does, in sentences, for the page to ask before removing voices. */
export function freeEffects(voices: FreeableVoice[]): string[] {
  const names = voices.map((v) => v.name)
  const listed =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  const one = names.length === 1
  return [
    one
      ? `Removes ${listed} from your ElevenLabs voices. The studio added it in an audition; it is not cast or on an audition in progress in this project.`
      : `Removes ${listed} from your ElevenLabs voices. The studio added them in auditions; ${names.length === 2 ? 'neither' : 'none'} is cast or on an audition in progress in this project.`,
    `${one ? 'Its takes are' : 'Their takes are'} kept. A voice removed can be found in the library and added again.`,
    'Voices you added on ElevenLabs yourself are never removed. Another game using the same ElevenLabs account is not checked.',
  ]
}

/**
 * What a voice's take waits for: credits (an ElevenLabs voice without a take, in an audition given
 * none), a free voice slot (a library voice its take would add, at the plan's limit), or more of
 * its own money once the server made it wait; undefined when it does not wait.
 */
export function takeWaits(
  voice: string,
  {
    credits,
    waiting,
    take,
    slot = false,
  }: {
    credits: boolean
    waiting: Set<string>
    take: boolean
    /** Whether it waits for a free voice slot (see `slotWaiters`). */
    slot?: boolean
  },
): 'money' | 'credits' | 'more-credits' | 'slot' | undefined {
  const eleven = providerOf(voice) === 'elevenlabs'
  if (eleven && !credits && !take) return 'credits'
  if (eleven && slot && !take) return 'slot'
  if (!waiting.has(voice)) return undefined
  return eleven ? 'more-credits' : 'money'
}

/** The ElevenLabs voices on the board with no take, which wait while the audition has no credits. */
export function waitingForCredits(
  session: AuditionSession,
  takes: Record<string, string>,
): string[] {
  return boardVoices(session).filter((id) => providerOf(id) === 'elevenlabs' && !takes[id])
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
  language,
  stale,
  auditioning = true,
  saves = false,
  adds = false,
}: {
  /** The character's name. */
  name: string
  /** The language being cast, named, in a project with several. */
  language?: string
  /** What to say of the lines gone stale in place of the usual sentence (null: nothing). */
  stale?: string | null
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
  /** Whether an audition is going on, which casting ends (false: casting from the character's page). */
  auditioning?: boolean
  /** Whether the voice is a design, which is saved to the user's Fish account before it is cast. */
  saves?: boolean
  /** Whether the voice is from ElevenLabs' library and not yet added to the user's voices. */
  adds?: boolean
}): string[] {
  const lines = replacing ? recorded.reduce((sum, a) => sum + a.lines, 0) : 0
  const effects: string[] = []
  if (saves) {
    effects.push(
      `It is saved to your Fish account first, as a private voice named “${name} (designed)” (“${name} (designed 2)” and so on if that name is taken).`,
    )
  }
  if (adds) {
    effects.push(
      'It is added to your ElevenLabs voices first, using one of your plan’s voice slots.',
    )
  }
  if (stale !== undefined) {
    if (stale && lines) effects.push(stale)
  } else if (lines) {
    const where = recorded.map((a) => `${titles.get(a.part) ?? a.part}: ${a.lines}`).join(', ')
    effects.push(
      `${plural(lines, 'recorded line')} ${lines === 1 ? 'goes' : 'go'} stale (${where}). ` +
        `${lines === 1 ? 'It records' : 'They record'} again the next time you generate.`,
    )
  }
  if (current && replacing) {
    effects.push(
      `${current} is no longer ${name}’s ${language ? `${language} ` : ''}voice. It is not ruled out: it can come back in a later audition.`,
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
  if (!auditioning) return effects
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

/** The player's id for a voice's take. */
export function takeClip(voice: string): string {
  return `take:${voice}`
}

/** The player's id for Fish's sample of a voice. */
export function sampleClip(voice: string): string {
  return `sample:${voice}`
}

/** Whether the clip playing is the take or the sample of this voice. */
export function playsVoice(playing: string | null, voice: string): boolean {
  return playing === takeClip(voice) || playing === sampleClip(voice)
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

/**
 * What Your voices shows: `loading` until Fish has answered (also on a resume), `error` when
 * it could not list them and there are none to show, `none` when the account has none, `allUsed`
 * when all of them are shortlisted or ruled out, else the `cards`.
 */
export function ownSectionState(
  session: Pick<AuditionSession, 'yours' | 'mine'>,
  fetch: { fetched: boolean; error: string | null },
): 'loading' | 'error' | 'none' | 'allUsed' | 'cards' {
  if (fetch.error) return session.yours.length > 0 ? 'cards' : 'error'
  if (!fetch.fetched) return 'loading'
  if (session.yours.length > 0) return 'cards'
  return session.mine.length > 0 ? 'allUsed' : 'none'
}

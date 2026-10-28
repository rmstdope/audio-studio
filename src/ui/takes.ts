import { FREE_MODELS } from '../core/project'
import { providerOf } from '../core/voices'
import type { TakeLineResult } from '../services/lineTakes'
import { agreedOf, credits, type Agreed } from './agreed'
import { elevenModelName } from '../core/elevenSpeech'
import type { ElevenSpoken } from '../services/takes'

/** The part of an answer about the board that takes belong to. */
interface WithTakes {
  audition: { spoken: string }
  takes: Record<string, string>
}

/**
 * The answer with a newly recorded take added, if it is a take of the phrase it shows; a take of
 * a phrase changed since it was asked for is left out, so the old words never play as new.
 */
export function withTake<T extends WithTakes>(
  candidates: T,
  voice: string,
  take: { key: string; spoken: string; asked?: string },
): T {
  if ((take.asked ?? take.spoken) !== candidates.audition.spoken) return candidates
  return { ...candidates, takes: { ...candidates.takes, [voice]: take.key } }
}

/**
 * The answer with the audition phrase and takes from a fresh lookup. When the phrase is the
 * one already shown, takes recorded since the lookup was read are kept too; where both have a
 * take of a voice, the fresh one wins.
 */
export function withAuditionTakes<T extends WithTakes>(
  candidates: T,
  audition: T['audition'],
  takes: Record<string, string>,
): T {
  const same = audition.spoken === candidates.audition.spoken
  return { ...candidates, audition, takes: same ? { ...candidates.takes, ...takes } : takes }
}

/** The part of an answer about a character's cast voice that its take belongs to. */
interface VoiceTake {
  /** The cast voice's id, null when uncast. */
  id: string | null
  take: string | null
  audition: { spoken: string }
  lookup: { reason: string } | null
}

/**
 * The cast voice's answer with a newly recorded take of it, if the take is of that voice and of
 * the phrase shown (`asked`, for an ElevenLabs take said without its style).
 */
export function withVoiceTake<T extends VoiceTake>(
  answer: T,
  voice: string,
  take: { key: string; spoken: string; asked?: string },
): T {
  if (voice !== answer.id || (take.asked ?? take.spoken) !== answer.audition.spoken) return answer
  return { ...answer, take: take.key }
}

/**
 * What the character page asks to record by itself: the cast voice's take of the phrase shown,
 * when there is none, as a key to ask for it once by (phrase and voice). Nothing for an answer
 * about another voice than `castId` (an older one), without an API key, or for an ElevenLabs
 * voice, whose take costs credits and so waits for Record.
 */
export function takeToRecord(answer: VoiceTake, castId: string | null): string | null {
  if (
    !castId ||
    answer.id !== castId ||
    answer.take ||
    answer.lookup?.reason === 'no-key' ||
    providerOf(castId) !== 'fish'
  ) {
    return null
  }
  return `${answer.audition.spoken}\n${castId}`
}

/** Whether an answer about a character's cast voice is about `voiceId`, the voice cast now. */
export function isAbout(answer: { id: string | null }, voiceId: string | null): boolean {
  return answer.id === voiceId
}

/** The words of a line's takes list for its draft model: free, or paid and so asking first. */
export function extraTakeWords(model: string): { empty: string; hover: string } {
  if ((FREE_MODELS as readonly string[]).includes(model)) {
    return {
      empty:
        'No extra takes yet. Another take records the line once more, with the free model, to compare with the clip; it costs nothing and changes nothing until you use it.',
      hover: 'Record the line once more, with the free model, into the cache',
    }
  }
  return {
    empty: `No extra takes yet. Another take records the line once more with the draft model, ${model}, which is paid: it asks what it can cost before it spends, and changes nothing until you use it.`,
    hover: `Record the line once more, with the paid draft model ${model}, into the cache; asks before it spends`,
  }
}

/**
 * What the page does with the server's answer to Another take: the amount to ask the user to agree
 * to (dollars rounded up to the cent, as Record's are, or ElevenLabs credits), or the refusal to
 * spend to show under the button.
 * Any other failure is shown by the takes list itself.
 */
export function takeAnswerState(answer: NonNullable<TakeLineResult>): {
  toConfirm: Agreed | null
  refusal: string | null
} {
  if (answer.ok || !('reason' in answer)) return { toConfirm: null, refusal: null }
  const toConfirm = agreedOf(answer)
  if (toConfirm) return { toConfirm, refusal: null }
  if (answer.reason === 'credit' || answer.reason === 'credits' || answer.reason === 'price') {
    return { toConfirm: null, refusal: answer.message }
  }
  return { toConfirm: null, refusal: null }
}

/**
 * What a try or take with an ElevenLabs voice says beneath it: the model, the credits it cost (or
 * none, kept from before), and that its cues were left out when the model would speak them. Null
 * for a Fish voice's, which is free.
 */
export function triedNote(result: ElevenSpoken): string | null {
  if (!result.model) return null
  const name = elevenModelName(result.model)
  const cost =
    result.credits === undefined
      ? `Said with ${name}, already kept: no credits.`
      : `Said with ${name}: ${credits(Math.ceil(result.credits))}.`
  return result.cuesLeftOut
    ? `${cost} ${name} speaks cues aloud, so it was said without them.`
    : cost
}

import type { AuditionSession } from './audition'

/** The Fish model that designs voices. */
export const DESIGN_MODEL = 'voice-design-1'

/** What one successful design costs, in dollars. */
export const DESIGN_PRICE = 0.01

/** The longest description Fish takes, in characters. */
export const MAX_CHARS = 2000

/** From this many characters on, the page shows how close the description is to the limit. */
export const NEAR_CHARS = 1800

/** How many voices one design makes. */
export const DESIGN_COUNT = 4

/** The longest preview text Fish's API takes, in characters (its API reference; its guide says 300). */
const PREVIEW_CHARS = 150

/** The longest description a group heading shows before it is cut. */
const HEADING_CHARS = 80

/** What the description box allows and shows for the text in it. */
export interface DescriptionState {
  /** Whether Design voices… is enabled. */
  canSend: boolean
  /** The count line (`1,850 / 2,000`), or null while far from the limit. */
  count: string | null
  /** The line saying the text is too long, or null. */
  tooLong: string | null
}

/** Judges a description: it needs a word, and Fish takes `MAX_CHARS` characters at most. */
export function descriptionState(text: string): DescriptionState {
  const length = [...text.trim()].length
  const tooLong = length > MAX_CHARS
  return {
    canSend: length > 0 && !tooLong,
    count: length >= NEAR_CHARS ? `${length.toLocaleString('en-US')} / 2,000` : null,
    tooLong: tooLong ? `That’s longer than Fish takes: 2,000 characters at most.` : null,
  }
}

/**
 * The description a character's box starts with the first time: its casting keywords as a
 * sentence, then its delivery. Empty when it has neither.
 */
export function designStart(keywords: string[], style: string): string {
  const words = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .join(', ')
  const sentence = words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}.` : ''
  return [sentence, style.trim()].filter(Boolean).join(' ')
}

/**
 * The text each designed voice says: the audition phrase, cut at a word to what Fish takes as a
 * preview (a standard phrase is shorter, so it is rarely cut).
 */
export function previewText(phrase: string): string {
  const chars = [...phrase.trim()]
  if (chars.length <= PREVIEW_CHARS) return chars.join('')
  const cut = chars.slice(0, PREVIEW_CHARS).join('')
  const space = cut.lastIndexOf(' ')
  return space > 0 ? cut.slice(0, space).trimEnd() : cut
}

/**
 * The name a designed voice is saved under on the Fish account: `<name> (designed)`, then
 * `<name> (designed 2)` and so on, the first one the account does not have.
 */
export function savedName(name: string, existing: string[]): string {
  const taken = new Set(existing)
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${name} (designed)` : `${name} (designed ${n})`
    if (!taken.has(candidate)) return candidate
  }
}

/** A description as a group heading: in quotes, cut with an ellipsis when long. */
export function quoted(description: string): string {
  const chars = [...description.trim()]
  const text =
    chars.length > HEADING_CHARS ? `${chars.slice(0, HEADING_CHARS).join('')}…` : description.trim()
  return `“${text}”`
}

/** The designs made from one description in one request, as the board shows them. */
export interface DesignGroup {
  /** When the request was made (ISO 8601): the group's identity. */
  at: string
  description: string
  /** The voices still in the designed section, in the order they were made. */
  voices: string[]
}

/** The designed section as groups: newest request first, each group's voices in the order made. */
export function designGroups(session: AuditionSession): DesignGroup[] {
  const groups = new Map<string, DesignGroup>()
  const ordered = session.designed
    .map((id) => session.voices[id])
    .flatMap((voice) => (voice?.design ? [{ id: voice.id, ...voice.design }] : []))
    .sort((a, b) => a.n - b.n)
  for (const { id, at, description } of ordered) {
    const group = groups.get(at) ?? { at, description, voices: [] }
    group.voices.push(id)
    groups.set(at, group)
  }
  return [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

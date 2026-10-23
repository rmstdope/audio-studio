import type { CharacterSummary } from '../core/summary'

/** A part's short name: its title up to a colon (`Act I: The Call` → `Act I`). */
export function shortTitle(title: string): string {
  const colon = title.indexOf(':')
  return colon > 0 ? title.slice(0, colon) : title
}

/** A part's title after the colon, or the whole title (`Act I: The Call` → `The Call`). */
export function longTitle(title: string): string {
  const colon = title.indexOf(':')
  return colon > 0 ? title.slice(colon + 1).trim() || title : title
}

/** How a character's voice reads in the UI: its name, else its id shortened, else that it has none. */
export function voiceLabel(character: Pick<CharacterSummary, 'voice' | 'voiceName'>): string {
  if (character.voiceName) return character.voiceName
  if (character.voice) return `voice ${character.voice.slice(0, 8)}…`
  return 'No voice yet'
}

/** `1 line`, `2 lines`. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

const TINTS: [string, string][] = [
  ['#2e2414', '#ffc56b'],
  ['#10291f', '#5be3ae'],
  ['#142033', '#8fb5ff'],
  ['#2e1720', '#ff94a8'],
  ['#211c35', '#b9a9ff'],
  ['#2a241c', '#e3c9a0'],
]

/** A stable avatar background and ink for a character id. */
export function tintFor(id: string): { background: string; color: string } {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const [background, color] = TINTS[hash % TINTS.length]!
  return { background, color }
}

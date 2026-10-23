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

/** The number of avatar tints in the stylesheet (`--tint-1` … `--tint-6`). */
const TINTS = 6

/** A stable avatar background and ink for a character id, from the stylesheet's tint tokens. */
export function tintFor(id: string): { background: string; color: string } {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const tint = (hash % TINTS) + 1
  return { background: `var(--tint-${tint}-bg)`, color: `var(--tint-${tint})` }
}

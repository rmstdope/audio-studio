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

/** A count in few characters: `950`, `12.4k`, `1.2M`. */
export function compact(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${trim(count / 1000)}k`
  return `${trim(count / 1_000_000)}M`
}

function trim(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '')
}

/** An amount in US dollars, to the cent; a fraction of a cent above nothing says so. */
export function dollars(amount: number): string {
  if (amount < 0) return `-${dollars(-amount)}`
  if (amount > 0 && amount < 0.005) return 'under $0.01'
  return `$${amount.toFixed(2)}`
}

/**
 * An amount rounded up to the next cent: what a "Pay up to" button shows and sends, so the amount
 * agreed is never less than the amount shown, and never less than the cost.
 */
export function centsUp(amount: number): number {
  // Floating point can put a whole number of cents a hair above (0.42 * 100); the cent below is
  // taken only when it still covers the amount, so the result is never less than the amount.
  let cents = Math.ceil(amount * 100)
  if ((cents - 1) / 100 >= amount) cents -= 1
  // amount * 100 can itself round down onto a whole cent (0.35000000000000003 * 100 is 35).
  if (cents / 100 < amount) cents += 1
  return cents / 100
}

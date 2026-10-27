/** How long a take fades in and out when played in the studio until the project chooses: 0.2 s. */
export const DEFAULT_TAKE_FADE = 0.2

/** The lengths the Playing takes menu offers, in seconds (0 is no fade). */
export const FADE_LENGTHS: readonly number[] = [0, 0.1, 0.2, 0.5, 1, 2]

/** A fade length in the menu's words: "No fade", "0.1 s", "1 s". */
export function fadeLabel(seconds: number): string {
  return seconds === 0 ? 'No fade' : `${seconds} s`
}

/**
 * The menu's entries for a saved length: the six lengths, plus the saved one in its place by size
 * when it is not among them (a length set by hand in the project file).
 */
export function fadeEntries(saved: number): { seconds: number; label: string }[] {
  const lengths = FADE_LENGTHS.includes(saved)
    ? FADE_LENGTHS
    : [...FADE_LENGTHS, saved].sort((a, b) => a - b)
  return lengths.map((seconds) => ({ seconds, label: fadeLabel(seconds) }))
}

/** The line under the menu when a save failed: why, and the length the fade still is. */
export function fadeSaveFailure(reason: string, saved: number): string {
  const still = saved === 0 ? 'no fade' : fadeLabel(saved)
  return `Could not save the fade: ${reason}. It is still ${still}.`
}

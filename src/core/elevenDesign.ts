/** ElevenLabs' voice design model. */
export const ELEVEN_DESIGN_MODEL = 'eleven_ttv_v3'

/** How many voices one ElevenLabs design makes. */
export const ELEVEN_DESIGN_COUNT = 3

/** The fewest characters ElevenLabs' design previews say. */
const LEAST_CHARS = 100

/** The most characters ElevenLabs' design previews say, and what its own text may cost at most. */
const MOST_CHARS = 1000

/**
 * What the previews of an ElevenLabs design say: the audition phrase, then the character's own
 * lines in order (each once, not the phrase again) until there are ElevenLabs' least 100
 * characters, cut at a word within its 1,000. Null when she has too few words: ElevenLabs then
 * writes its own text.
 */
export function elevenDesignText(phrase: string, lines: string[]): string | null {
  const said = [phrase.trim()]
  const length = () => [...said.join(' ')].length
  for (const line of lines.map((l) => l.trim())) {
    if (length() >= LEAST_CHARS) break
    if (line && !said.includes(line)) said.push(line)
  }
  if (length() < LEAST_CHARS) return null
  const chars = [...said.join(' ')]
  if (chars.length <= MOST_CHARS) return chars.join('')
  const cut = chars.slice(0, MOST_CHARS).join('')
  const space = cut.lastIndexOf(' ')
  // At a word, unless that leaves too few characters (a line without spaces).
  const atWord = space > 0 ? cut.slice(0, space).trimEnd() : cut
  return [...atWord].length >= LEAST_CHARS ? atWord : cut
}

/** The fewest and most characters of a description ElevenLabs designs from. */
const DESCRIPTION_CHARS = { least: 20, most: 1000 }

/**
 * Judges a description for ElevenLabs: it takes 20 to 1,000 characters. The count line says how
 * many it has of the 20 it needs, or of the 1,000 near the end.
 */
export function elevenDescriptionState(text: string): {
  canSend: boolean
  count: string | null
  tooLong: string | null
} {
  const length = [...text.trim()].length
  const { least, most } = DESCRIPTION_CHARS
  const tooLong = length > most
  return {
    canSend: length >= least && !tooLong,
    count:
      length > 0 && length < least
        ? `${length} / ${least} characters at least`
        : length >= most - 100
          ? `${length.toLocaleString('en-US')} / ${most.toLocaleString('en-US')}`
          : null,
    tooLong: tooLong
      ? `That’s longer than ElevenLabs takes: ${most.toLocaleString('en-US')} characters at most.`
      : null,
  }
}

/** The credits an ElevenLabs design uses: one a character of its text, at most 1,000 for its own. */
export function elevenDesignCredits(text: string | null): number {
  return text === null ? MOST_CHARS : [...text].length
}

/** What designing with ElevenLabs does and costs, in sentences, for the page to ask first. */
export function elevenDesignPoints(
  name: string,
  auditioning: boolean,
  text: string | null,
): string[] {
  const points =
    text === null
      ? [
          `ElevenLabs makes ${ELEVEN_DESIGN_COUNT} voices from your description, each saying a text it writes: ${name}’s phrase and lines are under the ${LEAST_CHARS} characters it needs.`,
          `It uses as many credits as that text has characters, up to ${MOST_CHARS.toLocaleString('en-US')}, charged only if it works.`,
        ]
      : [
          `ElevenLabs makes ${ELEVEN_DESIGN_COUNT} voices from your description, each saying the audition phrase and ${name}’s lines (${elevenDesignCredits(text)} characters).`,
          `It uses ${elevenDesignCredits(text).toLocaleString('en-US')} credits of your ElevenLabs plan, charged only if it works.`,
        ]
  if (!auditioning) {
    points.push(
      `No audition is going on for ${name}: this starts one, and the voices join its board.`,
    )
  }
  return points
}

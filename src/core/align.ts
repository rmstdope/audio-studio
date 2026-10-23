/** One shown word and when it is spoken, in seconds from the clip's start. */
export interface TimedWord {
  word: string
  start: number
  end: number
}

/**
 * The shown words of a line (split on spaces, as the game's story view splits them), spread
 * evenly over the clip: what RetroQuest's narrate.py `align` gives when nothing was heard. Until
 * clips are transcribed (step 5), this keeps the manifest complete: one timing per shown word.
 */
export function spreadWords(text: string, duration: number): TimedWord[] {
  const tokens = text.split(' ')
  const step = duration / tokens.length
  return tokens.map((word, i) => ({
    word,
    start: round(Math.min(step * i, duration)),
    end: round(Math.min(step * (i + 1), duration)),
  }))
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}

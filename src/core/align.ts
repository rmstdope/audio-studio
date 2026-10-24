import { spokenText } from './spoken'

/** One shown word and when it is spoken, in seconds from the clip's start. */
export interface TimedWord {
  word: string
  start: number
  end: number
}

/** A word Whisper heard, with its times. */
export interface HeardWord {
  word: string
  start: number
  end: number
}

/** A stretch of speech Whisper heard, with its words. */
export interface HeardSegment {
  start: number
  end: number
  words?: HeardWord[]
}

const NUMBERS = new Map(
  'zero one two three four five six seven eight nine ten eleven twelve'
    .split(' ')
    .map((word, n): [string, string] => [word, String(n)]),
)

/** A word without case or punctuation (narrate.py `_plain`). */
function plain(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, '')
}

/** A word for comparison: plain, small numbers as digits, since Whisper writes "1" (`_norm`). */
function norm(word: string): string {
  const p = plain(word)
  return NUMBERS.get(p) ?? p
}

/** A matching block: `[a, b, size]`, as Python's `SequenceMatcher.get_matching_blocks`. */
export type Block = [number, number, number]

/**
 * The matching blocks of two word lists, exactly as Python's
 * `difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_matching_blocks()` gives them, so word
 * timings line up the way RetroQuest's narrate.py lines them up. Ends with `[len(a), len(b), 0]`.
 */
export function matchingBlocks(a: string[], b: string[]): Block[] {
  const b2j = new Map<string, number[]>()
  b.forEach((element, j) => {
    const list = b2j.get(element)
    if (list) list.push(j)
    else b2j.set(element, [j])
  })

  // difflib's find_longest_match: the longest common run, earliest in a, then earliest in b.
  const longest = (alo: number, ahi: number, blo: number, bhi: number): Block => {
    let besti = alo
    let bestj = blo
    let bestsize = 0
    let j2len = new Map<number, number>()
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>()
      for (const j of b2j.get(a[i]!) ?? []) {
        if (j < blo) continue
        if (j >= bhi) break
        const k = (j2len.get(j - 1) ?? 0) + 1
        next.set(j, k)
        if (k > bestsize) {
          besti = i - k + 1
          bestj = j - k + 1
          bestsize = k
        }
      }
      j2len = next
    }
    // With no junk and autojunk off, difflib's extension loops only grow equal neighbours.
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--
      bestj--
      bestsize++
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize++
    }
    return [besti, bestj, bestsize]
  }

  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]]
  const blocks: Block[] = []
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!
    const [i, j, k] = longest(alo, ahi, blo, bhi)
    if (!k) continue
    blocks.push([i, j, k])
    if (alo < i && blo < j) queue.push([alo, i, blo, j])
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi])
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2])

  const merged: Block[] = []
  let [i1, j1, k1] = [0, 0, 0]
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2
    else {
      if (k1) merged.push([i1, j1, k1])
      ;[i1, j1, k1] = [i2, j2, k2]
    }
  }
  if (k1) merged.push([i1, j1, k1])
  merged.push([a.length, b.length, 0])
  return merged
}

/**
 * The words that are names, plain: those of the cast's character names and of its pronunciations.
 * A word among them counts as a name even where a sentence starts (see `alignWords`).
 */
export function knownNames(cast: {
  speakers: Record<string, unknown>
  pronounce: Record<string, string>
}): Set<string> {
  const words = [...Object.keys(cast.speakers), ...Object.keys(cast.pronounce)].flatMap((name) =>
    name.split(/\s+/),
  )
  return new Set(words.map(norm).filter(Boolean))
}

/** Whether two words are one letter apart: one added, removed or changed. */
function oneLetterApart(x: string, y: string): boolean {
  if (x === y || Math.abs(x.length - y.length) > 1) return false
  let i = 0
  while (x[i] === y[i]) i++
  const [longer, shorter] = x.length >= y.length ? [x, y] : [y, x]
  return longer.slice(i + 1) === shorter.slice(x.length === y.length ? i + 1 : i)
}

/**
 * Whether a shown word starts a sentence: the line's first, one after a word ending in . ! ? or …,
 * or one opening a quote.
 */
function startsSentence(tokens: string[], i: number): boolean {
  return i === 0 || /^["“‘(]/.test(tokens[i]!) || /[.!?…]["'”’)\]]*$/.test(tokens[i - 1]!)
}

/**
 * Whether a heard word is a name as Whisper spells it ("Aren" as "Arn"): the shown word is
 * capitalised, not where a sentence starts (where every word is) unless it is a known name, of at
 * least four letters (apostrophes and a possessive 's not counted) and nothing else, and the heard
 * one is one letter apart. Lowercase words, short ones and numbers are left out, where one letter
 * makes another word ("never" and "ever", "was" and "has", 1984 and 1985).
 */
function spelledAlike(
  tokens: string[],
  i: number,
  want: string,
  got: string,
  names: ReadonlySet<string>,
): boolean {
  const shown = tokens[i]!
  if (!/^[^A-Za-z0-9]*[A-Z]/.test(shown)) return false
  if (startsSentence(tokens, i) && !names.has(norm(shown))) return false
  const letters = (word: string) =>
    /^[a-z']+$/.test(word) && word.replace(/'s$/, '').replace(/'/g, '').length >= 4
  return letters(want) && /^[a-z']+$/.test(got) && oneLetterApart(want, got)
}

/**
 * Every shown word with a start and end from Whisper's words (narrate.py `align`): words matched
 * to a heard word take its times; unmatched words share the gap between their matched neighbours
 * evenly. Between two matches with as many words heard as shown (not counting punctuation, like a
 * dash, that nobody says), a name heard in its place one letter off (`spelledAlike`; `names` are
 * the known ones, see `knownNames`) counts as matched too, unlike narrate.py, so a name Whisper
 * spells its own way is not taken for a word missed. `said` is the same words as actually said
 * (see `saidWords`), compared in place of the shown ones. Returns the timed words and the share of
 * words that were heard.
 */
export function alignWords(
  tokens: string[],
  heard: HeardWord[],
  duration: number,
  said?: string[],
  names: ReadonlySet<string> = new Set(),
): { timed: TimedWord[]; ratio: number } {
  const want = (said && said.length === tokens.length ? said : tokens).map(norm)
  const got = heard.map((w) => norm(w.word))
  const times: ([number, number] | null)[] = tokens.map(() => null)
  let wantFrom = 0
  let gotFrom = 0
  for (const [a, b, size] of matchingBlocks(want, got)) {
    // The words of the gap before this match, punctuation left out, paired in order.
    const shown: number[] = []
    for (let i = wantFrom; i < a; i++) if (want[i]) shown.push(i)
    const said: number[] = []
    for (let j = gotFrom; j < b; j++) if (got[j]) said.push(j)
    if (shown.length === said.length) {
      shown.forEach((i, k) => {
        const w = heard[said[k]!]!
        if (spelledAlike(tokens, i, want[i]!, got[said[k]!]!, names)) times[i] = [w.start, w.end]
      })
    }
    for (let k = 0; k < size; k++) {
      const w = heard[b + k]!
      times[a + k] = [w.start, w.end]
    }
    wantFrom = a + size
    gotFrom = b + size
  }
  const matched = times.filter((t) => t !== null).length

  let i = 0
  while (i < tokens.length) {
    if (times[i]) {
      i++
      continue
    }
    let j = i
    while (j < tokens.length && !times[j]) j++
    const left = i > 0 ? times[i - 1]![1] : 0
    const right = Math.max(j < tokens.length ? times[j]![0] : duration, left)
    const step = (right - left) / (j - i)
    for (let k = i; k < j; k++) times[k] = [left + step * (k - i), left + step * (k - i + 1)]
    i = j
  }

  const timed: TimedWord[] = []
  let last = 0
  tokens.forEach((word, k) => {
    const [rawStart, rawEnd] = times[k]!
    const start = Math.min(Math.max(rawStart, last), duration)
    const end = Math.min(Math.max(rawEnd, start), duration)
    timed.push({ word, start: pyRound(start), end: pyRound(end) })
    last = start
  })
  return { timed, ratio: tokens.length ? matched / tokens.length : 1 }
}

/**
 * Whisper's words, without what it invents over trailing silence (narrate.py `heard_words`):
 * near-empty segments, and segments starting once the speech is over. A real last segment may
 * still end a little past the clip, and is kept.
 */
export function heardWords(segments: HeardSegment[], duration: number): HeardWord[] {
  return segments
    .filter((s) => s.end - s.start >= 0.3 && s.start < duration - 0.1)
    .flatMap((s) => s.words ?? [])
}

/**
 * The shown words as they are said: the cast's pronunciations applied to the whole line
 * (narrate.py `said_words`). Falls back to the shown words when a pronunciation changes the word
 * count, since the timings must line up one to one with the shown words.
 */
export function saidWords(text: string, pronounce: Record<string, string>): string[] {
  const shown = text.split(' ')
  const said = spokenText(text, '', pronounce).split(' ')
  return said.length === shown.length ? said : shown
}

/**
 * The shown words of a line (split on spaces, as the game's story view splits them), spread
 * evenly over the clip: what alignment gives when nothing was heard. Used when clips are not
 * transcribed.
 */
export function spreadWords(text: string, duration: number): TimedWord[] {
  return alignWords(text.split(' '), [], duration).timed
}

/**
 * `seconds` rounded to milliseconds exactly as Python's `round(x, 3)` does: the exact binary value
 * rounded to the nearest, and an exact tie (only possible for a few dyadic values) to the even
 * millisecond. `toFixed` rounds the exact value too, but sends ties up.
 */
export function pyRound(seconds: number): number {
  const below = Math.floor(seconds * 1000)
  const twice = 2 * below + 1
  if (twice % 125 === 0 && twice / 2000 === seconds) {
    return (below % 2 === 0 ? below : below + 1) / 1000
  }
  return Number(seconds.toFixed(3))
}

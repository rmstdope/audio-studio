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

/**
 * A word without case or punctuation (narrate.py `_plain`). Apostrophes stay inside a word
 * ("don't") but not at its ends, where they are single quotes around speech ("'You",
 * "will.'"), unlike narrate.py, which kept them and so never matched a quoted word. A possessive
 * is one word however it is written, since Whisper cannot hear which: "Sorceress's" and
 * "Sorceress'" are "sorceress", "founder's" and "founders'" are "founders". An ampersand is the
 * word "and" ("&L." is "andl", two words heard as one: see `alignGap`).
 */
function plain(word: string): string {
  return word
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '')
    .replace(/s?'s$/, 's')
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
 * The known names, plain: the cast's one-word character ids and pronunciations ("aren", "Lyria").
 * Ids of several words describe a character ("ancient tree spirit") and are left out, so their
 * words are not taken for names. A known name counts as one even where a sentence starts (see
 * `alignWords`).
 */
export function knownNames(cast: {
  speakers: Record<string, unknown>
  pronounce: Record<string, string>
}): Set<string> {
  const names = [...Object.keys(cast.speakers), ...Object.keys(cast.pronounce)]
  return new Set(
    names
      .filter((name) => !/\s/.test(name))
      .map(bare)
      .filter(Boolean),
  )
}

/** A word plain, without a possessive 's: what a name is looked up by ("Aren's" is "aren"). */
function bare(word: string): string {
  return norm(word.replace(/'s(?=[^A-Za-z0-9]*$)/i, ''))
}

/** Whether a plain word is letters and apostrophes only, `min` letters or more. */
function isWord(word: string, min = 0): boolean {
  return /^[a-z']+$/.test(word) && word.replace(/'/g, '').length >= min
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
 * Whether a shown word starts a sentence: the line's first, one after a word ending in . ! ? … or
 * a colon (a title's "Act I: The Call"), or one opening a quote.
 */
function startsSentence(tokens: string[], i: number): boolean {
  return i === 0 || /^["“‘'(]/.test(tokens[i]!) || /[.!?…:]["'”’)\]]*$/.test(tokens[i - 1]!)
}

/**
 * A word as it sounds, roughly: common spellings of one sound made the same, so a name Whisper
 * spells by its sound ("Malachar" for "Malakar", "Sesily" for "Cecily") is told from one it
 * misheard. Only the spellings that are safe in names: ch as k only between vowels (not the ch of
 * "church"), c as s before e, i and y, else as k, and ck, q as k, igh as i, ph as f, y as i, z as s,
 * doubled letters as one.
 */
function soundOf(word: string): string {
  return word
    .replace(/'/g, '')
    .replace(/igh/g, 'i')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/([aeiou])ch(?=[aeiou])/g, '$1k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c(?!h)/g, 'k')
    .replace(/q/g, 'k')
    .replace(/y/g, 'i')
    .replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1')
}

/**
 * Whether a heard word is a name as Whisper spells it ("Aren" as "Arn"): the shown word is
 * capitalised (not all capitals, which is emphasis), not where a sentence starts (where every word
 * is) unless it is a known name, of at least four letters as said (apostrophes and a possessive
 * 's not counted) and nothing else, and the heard one is one letter apart, as spelled or as they
 * sound (`soundOf`, where that leaves four letters), or, for a known name heard as one word
 * Whisper wrote as a name (`asName`), only its vowels other as they sound (`vowelsApart`).
 * Lowercase words, short ones and numbers are left out, where one letter makes another word
 * ("never" and "ever", "was" and "has", 1984 and 1985).
 */
function spelledAlike(
  shown: string,
  atStart: boolean,
  said: string,
  got: string,
  names: ReadonlySet<string>,
  asName = false,
): boolean {
  const want = norm(said)
  if (!capitalised(shown) || !/[a-z]/.test(shown)) return false
  const known = names.has(bare(shown))
  if (atStart && !known) return false
  if (!isWord(bare(said), 4) || !isWord(want) || !isWord(got)) return false
  if (oneLetterApart(want, got)) return true
  // As they sound, only while that leaves four letters: fewer, and one off is another name.
  const [a, b] = [soundOf(want), soundOf(got)]
  if (Math.min(a.length, b.length) >= 4 && (a === b || oneLetterApart(a, b))) return true
  // A known name with other vowels ("Elior" as "Ilyar"), heard as one word Whisper wrote as a name.
  return known && asName && vowelsApart(a, b)
}

/** Whether a word starts with a capital, past any quotes or brackets. */
function capitalised(word: string): boolean {
  return /^[^A-Za-z0-9]*[A-Z]/.test(word)
}

/**
 * Whether Whisper wrote the `i`th of `words` as a name: capitalised where no sentence of its
 * starts, since it capitalises every word that does ("More, wait" is no name).
 */
function writtenAsName(words: string[], i: number): boolean {
  return capitalised(words[i]!) && !startsSentence(words, i)
}

/**
 * Whether two words as they sound differ only in their vowels, one for one ("elior" and "iliar"),
 * and have two consonants or more, which tell the word.
 */
function vowelsApart(x: string, y: string): boolean {
  const vowel = (c: string) => 'aeiou'.includes(c)
  if (x.length !== y.length || x.replace(/[aeiou]/g, '').length < 2) return false
  return [...x].every((c, k) => c === y[k] || (vowel(c) && vowel(y[k]!)))
}

/** Hyphens and dashes, which join words written without spaces ("resin-sweet", "leaf—Mira's"). */
const JOINS = /[-‐‑‒–—―]+/

/** A part of a shown word: the word it belongs to, as shown and as compared. */
interface Piece {
  token: number
  shown: string
  want: string
  /** As said, before it is compared. */
  said: string
  /** As compared for a compound: plain, number words left as words ("every one" is "everyone"). */
  spelled: string
  /** Whether it starts a sentence (only a word's first part can). */
  atStart: boolean
}

/**
 * The parts of the shown words `from` to `to`, split at hyphens and dashes, punctuation beside a
 * dash left out ("thought—\"" is "thought"); a word that is only punctuation has none. A part after
 * a dash is taken for a sentence start. The parts as said replace the shown ones; a word said in
 * other parts than shown is one part, as said.
 */
function piecesOf(tokens: string[], said: string[], from: number, to: number): Piece[] {
  const partsOf = (word: string) => word.split(JOINS).filter((part) => norm(part))
  const piece = (token: number, shown: string, word: string, atStart: boolean): Piece => ({
    token,
    shown,
    want: norm(word),
    said: word,
    spelled: plain(word),
    atStart,
  })
  const pieces: Piece[] = []
  for (let i = from; i < to; i++) {
    const shown = partsOf(tokens[i]!)
    const spoken = partsOf(said[i]!)
    const atStart = startsSentence(tokens, i)
    // Said in other parts than shown ("Elior" as "El-ee-or"): the word as said, whole.
    if (spoken.length !== shown.length) pieces.push(piece(i, tokens[i]!, said[i]!, atStart))
    // A part after a dash starts a sentence as a word does ("Wait—Where"): no name is guessed
    // there unless it is a known one.
    else spoken.forEach((part, k) => pieces.push(piece(i, shown[k]!, part, k > 0 || atStart)))
  }
  return pieces
}

/**
 * Whisper's words split at hyphens and dashes as the shown ones are, each part an even share of
 * the word's time; punctuation it wrote on its own is left out.
 */
function heardParts(heard: HeardWord[]): HeardWord[] {
  return heard.flatMap((w) => {
    const parts = w.word.split(JOINS).filter((part) => norm(part))
    const step = (w.end - w.start) / parts.length
    return parts.map((word, k) => ({
      word,
      start: w.start + step * k,
      end: w.start + step * (k + 1),
    }))
  })
}

/**
 * How many words in a row (two or more) spell `word` together, as a compound heard apart ("silver
 * leaf" for "silverleaf") or heard as one ("everyone" for "every one"); 0 if none do.
 */
function spelledBy(word: string, words: string[]): number {
  let spelled = words[0] ?? ''
  for (let n = 2; n <= words.length && spelled.length < word.length; n++) {
    spelled += words[n - 1]
    if (spelled === word) return n
  }
  return 0
}

/**
 * The shown words `from` to `to` that whole-word matching left unmatched, against the heard words
 * `hFrom` to `hTo` between the same matches, compared by their parts: the parts first matched
 * exactly, then, between those, a compound heard apart or words heard as one, and, while the
 * words line up one to one, a name heard in its place one letter off (`spelledAlike`). Gives each
 * shown word whose parts were all heard the span of their times.
 */
function alignGap(
  tokens: string[],
  said: string[],
  heard: HeardWord[],
  names: ReadonlySet<string>,
  [from, to]: [number, number],
  [hFrom, hTo]: [number, number],
  times: ([number, number] | null)[],
): void {
  // As narrate.py's matching and main did: where as many words were heard as shown, a name heard
  // in its place one letter off, word for word.
  const shownWords: number[] = []
  for (let i = from; i < to; i++) if (norm(said[i]!)) shownWords.push(i)
  const written = heard.map((w) => w.word.trim())
  const heardWords: number[] = []
  for (let j = hFrom; j < hTo; j++) if (norm(heard[j]!.word)) heardWords.push(j)
  if (shownWords.length === heardWords.length) {
    shownWords.forEach((i, k) => {
      const w = heard[heardWords[k]!]!
      const atStart = startsSentence(tokens, i)
      if (
        spelledAlike(
          tokens[i]!,
          atStart,
          said[i]!,
          norm(w.word),
          names,
          writtenAsName(written, heardWords[k]!),
        )
      ) {
        times[i] = [w.start, w.end]
      }
    })
  }

  const pieces = piecesOf(tokens, said, from, to)
  const parts = heardParts(heard.slice(hFrom, hTo))
  // The heard words before the gap, then its parts, to tell where Whisper starts a sentence.
  const partsWritten = [...written.slice(0, hFrom), ...parts.map((p) => p.word.trim())]
  if (!pieces.length || !parts.length) return
  const want = pieces.map((p) => p.want)
  const got = parts.map((w) => norm(w.word))
  const gotSpelled = parts.map((w) => plain(w.word))
  const at: ([number, number] | null)[] = pieces.map(() => null)
  const take = (p: number, first: number, last = first) =>
    (at[p] = [parts[first]!.start, parts[last]!.end])

  /**
   * How the parts from `s` pair with the heard ones from `h`: a compound heard apart, words heard
   * as one (the heard word's time shared evenly), or, when `guess` allows it, a name spelled one
   * letter off, heard as one part or more ("El-eor" for "El-ee-or") where as many are left on
   * both sides after it, up to `sTo` and `hTo`. Null if they do not pair there.
   */
  const pairing = (s: number, h: number, sTo: number, hTo: number, guess: boolean) => {
    if (s >= sTo || h >= hTo) return null
    const apart = spelledBy(pieces[s]!.spelled, gotSpelled.slice(h, hTo))
    if (apart) return { shown: 1, heard: apart, apply: () => take(s, h, h + apart - 1) }
    const together = spelledBy(
      gotSpelled[h]!,
      pieces.slice(s, sTo).map((p) => p.spelled),
    )
    if (together) {
      const { start, end } = parts[h]!
      const step = (end - start) / together
      const apply = () => {
        for (let n = 0; n < together; n++) at[s + n] = [start + step * n, start + step * (n + 1)]
      }
      return { shown: together, heard: 1, apply }
    }
    const n = hTo - h - (sTo - s - 1)
    if (!guess || n < 1) return null
    const piece = pieces[s]!
    const spelled = got.slice(h, h + n).join('')
    const asName = n === 1 && writtenAsName(partsWritten, hFrom + h)
    if (!spelledAlike(piece.shown, piece.atStart, piece.said, spelled, names, asName)) return null
    return { shown: 1, heard: n, apply: () => take(s, h, h + n - 1) }
  }

  let s = 0
  let h = 0
  for (const [a, b, size] of matchingBlocks(want, got)) {
    // Once the words between two exact matches no longer line up one to one, no name is guessed.
    let lined = true
    while (s < a && h < b) {
      const here = pairing(s, h, a, b, lined)
      if (here) {
        here.apply()
        s += here.shown
        h += here.heard
      } else if (pairing(s + 1, h, a, b, false)) {
        s += 1 // A shown part not heard.
      } else if (pairing(s, h + 1, a, b, false)) {
        h += 1 // A heard word not shown.
      } else if (a - s !== b - h) {
        if (a - s > b - h) s += 1
        else h += 1
        lined = false
      } else {
        s += 1
        h += 1
      }
    }
    for (let k = 0; k < size; k++) take(a + k, b + k)
    s = a + size
    h = b + size
  }

  // A shown word is heard when all its parts are, and spans them (unless forgiven whole above).
  for (let i = from; i < to; i++) {
    if (times[i]) continue
    const mine = pieces.flatMap((piece, p) => (piece.token === i ? [at[p]] : []))
    const spans = mine.filter((span): span is [number, number] => span !== null)
    if (!mine.length || spans.length < mine.length) continue
    times[i] = [Math.min(...spans.map((t) => t[0])), Math.max(...spans.map((t) => t[1]))]
  }
}

/**
 * Every shown word with a start and end from Whisper's words (narrate.py `align`): words matched
 * to a heard word take its times; unmatched words share the gap between their matched neighbours
 * evenly. Unlike narrate.py, the words whole-word matching leaves unmatched are compared by their
 * parts, split at hyphens and dashes on both sides, with compounds and names forgiven
 * (`alignGap`); such a word is heard when all its parts are. `said` is the same words as actually
 * said (see `saidWords`), compared in place of the shown ones; `names` are the known names (see
 * `knownNames`). Returns the timed words, the share of words that were heard, and the indices of
 * the shown words that were not (`missed`).
 */
export function alignWords(
  tokens: string[],
  heard: HeardWord[],
  duration: number,
  said?: string[],
  names: ReadonlySet<string> = new Set(),
): { timed: TimedWord[]; ratio: number; missed: number[] } {
  const spoken = said && said.length === tokens.length ? said : tokens
  const want = spoken.map(norm)
  const got = heard.map((w) => norm(w.word))
  const times: ([number, number] | null)[] = tokens.map(() => null)
  let wantFrom = 0
  let gotFrom = 0
  for (const [a, b, size] of matchingBlocks(want, got)) {
    alignGap(tokens, spoken, heard, names, [wantFrom, a], [gotFrom, b], times)
    for (let k = 0; k < size; k++) {
      const w = heard[b + k]!
      times[a + k] = [w.start, w.end]
    }
    wantFrom = a + size
    gotFrom = b + size
  }
  const missed = tokens.flatMap((_, k) => (times[k] ? [] : [k]))
  const matched = tokens.length - missed.length

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
  return { timed, ratio: tokens.length ? matched / tokens.length : 1, missed }
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

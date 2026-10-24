import { describe, expect, it } from 'bun:test'
import {
  alignWords,
  heardWords,
  knownNames,
  matchingBlocks,
  pyRound,
  saidWords,
  spreadWords,
  type HeardWord,
} from './align'

describe('spreadWords', () => {
  it('spreads the shown words evenly over the clip, as narrate.py does with nothing heard', () => {
    expect(spreadWords('a b', 2)).toEqual([
      { word: 'a', start: 0, end: 1 },
      { word: 'b', start: 1, end: 2 },
    ])
  })

  it('gives one entry per space-separated word, rounded to milliseconds', () => {
    const words = spreadWords('One, two three.', 1)
    expect(words.map((w) => w.word)).toEqual(['One,', 'two', 'three.'])
    expect(words[1]).toEqual({ word: 'two', start: 0.333, end: 0.667 })
  })
})

/** Whisper's words, as narrate.py's tests write them. */
function words(...triples: [string, number, number][]): HeardWord[] {
  return triples.map(([word, start, end]) => ({ word, start, end }))
}

describe('alignWords (ported from narrate.py and its tests)', () => {
  it('takes Whisper’s times for an exact match', () => {
    const heard = words([' She', 0.1, 0.3], [' stops', 0.3, 0.6], [' here.', 0.7, 1.0])
    const { timed, ratio } = alignWords(['She', 'stops', 'here.'], heard, 1.2)
    expect(ratio).toBe(1)
    expect(timed).toEqual([
      { word: 'She', start: 0.1, end: 0.3 },
      { word: 'stops', start: 0.3, end: 0.6 },
      { word: 'here.', start: 0.7, end: 1.0 },
    ])
  })

  it('ignores case and punctuation', () => {
    const heard = words(['come', 0.0, 0.2], ['in', 0.2, 0.4], ['child', 0.5, 0.9])
    const { timed, ratio } = alignWords(['Come', 'in,', 'child.'], heard, 1.0)
    expect(ratio).toBe(1)
    expect(timed.map((w) => w.start)).toEqual([0.0, 0.2, 0.5])
  })

  it('spreads unheard words between their neighbours', () => {
    const heard = words(
      ['I', 0.0, 0.2],
      ['am', 0.2, 0.4],
      ['Bowling', 0.5, 0.9],
      ['the', 1.0, 1.1],
      ['smith', 1.1, 1.6],
    )
    const { timed, ratio } = alignWords(['I', 'am', 'Borin,', 'the', 'smith.'], heard, 2.0)
    expect(ratio).toBeCloseTo(4 / 5, 9)
    const borin = timed[2]!
    expect(borin.word).toBe('Borin,')
    expect(borin.start).toBeGreaterThanOrEqual(0.4)
    expect(borin.start).toBeLessThan(borin.end)
    expect(borin.end).toBeLessThanOrEqual(1.0)
  })

  it('never goes backwards and stays inside the clip', () => {
    const { timed } = alignWords(['one', 'two', 'three', 'four'], words(['three', 0.9, 1.2]), 1.5)
    const starts = timed.map((w) => w.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(timed[0]!.start).toBeGreaterThanOrEqual(0)
    expect(timed.at(-1)!.end).toBeLessThanOrEqual(1.5)
  })

  it('spreads the words over the clip when nothing was heard', () => {
    const { timed, ratio } = alignWords(['a', 'b'], [], 2.0)
    expect(ratio).toBe(0)
    expect(timed[0]!.start).toBe(0)
    expect(timed.at(-1)!.end).toBe(2)
  })

  it('compares against the words as said', () => {
    const said = saidWords('Act I: The Call', { 'Act I:': 'Act One:' })
    const heard = words(['Act', 0.0, 0.3], ['1', 0.3, 0.9], ['The', 1.0, 1.2], ['Call', 1.2, 1.6])
    const { timed, ratio } = alignWords(['Act', 'I:', 'The', 'Call'], heard, 2.0, said)
    expect(ratio).toBe(1)
    expect(timed[1]).toEqual({ word: 'I:', start: 0.3, end: 0.9 })
  })

  it('lets a pronunciation change only its own phrase', () => {
    const text = 'I knew your parents. Once you are ready, I will tell you.'
    const pronounce = { 'Act I:': 'Act One:' }
    expect(saidWords(text, pronounce)).toEqual(text.split(' '))
    const heard = words(...text.split(' ').map((w, i): [string, number, number] => [w, i, i + 0.5]))
    expect(alignWords(text.split(' '), heard, 30, saidWords(text, pronounce)).ratio).toBe(1)
  })

  it('counts a word pronounced otherwise that Whisper wrote as shown (Act II for Act Two)', () => {
    const text = 'Act II: The Gathering Storm'
    const said = saidWords(text, { 'Act II:': 'Act Two:' })
    const heardAs = (line: string) =>
      words(...line.split(' ').map((w, i): [string, number, number] => [w, i, i + 0.5]))
    expect(alignWords(text.split(' '), heardAs('Act II The Gathering Storm'), 9, said).ratio).toBe(
      1,
    )
    expect(alignWords(text.split(' '), heardAs('Act 2: The Gathering Storm'), 9, said).ratio).toBe(
      1,
    )
    expect(
      alignWords(text.split(' '), heardAs('Act III The Gathering Storm'), 9, said).missed,
    ).toEqual([1])
  })

  it('falls back to the shown words when a pronunciation changes the word count', () => {
    expect(saidWords('Malakar waits', { Malakar: 'Mala kar' })).toEqual(['Malakar', 'waits'])
  })

  it('treats a number word and its digits alike', () => {
    expect(
      alignWords(['Act', 'I:'], words(['Act', 0.0, 0.3], ['1', 0.3, 0.9]), 1.0, ['Act', 'One:'])
        .ratio,
    ).toBe(1)
    expect(
      alignWords(['three', 'words'], words(['3', 0.0, 0.3], ['words', 0.3, 0.9]), 1.0).ratio,
    ).toBe(1)
  })
})

describe('alignWords, words joined by hyphens and dashes', () => {
  const heardAs = (...said: string[]) =>
    words(...said.map((w, i): [string, number, number] => [w, i, i + 0.5]))
  const text = "Bundles of resin-sweet stems and silverleaf—Mira's blends for steadying wounds."

  it('compares the parts of joined words, and a compound heard as two words', () => {
    const heard = heardAs(
      ..."bundles of resin sweet stems and silver leaf, Mira's blends for steadying wounds.".split(
        ' ',
      ),
    )
    const { timed, ratio } = alignWords(text.split(' '), heard, 20)
    expect(ratio).toBe(1)
    expect(timed[2]).toEqual({ word: 'resin-sweet', start: 2, end: 3.5 })
    expect(timed[5]).toEqual({ word: "silverleaf—Mira's", start: 6, end: 8.5 })
  })

  it('misses a joined word when one of its parts is not heard', () => {
    const heard = heardAs(
      ...'bundles of resin sweet stems and silver leaf, mirrors blends for steadying wounds.'.split(
        ' ',
      ),
    )
    const { ratio, missed } = alignWords(text.split(' '), heard, 20)
    expect(missed).toEqual([5])
    expect(ratio).toBe(9 / 10)
  })

  it('compares a compound heard joined, or as one word, with the words shown apart', () => {
    expect(alignWords(['resin', 'sweet', 'stems'], heardAs('resin-sweet', 'stems'), 3).ratio).toBe(
      1,
    )
    expect(alignWords(['silver', 'leaf', 'blends'], heardAs('silverleaf', 'blends'), 3).ratio).toBe(
      1,
    )
  })

  it('leaves punctuation beside a dash out of the parts', () => {
    const ratio = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9).ratio
    expect(ratio('I thought—" she said.', 'I thought, she said.')).toBe(1)
    expect(ratio('"—and then', 'and then')).toBe(1)
    expect(ratio('Wait—! Now.', 'Wait! Now.')).toBe(1)
    expect(ratio('well—... yes', 'well... yes')).toBe(1)
  })

  it('matches a joined word heard as written, numbers too, beside a word misheard', () => {
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9).missed
    expect(missed('old one-eyed Borin', 'old one-eyed Borin')).toEqual([])
    expect(missed('twenty-one men', 'twenty-one men')).toEqual([])
    expect(missed('the bright resin-sweet stems', 'the white resin-sweet stems')).toEqual([1])
    expect(missed('the bright silverleaf grows', 'the white silver leaf grows')).toEqual([1])
    expect(missed('the silverleaf bright grows', 'the silver leaf white grows')).toEqual([2])
  })

  it('spreads a joined word partly heard between its neighbours, as one not heard', () => {
    const { timed } = alignWords(
      ['a', 'silverleaf—Mira', 'b'],
      heardAs('a', 'silver', 'leaf', 'mirrors', 'b'),
      5,
    )
    expect(timed[1]).toEqual({ word: 'silverleaf—Mira', start: 0.5, end: 4 })
  })

  it('matches whole words first, so a part does not take a word heard on its own', () => {
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9).missed
    expect(missed('a well-known well', 'a wellknown well')).toEqual([])
    expect(missed('Goodbye, goodbye.', 'Good-bye, goodbye.')).toEqual([])
    expect(missed('silverleaf leaf', 'silver-leaf leaf')).toEqual([])
    expect(missed('wait — now', 'wait — now')).toEqual([])
  })

  it('joins words with number words in them', () => {
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9).missed
    expect(missed('every one of them', 'everyone of them')).toEqual([])
    expect(missed('anyone can come', 'any one can come')).toEqual([])
  })

  it('looks past a word heard that is not shown, and a word shown not heard', () => {
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9).missed
    expect(missed('we saw silverleaf today', 'we saw um silver leaf today')).toEqual([])
    expect(missed('we saw bright silverleaf today', 'we saw silver leaf today')).toEqual([2])
  })

  it('forgives a name beside a joined word misheard, as whole-word matching does', () => {
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9).missed
    expect(missed('x Aren resin-sweet y', 'x Arn raisin y')).toEqual([2])
    expect(missed('so Aren well-made bread', 'so Arn wellmaid bread')).toEqual([2])
    expect(missed('x Aren whatever y', 'x Arn half-heard y')).toEqual([2])
    expect(missed('x Aren x-the y', 'x Arn the y')).toEqual([2])
  })

  it('takes a word after a dash for a sentence start, forgiving only a known name there', () => {
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9, undefined, new Set(['mira']))
        .missed
    expect(missed('"Wait—Where is he?"', 'Wait there is he?')).toEqual([0])
    expect(missed('We ran.—Here they come.', 'We ran her they come.')).toEqual([1])
    expect(missed("the leaf—Mirra's blend", "the leaf Mira's blend")).toEqual([1])
    expect(missed("the leaf—Mira's blend", "the leaf Mra's blend")).toEqual([])
  })

  it('forgives a name Whisper wrote in parts, and one pronounced in other parts', () => {
    const r = (shown: string, said: string, as?: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9, as?.split(' ')).ratio
    expect(r('so Elior waits', 'so El-eor waits', 'so El-ee-or waits')).toBe(1)
    expect(r('so Lyria waits', 'so Leer-ee-a waits', 'so LEER-ee-a waits')).toBe(1)
  })

  it('leaves out a dash or an ellipsis on its own, which nobody says, but times it', () => {
    const { ratio, missed, timed } = alignWords(['wait', '—', 'now'], heardAs('wait', 'now'), 2)
    expect([ratio, missed]).toEqual([1, []])
    expect(timed[1]).toEqual({ word: '—', start: 0.5, end: 1 })
    const shown = 'Malakar, our friend —'.split(' ')
    const heard = heardAs('Malachar,', 'our', 'friend')
    expect(alignWords(shown, heard, 4, undefined, new Set(['malakar'])).ratio).toBe(1)
    expect(alignWords(['…', '-', '—'], [], 1).ratio).toBe(1)
    expect(alignWords(['wait', '…', 'now'], heardAs('wait'), 2).ratio).toBe(1 / 2)
  })
})

describe('alignWords, ampersands', () => {
  it('reads an ampersand as "and", heard on its own or joined to a word', () => {
    const shown = 'A & L'.split(' ')
    expect(alignWords(shown, words([' A', 0, 0.4], [' &L.', 0.5, 1]), 2).ratio).toBe(1)
    expect(
      alignWords(shown, words([' A', 0, 0.4], [' and', 0.5, 0.7], [' L', 0.8, 1]), 2).ratio,
    ).toBe(1)
    expect(
      alignWords('A and L'.split(' '), words([' A', 0, 0.4], [' &', 0.5, 0.6]), 2).missed,
    ).toEqual([2])
  })

  it('gives the parts of a heard word joined by an ampersand an even share of its time', () => {
    const { timed } = alignWords('A & L'.split(' '), words([' A', 0, 0.4], [' &L.', 0.5, 1]), 2)
    expect(timed.slice(1)).toEqual([
      { word: '&', start: 0.5, end: 0.75 },
      { word: 'L', start: 0.75, end: 1 },
    ])
  })

  it('gives an ampersand heard with punctuation all of its time', () => {
    const heard = words([' A', 0, 1], [' &.', 1, 2], [' L', 2, 3])
    expect(alignWords('A & L'.split(' '), heard, 3).timed[1]).toEqual({
      word: '&',
      start: 1,
      end: 2,
    })
  })

  it('still misses an ampersand the voice left out', () => {
    expect(alignWords('A & L'.split(' '), words([' A', 0, 0.4], [' L', 0.5, 1]), 2).missed).toEqual(
      [1],
    )
  })
})

describe('alignWords, quoted speech', () => {
  it("takes the two spellings of a possessive after s for one (Sorceress's, Sorceress')", () => {
    const heard = words(['You', 0, 1], ['received', 1, 2], ["Sorceress'", 2, 3], ['Truth.', 3, 4])
    expect(alignWords("You received Sorceress's Truth!".split(' '), heard, 4).ratio).toBe(1)
    const back = words(["Sorceress's", 0, 1], ['Truth.', 1, 2])
    expect(alignWords(["Sorceress'", 'Truth.'], back, 2).ratio).toBe(1)
    const its = words(['it', 0, 1], ['is', 1, 2])
    expect(alignWords(["it's", 'is'], its, 2).missed).toEqual([0])
  })

  it("takes a plural possessive and a singular one for the same word (founders', founder's)", () => {
    const shown = "From the founders' line, to the next.".split(' ')
    const heard = "From the founder's line to the next.".split(' ')
    const timed = (said: string[]) =>
      words(...said.map((w, i): [string, number, number] => [w, i, i + 1]))
    expect(alignWords(shown, timed(heard), 7).ratio).toBe(1)
    expect(alignWords(heard, timed(shown), 7).ratio).toBe(1)
  })

  it('counts a plural possessive heard without its apostrophe', () => {
    expect(
      alignWords(
        ['the', "elders'", 'hall'],
        words(['the', 0, 1], ['elders', 1, 2], ['hall', 2, 3]),
        3,
      ).ratio,
    ).toBe(1)
  })

  it('takes a word opening single quotes for a sentence start, not a name', () => {
    const shown = "She asked, 'Will you come?'".split(' ')
    const heard = words(
      ['She', 0, 1],
      ['asked,', 1, 2],
      ['Well', 2, 3],
      ['you', 3, 4],
      ['come?', 4, 5],
    )
    expect(alignWords(shown, heard, 5).missed).toEqual([2])
  })

  it('takes single quotes around words for quotes, not part of the words', () => {
    const text = "'You will need this more than I will.'"
    const heard = words(
      ...'You will need this more than I will.'
        .split(' ')
        .map((w, i): [string, number, number] => [w, i, i + 0.5]),
    )
    expect(alignWords(text.split(' '), heard, 9).ratio).toBe(1)
    expect(
      alignWords(
        ["Lysa's", "elders'", "don't"],
        words(["Lysa's", 0, 1], ["elders'", 1, 2], ['dont', 2, 3]),
        3,
      ).ratio,
    ).toBe(2 / 3)
  })
})

describe('alignWords, names Whisper spells its own way', () => {
  const text = "This was theirs, you know. Aren and Lysa's."
  const heardAs = (...said: string[]) =>
    words(...said.map((w, i): [string, number, number] => [w, i, i + 0.5]))
  const cast = new Set(['aren'])

  it('counts a known name heard one letter off, taking its times and no other', () => {
    const heard = heardAs('This', 'was', 'theirs,', 'you', 'know,', 'Arn', 'and', "Lysa's.")
    // "Aren" starts a sentence here, so it counts as a known name only.
    expect(alignWords(text.split(' '), heard, 9).ratio).toBe(7 / 8)
    const { timed, ratio } = alignWords(text.split(' '), heard, 9, undefined, cast)
    expect(ratio).toBe(1)
    expect(timed.slice(4, 7)).toEqual([
      { word: 'know.', start: 4, end: 4.5 },
      { word: 'Aren', start: 5, end: 5.5 },
      { word: 'and', start: 6, end: 6.5 },
    ])
  })

  it('counts a known name at the start of a sentence, but no other word there', () => {
    const start = (shown: string[], heard: string[], names?: ReadonlySet<string>) =>
      alignWords(shown, heardAs(...heard), 9, undefined, names).ratio
    expect(start(['Aren', 'went', 'home'], ['Arn', 'went', 'home'], cast)).toBe(1)
    expect(start(['Aren', 'went', 'home'], ['Arn', 'went', 'home'])).toBe(2 / 3)
    expect(start(['Where', 'is', 'he?'], ['There', 'is', 'he?'], cast)).toBe(2 / 3)
    expect(
      start(['We', 'ran.', 'Here', 'they', 'come.'], ['We', 'ran.', 'Her', 'they', 'come.']),
    ).toBe(4 / 5)
    expect(start(['"Never', 'again,"', 'she', 'said.'], ['Ever', 'again,', 'she', 'said.'])).toBe(
      3 / 4,
    )
    expect(start(['"Aren', 'went'], ['Arn', 'went'], cast)).toBe(1)
    expect(start(["Aren's", 'sword', 'shines.'], ["Arn's", 'sword', 'shines.'], cast)).toBe(1)
    expect(
      start(['Act', 'I:', 'There', 'and', 'back'], ['Act', 'I:', 'Where', 'and', 'back']),
    ).toBe(4 / 5)
  })

  it('counts one mid-sentence, unknown, compared as said', () => {
    expect(
      alignWords(['know,', 'Aren', 'waits'], heardAs('know,', 'Ahrn', 'waits'), 3, [
        'know,',
        'Ahren',
        'waits',
      ]).ratio,
    ).toBe(1)
  })

  it('counts it past a dash or an ellipsis, shown or heard, which nobody says', () => {
    expect(alignWords(['wait', '—', 'Aren'], heardAs('wait', 'Arn'), 2).ratio).toBe(1)
    expect(alignWords(['wait', 'Aren'], heardAs('wait', '...', 'Arn'), 3).ratio).toBe(1)
  })

  it('does not count a lowercase or all-caps word, a name under four letters, or two letters off', () => {
    expect(
      alignWords(['I', 'will', 'never', 'go'], heardAs('I', 'will', 'ever', 'go'), 4).ratio,
    ).toBe(3 / 4)
    expect(alignWords(['see', 'Kai', 'came'], heardAs('see', 'Kaid', 'came'), 3).ratio).toBe(2 / 3)
    expect(alignWords(['see', "Kai's", 'cat'], heardAs('see', "Kaid's", 'cat'), 3).ratio).toBe(
      2 / 3,
    )
    expect(alignWords(['the', 'Malakar'], heardAs('the', 'Malacore'), 2).ratio).toBe(1 / 2)
    expect(
      alignWords(['I', 'will', 'NEVER', 'go'], heardAs('I', 'will', 'ever', 'go'), 4).ratio,
    ).toBe(3 / 4)
  })

  it('measures a name by its letters as said, its possessive not counted', () => {
    const heard = heardAs('so', 'Kaiya', 'waits')
    expect(alignWords(['so', 'Kai', 'waits'], heard, 3, ['so', 'Kaiyah', 'waits']).ratio).toBe(1)
    const its = heardAs('so', "Kaiya's", 'waits')
    expect(alignWords(['so', "Kai's", 'waits'], its, 3, ['so', "Kaiyah's", 'waits']).ratio).toBe(1)
    expect(
      alignWords(['so', 'Kaiyah', 'waits'], heardAs('so', 'Kaia', 'waits'), 3, [
        'so',
        'Kai',
        'waits',
      ]).ratio,
    ).toBe(2 / 3)
  })

  it('does not count a number one digit off', () => {
    expect(
      alignWords(['In', '1984', 'it', 'fell'], heardAs('In', '1985', 'it', 'fell'), 4).ratio,
    ).toBe(3 / 4)
  })

  it('says which shown words were not heard', () => {
    const heard = heardAs('This', 'was', 'you', 'know,', 'Arn', 'and', "Lysa's.")
    expect(alignWords(text.split(' '), heard, 9, undefined, cast).missed).toEqual([2])
    expect(alignWords(['wait', '—', 'now'], heardAs('wait'), 2).missed).toEqual([2])
  })

  it('counts a name Whisper spelled by its sound (Malachar, LifeLite)', () => {
    const missed = (shown: string, said: string, names?: Set<string>) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9, undefined, names).missed
    expect(
      missed('Malakar sits by the shards.', 'Malachar sits by the shards.', new Set(['malakar'])),
    ).toEqual([])
    expect(missed('The Lifelight Elixir is gone.', 'The LifeLite Elixir is gone.')).toEqual([])
    expect(missed('then Phyllis came', 'then Filis came')).toEqual([])
    expect(missed('then Cecily came', 'then Sesily came')).toEqual([])
    expect(missed('then Ella came', 'then Elle came')).toEqual([])
  })

  it('does not take short names, soft c or the ch of church for sound-alikes', () => {
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9).missed
    for (const [shown, said] of [
      ['Emma', 'Eva'],
      ['Miss', 'Mrs'],
      ['Chuck', 'Cook'],
      ['Lucy', 'Luke'],
      ['Grace', 'Drake'],
      ['Charlie', 'Carly'],
      ['Church', 'Kirk'],
      ['Mitch', 'Mick'],
    ]) {
      expect(missed(`then ${shown} came`, `then ${said} came`)).toEqual([1])
    }
  })

  it('does not count a sound-alike lowercase word, or a name two sounds off', () => {
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9).missed
    expect(missed('the night came', 'the nite came')).toEqual([1])
    expect(missed("the leaf Mira's blend", 'the leaf mirrors blend')).toEqual([2])
    expect(missed('then Malakar came', 'then Malacore came')).toEqual([1])
  })

  it('counts a known name heard with other vowels, its consonants the same (Elior as Ilyar)', () => {
    const shown = 'Welcome back, young Elior. Need something else?'.split(' ')
    const heard = heardAs(...'Welcome back young Ilyar. Need something else?'.split(' '))
    expect(alignWords(shown, heard, 9).missed).toEqual([3])
    expect(alignWords(shown, heard, 9, undefined, new Set(['elior'])).ratio).toBe(1)
  })

  it('does not count a known name with a consonant lost or changed, or of one consonant', () => {
    const names = new Set(['elior', 'aria', 'malakar'])
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9, undefined, names).missed
    expect(missed('then Elior came', 'then Elia came')).toEqual([1])
    expect(missed('then Malakar came', 'then Molokan came')).toEqual([1])
    expect(missed('then Aria came', 'then Oreo came')).toEqual([1])
  })

  it('does not count a word, or several, with the vowels of a known name in other places', () => {
    const names = new Set(['mira', 'lysa', 'aren', 'elior', 'lyria', 'kael'])
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9, undefined, names).missed
    for (const [name, said] of [
      ['Mira', 'more'],
      ['Mira', 'Omar'],
      ['Lysa', 'also'],
      ['Lysa', 'lose a'],
      ['Aren', 'iron'],
      ['Aren', 'Ronnie'],
      ['Aren', 'a rain'],
      ['Elior', 'a lair'],
      ['Elior', 'all your'],
      ['Lyria', 'lure'],
      ['Lyria', 'a lie or'],
      ['Kael', 'cool'],
      ['Kael', 'Kyle'],
    ]) {
      expect([name, said, missed(`then ${name} came`, `then ${said} came`)]).toEqual([
        name,
        said,
        [1],
      ])
    }
  })

  it('does not count a word Whisper capitalised only to start a sentence', () => {
    const names = new Set(['mira', 'aren', 'lysa', 'elior'])
    const missed = (shown: string, said: string) =>
      alignWords(shown.split(' '), heardAs(...said.split(' ')), 9, undefined, names).missed
    expect(missed('Mira, wait here.', 'More, wait here.')).toEqual([0])
    expect(missed('Aren, go now.', 'Iron, go now.')).toEqual([0])
    expect(missed('Lysa, come back.', 'Lose, come back.')).toEqual([0])
    expect(missed('and Mira, wait', 'and. More, wait')).toEqual([1])
    expect(missed('Elior, wait.', 'Ilyar, wait.')).toEqual([0])
    expect(missed('so, Elior, wait.', 'so, Ilyar, wait.')).toEqual([])
  })

  it('pairs words only where as many were heard as shown between matches', () => {
    expect(
      alignWords(['and', 'Aren', 'and', 'Lysa'], heardAs('and', 'Arn', 'Ren', 'and', 'Lysa'), 5)
        .ratio,
    ).toBe(3 / 4)
  })
})

describe('knownNames', () => {
  it('gives the one-word names of the cast and of its pronunciations, plain', () => {
    const names = knownNames({
      speakers: { aren: {}, 'unmasked sorceress': {}, 'ancient tree spirit': {} },
      pronounce: { Lyria: 'LEER-ee-a', 'Act I:': 'Act One:' },
    })
    expect([...names].sort()).toEqual(['aren', 'lyria'])
  })
})

describe('heardWords', () => {
  it('keeps a real last segment that overshoots the clip, and drops invented ones', () => {
    const segments = [
      { start: 0.0, end: 2.0, words: words(['I', 0.0, 0.5], ['knew', 0.5, 1.0]) },
      { start: 2.0, end: 3.6, words: words(['tell', 2.1, 2.8], ['you.', 2.8, 3.5]) },
      { start: 3.4, end: 3.4, words: words(['Thanks', 3.4, 3.4]) },
      { start: 3.45, end: 4.5, words: words(['for', 3.45, 4.0], ['watching', 4.0, 4.5]) },
    ]
    expect(heardWords(segments, 3.5).map((w) => w.word)).toEqual(['I', 'knew', 'tell', 'you.'])
  })
})

describe('matchingBlocks (Python’s difflib, autojunk off)', () => {
  it('finds the same blocks as SequenceMatcher', () => {
    expect(matchingBlocks(['a', 'b', 'x', 'c', 'd'], ['a', 'b', 'c', 'd'])).toEqual([
      [0, 0, 2],
      [3, 2, 2],
      [5, 4, 0],
    ])
    expect(matchingBlocks(['a', 'x', 'y', 'z', 'a', 'b'], ['a', 'b'])).toEqual([
      [4, 0, 2],
      [6, 2, 0],
    ])
  })
})

describe('pyRound (Python’s round(x, 3))', () => {
  it('rounds exact ties to even, the rest by their exact value', () => {
    expect([0.0625, 0.1875, 0.3125, 2.0625, 0.6625, 1.0005].map(pyRound)).toEqual([
      0.062, 0.188, 0.312, 2.062, 0.662, 1.0,
    ])
  })

  it('treats "constructor" as a word, not an object property', () => {
    expect(alignWords(['constructor'], [{ word: 'constructor', start: 0, end: 1 }], 1).ratio).toBe(
      1,
    )
  })
})

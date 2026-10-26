import { describe, expect, it } from 'bun:test'
import type { CharacterLanguage, CharacterSummary } from '../core/summary'
import {
  cardVoice,
  castInLanguage,
  castSaved,
  castTab,
  languageShown,
  queryLanguage,
  missingVoiceChips,
  noPhraseText,
  noVoiceText,
  otherVoices,
  voiceTitleOf,
  phraseNote,
  shortlistNote,
  speedInLanguage,
  startBlocked,
} from './castLanguages'

const languages = [
  { id: 'en', name: 'English' },
  { id: 'sv', name: 'Svenska' },
  { id: 'de', name: 'Deutsch' },
]

function casting(over: Partial<CharacterLanguage> = {}): CharacterLanguage {
  return {
    voice: null,
    voiceName: null,
    speed: null,
    phrase: null,
    appearances: [],
    totalLines: 0,
    longest: null,
    ...over,
  }
}

const gran = {
  id: 'grandmother',
  name: 'Grandmother',
  languages: {
    en: casting({ voice: 'e', voiceName: 'Gentle Granny', speed: 0.9 }),
    sv: casting({ voice: 's', voiceName: 'Varm Mormor', speed: 0.95 }),
    de: casting(),
  },
} as unknown as CharacterSummary

describe('languageShown', () => {
  it('is the language in the address, or English when it is not declared', () => {
    expect(languageShown(languages, 'sv')).toBe('sv')
    expect(languageShown(languages, 'fr')).toBe('en')
    expect(languageShown(languages, undefined)).toBe('en')
  })
})

describe('queryLanguage', () => {
  it('is the language shown in a project with several, and none in a project with one', () => {
    expect(queryLanguage(languages, 'sv')).toBe('sv')
    expect(queryLanguage(languages, 'fr')).toBe('en')
    expect(queryLanguage(languages.slice(0, 1), 'en')).toBeUndefined()
  })
})

describe('castTab', () => {
  it('says Cast with the voice’s name', () => {
    expect(castTab(gran, languages[1]!, false)).toEqual({
      count: 'Cast',
      title: 'Varm Mormor',
      dimmed: false,
    })
  })
  it('says Audition while one is going on, even for a cast voice', () => {
    expect(castTab(gran, languages[1]!, true)).toEqual({
      count: 'Audition',
      title: 'Audition in progress',
      dimmed: false,
    })
  })
  it('says No voice, and that there is none yet', () => {
    expect(castTab(gran, languages[2]!, false)).toEqual({
      count: 'No voice',
      title: 'No Deutsch voice yet',
      dimmed: true,
    })
  })
})

describe('cardVoice', () => {
  it('is her own voice in the source language, as a card always showed it', () => {
    const own = { ...gran, voice: 'e', voiceName: 'Gentle Granny' }
    expect(cardVoice(own, languages, 'en')).toEqual({ cast: true, label: 'Gentle Granny' })
  })
  it('is her voice in the language shown', () => {
    expect(cardVoice(gran, languages, 'sv')).toEqual({ cast: true, label: 'Varm Mormor' })
  })
  it('says there is none in the language yet', () => {
    expect(cardVoice(gran, languages, 'de')).toEqual({ cast: false, label: 'No Deutsch voice yet' })
  })
  it('keeps the source language’s wording for a character with none at all', () => {
    const none = { ...gran, voice: null, voiceName: null }
    expect(cardVoice(none, languages, 'en')).toEqual({ cast: false, label: 'No voice yet' })
  })
})

describe('missingVoiceChips', () => {
  it('has one for each language but the first without a voice', () => {
    expect(missingVoiceChips(gran, languages)).toEqual(['No Deutsch voice'])
  })
  it('has none for a character cast in every language, or in a project with one', () => {
    const all = { ...gran, languages: { ...gran.languages, de: casting({ voice: 'd' }) } }
    expect(missingVoiceChips(all, languages)).toEqual([])
    expect(missingVoiceChips(gran, languages.slice(0, 1))).toEqual([])
  })
})

describe('shortlistNote', () => {
  it('marks the voice cast in the language, and her voices in the others', () => {
    expect(shortlistNote(gran, languages, 'sv', 's')).toBe('Cast now')
    expect(shortlistNote(gran, languages, 'sv', 'e')).toBe('Her English voice')
    expect(shortlistNote(gran, languages, 'de', 's')).toBe('Her Svenska voice')
    expect(shortlistNote(gran, languages, 'de', 'x')).toBeUndefined()
  })
})

describe('otherVoices', () => {
  const four = [...languages, { id: 'fi', name: 'Suomi' }]
  const keeper = {
    languages: {
      en: casting({ voice: 'a', voiceName: 'Old man bible storytelling' }),
      sv: casting({ voice: 'a', voiceName: 'old man bible storytelling' }),
      de: casting({ voice: 'd' }),
      fi: casting(),
    },
  } as unknown as CharacterSummary
  it('lists each Fish voice once, with every language it is cast in, in project order', () => {
    expect(otherVoices(keeper, four, 'fi')).toEqual([
      { id: 'a', first: 'en', languages: ['English', 'Svenska'] },
      { id: 'd', first: 'de', languages: ['Deutsch'] },
    ])
  })
  it('leaves out the language shown', () => {
    expect(otherVoices(keeper, four, 'sv')).toEqual([
      { id: 'a', first: 'en', languages: ['English'] },
      { id: 'd', first: 'de', languages: ['Deutsch'] },
    ])
  })
})

describe('voiceTitleOf', () => {
  const about = (id: string, title: string | null) => ({
    ok: true,
    id,
    voice: title === null ? null : { title },
  })
  it('is the title Fish gave, and nothing when it did not say or the title is blank', () => {
    expect(voiceTitleOf(about('a', ' Gentle Granny '), 'a')).toBe('Gentle Granny')
    expect(voiceTitleOf(about('a', '  '), 'a')).toBeUndefined()
    expect(voiceTitleOf(about('a', null), 'a')).toBeUndefined()
    expect(voiceTitleOf({ ok: false }, 'a')).toBeUndefined()
    expect(voiceTitleOf(undefined, 'a')).toBeUndefined()
  })
  it('is nothing when the answer is about another voice than the one asked for', () => {
    expect(voiceTitleOf(about('b', 'Someone Else'), 'a')).toBeUndefined()
  })
})

describe('noVoiceText', () => {
  const tail = ' Until then Grandmother’s Deutsch lines cannot be recorded.'
  it('says her other voices start the shortlist, by their names on Fish', () => {
    expect(noVoiceText(gran, languages, 'de', { e: 'Gentle Granny', s: 'Varm Mormor' })).toBe(
      'Start an audition to find one. Gentle Granny (English) and Varm Mormor (Svenska) start on its shortlist, so you can hear them speak Deutsch too.' +
        tail,
    )
  })
  it('names a voice cast in two languages once, with both, and a singular verb', () => {
    const shared = {
      ...gran,
      languages: { ...gran.languages, sv: casting({ voice: 'e', voiceName: 'gentle granny' }) },
    }
    expect(noVoiceText(shared, languages, 'de', { e: 'Gentle Granny' })).toBe(
      'Start an audition to find one. Gentle Granny (English and Svenska) starts on its shortlist, so you can hear it speak Deutsch too.' +
        tail,
    )
  })
  it('does not use the name stored with the cast', () => {
    expect(noVoiceText(gran, languages, 'de', { e: 'Real Name', s: 'Other' })).toContain(
      'Real Name (English) and Other (Svenska)',
    )
  })
  it('calls a voice by its languages while its name is not known', () => {
    const one = { ...gran, languages: { ...gran.languages, sv: casting() } }
    expect(noVoiceText(one, languages, 'de', {})).toBe(
      'Start an audition to find one. Its English voice starts on its shortlist, so you can hear it speak Deutsch too.' +
        tail,
    )
  })
  it('does the same for a shared voice, and for two unnamed voices', () => {
    const shared = {
      ...gran,
      languages: { ...gran.languages, sv: casting({ voice: 'e' }) },
    }
    expect(noVoiceText(shared, languages, 'de', {})).toContain(
      'Its English and Svenska voice starts on its shortlist, so you can hear it speak',
    )
    expect(noVoiceText(gran, languages, 'de', {})).toContain(
      'Its English voice and its Svenska voice start on its shortlist, so you can hear them speak',
    )
  })
  it('mixes named and unnamed voices, capitalising Its only at the start', () => {
    expect(noVoiceText(gran, languages, 'de', { e: 'Gentle Granny' })).toContain(
      'Gentle Granny (English) and its Svenska voice start on its shortlist, so you can hear them speak',
    )
    expect(noVoiceText(gran, languages, 'de', { s: 'Varm Mormor' })).toContain(
      'Its English voice and Varm Mormor (Svenska) start on its shortlist',
    )
  })
  it('names a shared voice and an own one, with the plural verb', () => {
    const four = [...languages, { id: 'fi', name: 'Suomi' }]
    const keeper = {
      name: 'Keeper',
      languages: {
        en: casting({ voice: 'a' }),
        sv: casting({ voice: 'a' }),
        de: casting({ voice: 'd' }),
        fi: casting(),
      },
    } as unknown as CharacterSummary
    expect(
      noVoiceText(keeper, four, 'fi', { a: 'Old Man Bible Storytelling', d: 'Vanha Kertoja' }),
    ).toBe(
      'Start an audition to find one. Old Man Bible Storytelling (English and Svenska) and Vanha Kertoja (Deutsch) start on its shortlist, so you can hear them speak Suomi too. Until then Keeper’s Suomi lines cannot be recorded.',
    )
  })
  it('leaves the middle sentence out with no voice in any language', () => {
    const none = { ...gran, languages: { en: casting(), sv: casting(), de: casting() } }
    expect(noVoiceText(none, languages, 'de', {})).toBe('Start an audition to find one.' + tail)
  })
})

describe('speedInLanguage', () => {
  it('lists the other languages, the project’s speed for one without its own', () => {
    expect(speedInLanguage(gran, languages, 'de', 1)).toEqual({
      label: 'Speed · Deutsch',
      own: null,
      others: 'English 0.9× · Svenska 0.95×',
    })
    expect(speedInLanguage(gran, languages, 'sv', 1).others).toBe(
      'English 0.9× · Deutsch 1.0× (project’s speed)',
    )
  })
})

describe('the phrase', () => {
  const text = (from: 'own' | 'standard' | 'line' | 'none') => ({
    phrase: from === 'none' ? null : 'x',
    from,
    standard: true,
    spoken: 'x',
  })
  it('notes where it comes from', () => {
    expect(phraseNote(text('line'), 'Grandmother', 'Deutsch')).toBe(
      'Her longest Deutsch line, until you choose another.',
    )
    expect(phraseNote(text('own'), 'Grandmother', 'Svenska')).toBe(
      'Grandmother’s own Svenska phrase.',
    )
    expect(phraseNote(text('none'), 'Grandmother', 'Deutsch')).toBeNull()
  })
  it('stops an audition without any', () => {
    expect(startBlocked(text('none'), 'Deutsch')).toBe('Write a Deutsch audition phrase first')
    expect(startBlocked(text('line'), 'Deutsch')).toBeNull()
    expect(startBlocked(null, 'Deutsch')).toBeNull()
    expect(noPhraseText('Grandmother', 'Deutsch')).toBe(
      'Grandmother has no Deutsch lines to borrow one from. Write a Deutsch phrase to start an audition.',
    )
  })
})

describe('casting in a language', () => {
  it('asks about the language’s voice, and says its lines go stale and the others do not', () => {
    expect(
      castInLanguage('Gentle Granny', 'Grandmother', languages, 'sv', [
        { title: 'Act I', lines: 18 },
      ]),
    ).toEqual({
      title: 'Cast Gentle Granny as Grandmother’s Svenska voice?',
      stale:
        '18 Svenska lines go stale and need recording again: Act I 18. Her English and Deutsch lines are not touched.',
    })
  })
  it('says nothing is stale when nothing is recorded', () => {
    expect(castInLanguage('G', 'Grandmother', languages, 'sv', []).stale).toBeNull()
  })
  it('says only what was saved when nothing was recorded', () => {
    expect(castSaved(languages, 'sv', 0)).toBe('Saved to the Svenska cast for every act.')
  })
  it('says what was saved', () => {
    expect(castSaved(languages, 'sv', 18)).toBe(
      'Saved to the Svenska cast for every act. 18 lines are now stale and need recording again.',
    )
  })
})

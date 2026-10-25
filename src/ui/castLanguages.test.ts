import { describe, expect, it } from 'bun:test'
import type { CharacterLanguage, CharacterSummary } from '../core/summary'
import {
  castInLanguage,
  castSaved,
  castTab,
  languageShown,
  missingVoiceChips,
  noPhraseText,
  noVoiceText,
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

describe('noVoiceText', () => {
  it('says her other voices start the shortlist', () => {
    expect(noVoiceText(gran, languages, 'de')).toBe(
      'Start an audition to find one. Gentle Granny (English) and Varm Mormor (Svenska) start on its shortlist, so you can hear them speak Deutsch too. Until then Grandmother’s Deutsch lines cannot be recorded.',
    )
  })
  it('leaves the middle sentence out with no voice in any language', () => {
    const none = { ...gran, languages: { en: casting(), sv: casting(), de: casting() } }
    expect(noVoiceText(none, languages, 'de')).toBe(
      'Start an audition to find one. Until then Grandmother’s Deutsch lines cannot be recorded.',
    )
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
      'English 0.9× · Deutsch 1× (project’s speed)',
    )
  })
})

describe('the phrase', () => {
  const text = (from: 'own' | 'standard' | 'line' | 'none') => ({
    phrase: from === 'none' ? null : 'x',
    from,
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
  it('says what was saved', () => {
    expect(castSaved(languages, 'sv', 18)).toBe(
      'Saved to the Svenska cast for every act. 18 lines are now stale and need recording again.',
    )
  })
})

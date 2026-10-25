import { describe, expect, it } from 'bun:test'
import {
  castNote,
  cueButtonTitle,
  cueHint,
  cueNote,
  generateLabel,
  languageTab,
  movedTo,
  noDialogPanel,
  translatedNote,
} from './languages'

const sv = { id: 'sv', name: 'Svenska', dialog: 'ok' as const, upToDate: 40, total: 481 }
const de = { id: 'de', name: 'Deutsch', dialog: 'missing' as const, upToDate: 0, total: 0 }

describe('languageTab', () => {
  it('shows up to date out of all lines, spelling it out on hover', () => {
    expect(languageTab(sv, 'Act II')).toEqual({
      count: '40/481',
      title: '40 of 481 lines up to date',
      dimmed: false,
    })
  })

  it('says No dialog for a language the act has none of', () => {
    expect(languageTab(de, 'Act II')).toEqual({
      count: 'No dialog',
      title: 'Act II has no Deutsch dialog yet',
      dimmed: true,
    })
  })

  it('reads an unreadable dialog as a count, since there is a file', () => {
    expect(languageTab({ ...sv, dialog: 'invalid', total: 0, upToDate: 0 }, 'Act II').dimmed).toBe(
      false,
    )
  })

  it('reads 481/481 when every line is up to date', () => {
    expect(languageTab({ ...sv, upToDate: 481 }, 'Act II').count).toBe('481/481')
  })
})

describe('the words around a language', () => {
  it('labels the Generate panel with the language and the character', () => {
    expect(generateLabel('Generate', 'Svenska', null)).toBe('Generate · Svenska · every character')
    expect(generateLabel('Generate', 'Svenska', 'Mira')).toBe('Generate · Svenska · Mira')
    expect(generateLabel('Final recording', 'Svenska', null)).toBe(
      'Final recording · Svenska · every character',
    )
    // One language declared: as it always was.
    expect(generateLabel('Generate', null, null)).toBe('Generate · every character')
  })

  it('names who is not cast and what is not translated', () => {
    expect(castNote('Svenska', ['Grandmother'])).toBe(
      'Not recorded until cast in Svenska: Grandmother.',
    )
    expect(castNote(null, ['Grandmother', 'Mira'])).toBe(
      'Not recorded until cast: Grandmother, Mira.',
    )
    expect(translatedNote(3)).toBe('Not recorded until translated: 3 lines.')
    expect(translatedNote(1)).toBe('Not recorded until translated: 1 line.')
  })

  it('says where a cue comes from, only in a language besides the source', () => {
    expect(cueNote('source', 'Mira', 'English')).toBe('from English')
    expect(cueNote('style', 'Mira', 'English')).toBe('Mira’s style')
    expect(cueNote('own', 'Mira', 'English')).toBeNull()
  })

  it('words the cue editor for a language following or not following the source', () => {
    expect(cueHint('source', '[worried]', 'English')).toBe(
      'Empty: this line follows the English cue [worried].',
    )
    expect(cueHint('own', '[worried]', 'English')).toBe('English cue: [worried]')
    expect(cueHint('own', null, 'English')).toBeNull()
    expect(cueHint('style', null, 'English')).toBeNull()
    expect(cueButtonTitle('source', 'Svenska', 'English')).toBe(
      'Follows the English cue: give this line its own Svenska cue',
    )
  })

  it('offers Refresh dialog only when the game has a command', () => {
    expect(noDialogPanel('Act II', 'Deutsch', true, 'Act')).toEqual({
      heading: 'Act II has no Deutsch dialog yet',
      text: 'The game has not written Deutsch lines for this act. Once it does, Refresh dialog reads them in.',
      refresh: true,
    })
    expect(noDialogPanel('Act II', 'Deutsch', false, 'Act')).toEqual({
      heading: 'Act II has no Deutsch dialog yet',
      text: 'The game has not written Deutsch lines for this act. Once it does, the studio reads them in.',
      refresh: false,
    })
  })
})

describe('movedTo', () => {
  const ids = ['en', 'sv', 'de']

  it('moves between languages with the arrow keys, wrapping round', () => {
    expect(movedTo(ids, 'en', 'ArrowRight')).toBe('sv')
    expect(movedTo(ids, 'de', 'ArrowRight')).toBe('en')
    expect(movedTo(ids, 'en', 'ArrowLeft')).toBe('de')
    expect(movedTo(ids, 'sv', 'ArrowDown')).toBe('de')
    expect(movedTo(ids, 'sv', 'ArrowUp')).toBe('en')
  })

  it('goes to the first and last with Home and End, and ignores other keys', () => {
    expect(movedTo(ids, 'sv', 'Home')).toBe('en')
    expect(movedTo(ids, 'sv', 'End')).toBe('de')
    expect(movedTo(ids, 'sv', 'a')).toBeNull()
  })
})

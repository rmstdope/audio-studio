import { describe, expect, it } from 'bun:test'
import { languageTab, movedTo, noDialogPanel, recordingNote } from './languages'

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
  it('says recording is not available yet', () => {
    expect(recordingNote('Svenska')).toBe(
      'Recording in Svenska is not available yet: you can see and play its lines.',
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

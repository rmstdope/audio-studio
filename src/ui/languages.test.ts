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
  planHeadline,
  translatedNote,
  dialogGonePanel,
  recordedWords,
} from './languages'

const sv = {
  id: 'sv',
  name: 'Svenska',
  dialog: 'ok' as const,
  recorded: null,
  upToDate: 40,
  total: 481,
}
const de = {
  id: 'de',
  name: 'Deutsch',
  dialog: 'missing' as const,
  recorded: null,
  upToDate: 0,
  total: 0,
}

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

const svGone = {
  ...sv,
  dialog: 'gone' as const,
  recorded: { clips: 12, cues: 3 },
  upToDate: 0,
  total: 0,
}

describe('languageTab, a dialog that is gone', () => {
  it('says Dialog gone in amber, not dimmed', () => {
    expect(languageTab(svGone, 'Act 1')).toEqual({
      count: 'Dialog gone',
      title: 'Act 1’s Svenska dialog is gone',
      dimmed: false,
      warn: true,
    })
  })
})

describe('recordedWords', () => {
  it('pluralises and joins with and', () => {
    expect(recordedWords({ clips: 12, cues: 3 })).toBe('12 clips and 3 cues')
    expect(recordedWords({ clips: 1, cues: 1 })).toBe('1 clip and 1 cue')
    expect(recordedWords({ clips: 12, cues: 0 })).toBe('12 clips')
    expect(recordedWords({ clips: 0, cues: 3 })).toBe('3 cues')
  })
})

describe('dialogGonePanel', () => {
  const several = {
    partTitle: 'Act 1',
    partLabel: 'Act',
    language: 'Svenska' as string | null,
    recorded: { clips: 12, cues: 3 },
    canRefresh: true,
  }

  it('names the language, the path and the recordings, with the refresh advice', () => {
    expect(dialogGonePanel(several)).toEqual({
      heading: 'Act 1’s Svenska dialog is gone',
      before:
        ' is not there, but 12 clips and 3 cues were recorded for Act 1 in Svenska. The studio keeps them as they are and offers to remove none of them until the dialog is back.',
      advice:
        'Refresh dialog writes it again from the game. If the game no longer has Svenska lines for this act, delete the clips and their manifest yourself.',
      lines:
        '12 clips and 3 cues were recorded for these lines. Nothing can be generated or removed until the dialog is back.',
      refresh: true,
    })
  })

  it('says was and it when one clip or one cue was recorded', () => {
    expect(dialogGonePanel({ ...several, recorded: { clips: 1, cues: 0 } })).toMatchObject({
      before:
        ' is not there, but 1 clip was recorded for Act 1 in Svenska. The studio keeps it as it is and offers to remove none of it until the dialog is back.',
      lines:
        '1 clip was recorded for these lines. Nothing can be generated or removed until the dialog is back.',
    })
    expect(dialogGonePanel({ ...several, recorded: { clips: 0, cues: 1 } })).toMatchObject({
      before:
        ' is not there, but 1 cue was recorded for Act 1 in Svenska. The studio keeps it as it is and offers to remove none of it until the dialog is back.',
      lines:
        '1 cue was recorded for these lines. Nothing can be generated or removed until the dialog is back.',
    })
    expect(dialogGonePanel({ ...several, recorded: { clips: 1, cues: 1 } })).toMatchObject({
      before:
        ' is not there, but 1 clip and 1 cue were recorded for Act 1 in Svenska. The studio keeps them as they are and offers to remove none of them until the dialog is back.',
    })
  })

  it('names the cues file, not clips and a manifest, when only cues were recorded', () => {
    expect(dialogGonePanel({ ...several, recorded: { clips: 0, cues: 3 } })).toMatchObject({
      advice:
        'Refresh dialog writes it again from the game. If the game no longer has Svenska lines for this act, delete the cues file yourself.',
    })
    expect(
      dialogGonePanel({
        ...several,
        language: null,
        canRefresh: false,
        recorded: { clips: 0, cues: 1 },
      }),
    ).toMatchObject({
      advice:
        'Once the game writes it again, the studio reads it in. If the game no longer has this act, delete the cues file yourself.',
    })
  })

  it('has other advice without a refresh command', () => {
    expect(dialogGonePanel({ ...several, canRefresh: false })).toMatchObject({
      advice:
        'Once the game writes it again, the studio reads it in. If the game no longer has Svenska lines for this act, delete the clips and their manifest yourself.',
      refresh: false,
    })
  })

  it('leaves the language out in a one-language project', () => {
    expect(
      dialogGonePanel({ ...several, language: null, recorded: { clips: 34, cues: 5 } }),
    ).toMatchObject({
      heading: 'Act 1’s dialog is gone',
      before:
        ' is not there, but 34 clips and 5 cues were recorded for Act 1. The studio keeps them as they are and offers to remove none of them until the dialog is back.',
      advice:
        'Refresh dialog writes it again from the game. If the game no longer has this act, delete the clips and their manifest yourself.',
    })
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

  it('heads a generation plan, never calling uncast or untranslated lines recorded', () => {
    const plan = { keys: [], final: false, uncast: [], untranslated: 0 }
    expect(planHeadline({ ...plan, keys: ['a', 'b'] })).toBe('Record 2 lines')
    expect(planHeadline(plan)).toBe('Every line is recorded')
    expect(planHeadline({ ...plan, final: true })).toBe('Every line is final')
    expect(planHeadline({ ...plan, uncast: ['wren'] })).toBe('Nothing to record yet')
    expect(planHeadline({ ...plan, final: true, untranslated: 6 })).toBe('Nothing to record yet')
  })

  it('says where a cue comes from, only in a language besides the source', () => {
    expect(cueNote('source', 'Mira', 'English')).toBe('from English')
    expect(cueNote('style', 'Mira', 'English')).toBe('Mira’s style')
    expect(cueNote('own', 'Mira', 'English')).toBeNull()
    expect(cueNote('source', 'Mira', 'English', true)).toBe(
      'from English · cues inside stay with English',
    )
    expect(cueNote('style', 'Mira', 'English', true)).toBe('Mira’s style')
  })

  it('says a line follows its scene’s cue in any language, and that it follows English', () => {
    expect(cueNote('scene', 'Mira', null)).toBe("The scene's cue")
    expect(cueNote('scene', 'Mira', 'English')).toBe("The scene's cue")
    expect(cueNote('sceneSource', 'Mira', 'English')).toBe("The scene's cue, following English")
    expect(cueNote('style', 'Mira', null)).toBeNull()
    expect(cueButtonTitle('scene', 'Svenska', 'English')).toBe(
      'The scene’s cue: give this line its own cue',
    )
    expect(cueHint('scene', '[worried]', 'English')).toBeNull()
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

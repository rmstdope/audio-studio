import { describe, expect, it } from 'bun:test'
import { noProjectMessage, renameNotice } from './renames'

const LEAD = 'This game is set up for Audio Studio, which is now Content Studio.'

describe('renameNotice', () => {
  it('lists all three renames when the file and the folder are both old', () => {
    expect(renameNotice({ oldFile: true, newFile: false, oldFolder: true })).toBe(
      [
        LEAD,
        'Rename these, then run content-studio again:',
        '  git mv audio-studio.json content-studio.json',
        '  mv .audio-studio .content-studio',
        '  in .gitignore, change .audio-studio/ to .content-studio/',
      ].join('\n'),
    )
  })

  it('lists only the project file when the folder is not old', () => {
    expect(renameNotice({ oldFile: true, newFile: false, oldFolder: false })).toBe(
      [
        LEAD,
        'Rename this, then run content-studio again:',
        '  git mv audio-studio.json content-studio.json',
      ].join('\n'),
    )
  })

  it('lists only the folder and the .gitignore line when the file is renamed', () => {
    expect(renameNotice({ oldFile: false, newFile: true, oldFolder: true })).toBe(
      [
        LEAD,
        'Rename these, then run content-studio again:',
        '  mv .audio-studio .content-studio',
        '  in .gitignore, change .audio-studio/ to .content-studio/',
      ].join('\n'),
    )
  })

  it('asks to keep one when both project files exist, whatever the folder', () => {
    const both = [
      'This game has both audio-studio.json and content-studio.json.',
      'Keep one, named content-studio.json, then run content-studio again.',
    ].join('\n')
    expect(renameNotice({ oldFile: true, newFile: true, oldFolder: false })).toBe(both)
    expect(renameNotice({ oldFile: true, newFile: true, oldFolder: true })).toBe(both)
  })

  it('has nothing to say when nothing is old', () => {
    expect(renameNotice({ oldFile: false, newFile: true, oldFolder: false })).toBeNull()
    expect(renameNotice({ oldFile: false, newFile: false, oldFolder: false })).toBeNull()
  })
})

describe('noProjectMessage', () => {
  it('names the folder searched and what to do', () => {
    expect(noProjectMessage('/games/x')).toBe(
      'No content-studio.json in /games/x or any folder above it.\n' +
        'Run content-studio from the game repository that has one, or pass --project <file>.',
    )
  })
})

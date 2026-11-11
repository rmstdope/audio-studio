import { describe, expect, it } from 'bun:test'
import {
  cancelRunWhy,
  checkingWhy,
  cueGapSaveWhy,
  fieldSaveWhy,
  generateWhy,
  hearWhy,
  recordingWhy,
  refreshRunningWhy,
  sceneHearWhy,
  takeUseWhy,
} from './linesText'

describe('the reasons a line control is greyed', () => {
  it('names nothing when nothing is in the way', () => {
    expect(recordingWhy(false)).toBe(false)
    expect(checkingWhy(false)).toBe(false)
    expect(hearWhy(false)).toBe(false)
    expect(refreshRunningWhy(false)).toBe(false)
    expect(fieldSaveWhy('cue', { pending: false, unchanged: false })).toBe(false)
  })

  it('reuses the studio’s sentence for a running refresh', () => {
    expect(refreshRunningWhy(true)).toBe('Wait for the refresh from the game to finish.')
  })

  it('a Save with nothing new says what to do before it says to wait', () => {
    expect(fieldSaveWhy('cue', { pending: true, unchanged: true })).toBe(
      'The cue is the same as it is now. Change it first, then save.',
    )
    expect(fieldSaveWhy('note', { pending: true, unchanged: false })).toBe(
      'The note is being saved. Wait for it to finish.',
    )
  })

  it('the cue gap’s Save names the changed words first, then no cue, then waiting', () => {
    const all = { changed: true, cue: '', placed: '', pending: true }
    expect(cueGapSaveWhy(all)).toContain('words changed')
    expect(cueGapSaveWhy({ ...all, changed: false })).toContain('Type a cue')
    expect(cueGapSaveWhy({ ...all, changed: false, cue: 'x', placed: 'x' })).toContain('same')
    expect(cueGapSaveWhy({ ...all, changed: false, cue: 'x', placed: null })).toBe(
      'The cue is being saved. Wait for it to finish.',
    )
  })

  it('a scene with no line after the cue has nothing to hear it on, before any waiting', () => {
    expect(sceneHearWhy({ following: false, pending: true })).toContain('No line in this scene')
    expect(sceneHearWhy({ following: true, pending: true })).toBe(hearWhy(true))
  })

  it('Use this take names a changed line before a use under way', () => {
    expect(takeUseWhy({ current: false, pending: true })).toContain('changed since')
    expect(takeUseWhy({ current: true, pending: true })).toBe(
      'This take is being used as the clip. Wait for it to finish.',
    )
  })

  it('Generate names a plan still loading as a wait, and nothing to generate first', () => {
    expect(generateWhy({ nothing: true, waiting: true, starting: true })).toContain('Nothing')
    expect(generateWhy({ nothing: false, waiting: true, starting: false })).toBe(
      'The plan is being worked out again. Wait for it to finish.',
    )
    expect(generateWhy({ nothing: false, waiting: false, starting: true })).toBe(
      'The run is starting. Wait for it to begin.',
    )
  })

  it('Cancel names leftover clips being removed before the run already stopping', () => {
    expect(cancelRunWhy({ cancelling: true, removingOrphans: true, pending: true })).toContain(
      'Leftover clips',
    )
    expect(cancelRunWhy({ cancelling: false, removingOrphans: false, pending: true })).toContain(
      'already stopping',
    )
    expect(cancelRunWhy({ cancelling: false, removingOrphans: false, pending: false })).toBe(false)
  })
})

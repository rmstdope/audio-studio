import { describe, expect, it } from 'bun:test'
import {
  makeAllButton,
  makeAllHeading,
  makeAllLine,
  chosenLine,
  tooLongLine,
  busyLine,
  nonePossibleLine,
  readyLine,
  runningLine,
  summaryLead,
  summaryFailed,
  summaryStopped,
  joinSeparators,
  namesText,
  allChosenLine,
  REFRESH_BLOCKED_BY_TAKES,
  MAKE_BLOCKED_BY_REFRESH,
} from './musicMakeAllText'

describe('the words of Make takes for every track', () => {
  it('counts the tracks', () => {
    expect(readyLine(4)).toBe('4 tracks have no chosen take')
    expect(readyLine(1)).toBe('1 track has no chosen take')
  })

  it('asks the question', () => {
    expect(makeAllHeading(16, 4)).toBe('Make 16 takes for 4 tracks?')
    expect(makeAllHeading(4, 1)).toBe('Make 4 takes for 1 track?')
  })

  it('says the model and the time on a free model', () => {
    expect(makeAllLine({ name: 'Balanced', paid: false, seconds: 16 * 180 })).toBe(
      'Four takes each, on Balanced, the music model on Setup. About 48 min in all — they are made one after another, and you can leave the page.',
    )
    // Never less than a minute.
    expect(makeAllLine({ name: 'Shortest', paid: false, seconds: 40 })).toContain(
      'About 1 min in all',
    )
  })

  it('says who bills on the paid model', () => {
    expect(makeAllLine({ name: 'Eleven Music', paid: true, seconds: 960 })).toBe(
      'Four takes each, on Eleven Music, the music model on Setup. ElevenLabs bills each take.',
    )
  })

  it('puts the price on the button of a paid model', () => {
    expect(makeAllButton(16, null)).toBe('Make 16 takes')
    expect(makeAllButton(16, 2.54)).toBe('Make 16 takes · $2.54')
  })

  it('names the tracks left out and why', () => {
    expect(namesText(['A'])).toBe('A')
    expect(namesText(['A', 'B'])).toBe('A and B')
    expect(namesText(['A', 'B', 'C'])).toBe('A, B and C')
    expect(chosenLine(['Tavern at dusk', 'Storm at sea'])).toBe(
      'Tavern at dusk and Storm at sea have a chosen take and get none.',
    )
    expect(chosenLine(['Tavern at dusk'])).toBe('Tavern at dusk has a chosen take and gets none.')
    expect(tooLongLine(['Forest path', 'Market square'], 'Short')).toBe(
      'Left out: Forest path and Market square are longer than Short can make — open a track to pick another model for it, or change the music model on Setup.',
    )
    expect(tooLongLine(['Forest path'], 'Short')).toContain('Forest path is longer than Short')
    expect(busyLine(['Cave drip'])).toBe('Cave drip is already making takes and gets none.')
    expect(busyLine(['Cave drip', 'Hall'])).toBe(
      'Cave drip and Hall are already making takes and get none.',
    )
  })

  it('says when the model can make none of them', () => {
    expect(nonePossibleLine('Short', 2)).toBe(
      "Short can't make any of the 2 tracks with no chosen take at their length.",
    )
    expect(nonePossibleLine('Short', 1)).toBe(
      "Short can't make the track with no chosen take at its length.",
    )
  })

  it('says what is being made', () => {
    expect(runningLine({ takes: 16, tracks: 4, left: 48 * 60 })).toBe(
      'Making 16 takes for 4 tracks · about 48 min left',
    )
    expect(runningLine({ takes: 1, tracks: 1, left: 5 })).toBe(
      'Making 1 take for 1 track · about 1 min left',
    )
  })

  it('sums up what was made, what failed and what was stopped', () => {
    expect(summaryLead(16, 16)).toBe('Made 16 of 16 takes.')
    expect(summaryFailed(2, ['Market square'])).toEqual({
      before: '2 could not be made — ',
      after: ' says why.',
    })
    expect(summaryFailed(3, ['A', 'B'])).toEqual({
      before: '3 could not be made — ',
      after: ' say why.',
    })
    expect(summaryLead(16, 6)).toBe('Made 6 of 16 takes.')
    expect(summaryStopped(10)).toBe('10 were stopped.')
    expect(summaryStopped(1)).toBe('1 was stopped.')
    expect(summaryLead(16, 14)).toBe('Made 14 of 16 takes.')
  })

  it('joins names with commas and a last and', () => {
    expect(joinSeparators(1)).toEqual([''])
    expect(joinSeparators(2)).toEqual(['', ' and '])
    expect(joinSeparators(3)).toEqual(['', ', ', ' and '])
  })

  it('says stinger on the Stingers page', () => {
    expect(readyLine(3, 'stinger')).toBe('3 stingers have no chosen take')
    expect(readyLine(1, 'stinger')).toBe('1 stinger has no chosen take')
    expect(makeAllHeading(12, 3, 'stinger')).toBe('Make 12 takes for 3 stingers?')
    expect(makeAllHeading(4, 1, 'stinger')).toBe('Make 4 takes for 1 stinger?')
    expect(runningLine({ takes: 12, tracks: 3, left: 36 * 60, noun: 'stinger' })).toBe(
      'Making 12 takes for 3 stingers · about 36 min left',
    )
    expect(runningLine({ takes: 4, tracks: 1, left: 5, noun: 'stinger' })).toBe(
      'Making 4 takes for 1 stinger · about 1 min left',
    )
    expect(allChosenLine('stinger')).toBe('Every stinger has a chosen take.')
    expect(allChosenLine('track')).toBe('Every track has a chosen take.')
    expect(REFRESH_BLOCKED_BY_TAKES).toBe(
      'Takes are being made for the stingers. Refresh when they are done, or Stop all.',
    )
    expect(MAKE_BLOCKED_BY_REFRESH).toBe('Wait for the refresh from the game to finish.')
  })
})

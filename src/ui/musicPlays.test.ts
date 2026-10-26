import { describe, expect, it } from 'bun:test'
import type { CurrentMusic } from '../core/music'
import { canPlay, playLabel, playsText } from './musicPlays'

const take = (exists = true): CurrentMusic => ({ kind: 'take', take: 3, exists })
const game = (exists = true): CurrentMusic => ({
  kind: 'game',
  file: 'web/public/audio/forest-walk.mp3',
  exists,
})
const none: CurrentMusic = { kind: 'none' }

describe('playsText', () => {
  it('names the chosen take by its number', () => {
    expect(playsText(take())).toEqual({ lead: 'Take 3' })
  })

  it('says what plays is not known while the music lock cannot be read', () => {
    expect(playsText({ kind: 'unknown' })).toEqual({ lead: 'Not known', faint: true })
    expect(canPlay({ kind: 'unknown' })).toBe(false)
  })

  it('names the game’s file and puts the file name beneath', () => {
    expect(playsText(game())).toEqual({
      lead: "The game's file",
      file: 'forest-walk.mp3',
      path: 'web/public/audio/forest-walk.mp3',
    })
  })

  it('says a missing file is not there, for a take and for the game’s file', () => {
    expect(playsText(take(false))).toEqual({ lead: 'Take 3', missing: 'The file is not there.' })
    expect(playsText(game(false))).toEqual({
      lead: "The game's file",
      file: 'forest-walk.mp3',
      path: 'web/public/audio/forest-walk.mp3',
      missing: 'The file is not there.',
    })
  })

  it('says there is nothing to play', () => {
    expect(playsText(none)).toEqual({ lead: 'Nothing to play yet', faint: true })
  })

  it('adds the failure of a press under the file name', () => {
    expect(playsText(game(), 'open').failure).toBe("Couldn't play it: the file won't open.")
    expect(playsText(game(), 'gone').failure).toBe("Couldn't play it: the file is not there.")
  })
})

describe('canPlay', () => {
  it('is true only for music that is there', () => {
    expect([take(), game(), take(false), game(false), none].map(canPlay)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
  })
})

describe('playLabel', () => {
  it('says the track and what it plays', () => {
    expect(playLabel('Forest path', take(), false)).toBe('Play Forest path: take 3')
    expect(playLabel('Forest path', game(), false)).toBe("Play Forest path: the game's file")
  })

  it('says stop while it plays', () => {
    expect(playLabel('Forest path', game(), true)).toBe('Stop Forest path')
  })
})

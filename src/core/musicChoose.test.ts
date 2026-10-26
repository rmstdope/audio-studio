import { describe, expect, it } from 'bun:test'
import {
  MusicLockSchema,
  MusicManifestSchema,
  changedFields,
  changedLine,
  chosenLine,
  trackStatus,
  type LockEntry,
} from './musicChoose'
import { MUSIC_MODEL, type TakeInputs } from './musicTake'

const inputs: TakeInputs = { brief: 'calm', kind: 'loop', seconds: 80, bpm: 84, key: 'D major' }

const entry = (over: Partial<LockEntry> = {}): LockEntry => ({
  fp: '0123456789abcdef',
  model: MUSIC_MODEL,
  seed: 7,
  list: 'act1',
  take: 2,
  inputs,
  at: '2026-11-02T10:00:00.000Z',
  ...over,
})

describe('changedFields', () => {
  it('names nothing when the track is as its take was made', () => {
    expect(changedFields(entry(), MUSIC_MODEL, inputs)).toEqual([])
  })

  it('names what differs, in the order brief, length, tempo, key, model', () => {
    const now = { ...inputs, key: 'A minor', brief: 'bold', seconds: 90, bpm: null }
    expect(changedFields(entry({ model: 'old' }), MUSIC_MODEL, now)).toEqual([
      'brief',
      'length',
      'tempo',
      'key',
      'model',
    ])
  })
})

describe('changedLine', () => {
  it('words one, two and three changes', () => {
    expect(changedLine(['brief'])).toBe('Changed since its take was chosen: the brief.')
    expect(changedLine(['brief', 'length'])).toBe(
      'Changed since its take was chosen: the brief and the length.',
    )
    expect(changedLine(['brief', 'length', 'model'])).toBe(
      'Changed since its take was chosen: the brief, the length and the music model.',
    )
  })
})

describe('trackStatus', () => {
  it('is not chosen without a lock entry', () => {
    expect(trackStatus({ lock: undefined, current: inputs, fileExists: false })).toBe('not-chosen')
  })

  it('is chosen when nothing changed and the file is there', () => {
    expect(trackStatus({ lock: entry(), current: inputs, fileExists: true })).toBe('chosen')
  })

  it('is changed when the inputs differ from the chosen take’s own', () => {
    expect(trackStatus({ lock: entry(), current: { ...inputs, bpm: 90 }, fileExists: true })).toBe(
      'changed',
    )
  })

  it('is changed when the model moved on', () => {
    expect(trackStatus({ lock: entry({ model: 'old' }), current: inputs, fileExists: true })).toBe(
      'changed',
    )
  })

  it('is missing when the file is gone, even if something changed too', () => {
    expect(trackStatus({ lock: entry(), current: { ...inputs, bpm: 90 }, fileExists: false })).toBe(
      'missing',
    )
  })
})

describe('chosenLine', () => {
  it('counts the chosen, and says how many files are missing', () => {
    expect(chosenLine({ chosen: 2, total: 4, missing: 0 })).toBe('2 of 4 chosen.')
    expect(chosenLine({ chosen: 1, total: 3, missing: 1 })).toBe(
      "1 of 3 chosen; one's music file is missing.",
    )
    expect(chosenLine({ chosen: 1, total: 5, missing: 2 })).toBe(
      '1 of 5 chosen; 2 music files are missing.',
    )
  })

  it('counts a track that changed since it was chosen as chosen', () => {
    expect(chosenLine({ chosen: 3, total: 3, missing: 0 })).toBe('3 of 3 chosen.')
  })
})

describe('the lock and the manifest', () => {
  it('reads a lock entry and a manifest entry', () => {
    expect(MusicLockSchema.safeParse({ a: entry() }).success).toBe(true)
    expect(MusicManifestSchema.safeParse({ a: { file: 'a.mp3', duration: 80 } }).success).toBe(true)
  })

  it('rejects a lock entry without its take', () => {
    const { take: _take, ...broken } = entry()
    expect(MusicLockSchema.safeParse({ a: broken }).success).toBe(false)
  })
})

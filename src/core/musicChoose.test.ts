import { describe, expect, it } from 'bun:test'
import {
  MusicLockSchema,
  MusicManifestSchema,
  changedFields,
  changedLine,
  chooseUnread,
  chosenLine,
  inTheGame,
  unchooseFailure,
  unchooseQuestion,
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
    expect(changedFields(entry(), inputs)).toEqual([])
  })

  it('names what differs, in the order brief, length, tempo, key', () => {
    const now = { ...inputs, key: 'A minor', brief: 'bold', seconds: 90, bpm: null }
    expect(changedFields(entry({ model: 'old' }), now)).toEqual(['brief', 'length', 'tempo', 'key'])
  })
})

describe('changedLine', () => {
  it('words one, two and three changes', () => {
    expect(changedLine(['brief'])).toBe('Changed since its take was chosen: the brief.')
    expect(changedLine(['brief', 'length'])).toBe(
      'Changed since its take was chosen: the brief and the length.',
    )
    expect(changedLine(['brief', 'length', 'tempo'])).toBe(
      'Changed since its take was chosen: the brief, the length and the tempo.',
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

  it('stays chosen whatever model made the take', () => {
    expect(trackStatus({ lock: entry({ model: 'old' }), current: inputs, fileExists: true })).toBe(
      'chosen',
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

describe('inTheGame', () => {
  const file = { file: 'assets/music/willowbrook.mp3', exists: true }

  it('is the chosen take, with what Un-choose does', () => {
    expect(inTheGame({ current: { kind: 'take', take: 3, exists: true }, gameFile: file })).toEqual(
      {
        kind: 'take',
        take: 3,
        missing: false,
        hint: 'Un-choose and the game goes back to its own file.',
      },
    )
    expect(inTheGame({ current: { kind: 'take', take: 2, exists: true }, gameFile: null })).toEqual(
      {
        kind: 'take',
        take: 2,
        missing: false,
        hint: 'Un-choose and the game plays nothing here.',
      },
    )
  })

  it('is not known while the music lock cannot be read, whatever the game’s own file', () => {
    expect(inTheGame({ current: { kind: 'unknown' }, gameFile: file })).toEqual({
      kind: 'unknown',
      hint: 'Which take the game plays is not known until the lock can be read; fix it, then reload.',
    })
  })

  it('is the chosen take with its music file missing', () => {
    expect(
      inTheGame({ current: { kind: 'take', take: 3, exists: false }, gameFile: null }),
    ).toMatchObject({ kind: 'take', missing: true })
  })

  it('is the game’s own file when no take is chosen, there or not', () => {
    const current = { kind: 'game', ...file } as const
    expect(inTheGame({ current, gameFile: file })).toEqual({
      kind: 'game',
      file: file.file,
      exists: true,
      hint: 'Choose a take below and the game plays it instead.',
    })
    expect(
      inTheGame({ current: { ...current, exists: false }, gameFile: { ...file, exists: false } }),
    ).toMatchObject({ kind: 'game', exists: false })
  })

  it('is nothing without a take or a file', () => {
    expect(inTheGame({ current: { kind: 'none' }, gameFile: null })).toEqual({
      kind: 'nothing',
      hint: 'Choose a take below and the game plays it.',
    })
  })
})

describe('the Un-choose question', () => {
  it('says where the game goes, and what is deleted', () => {
    expect(unchooseQuestion(3, 'assets/music/freetouse/willowbrook-village.mp3')).toBe(
      "The game goes back to its own file (assets/music/freetouse/willowbrook-village.mp3). Take 3's music file is deleted from the game; Take 3 stays with the other takes, to be chosen again.",
    )
    expect(unchooseQuestion(2, null)).toBe(
      "The game plays nothing here until another take is chosen. Take 2's music file is deleted from the game; Take 2 stays with the other takes, to be chosen again.",
    )
  })

  it('reads a refusal as the end of the sentence', () => {
    expect(unchooseFailure(3, 'No take is chosen for this track.')).toBe(
      'Take 3 could not be un-chosen: no take is chosen for this track. Nothing was changed.',
    )
  })

  it('says why it failed and that nothing changed', () => {
    expect(unchooseFailure(3, 'the music lock could not be read')).toBe(
      'Take 3 could not be un-chosen: the music lock could not be read. Nothing was changed.',
    )
  })
})

describe('the line when Choose is refused for a file that cannot be read', () => {
  it('names the file and the first reason, without a doubled full stop', () => {
    const problems = [
      { message: 'JSON Parse error: Expected }.' },
      { message: 'a second reason, not shown' },
    ]
    expect(chooseUnread(2, { file: '.audio-studio/music/hall.json', problems })).toBe(
      'Take 2 could not be chosen: .audio-studio/music/hall.json could not be read (JSON Parse error: Expected }). Nothing was changed.',
    )
  })

  it('names the file alone when no reason came with it', () => {
    expect(chooseUnread(2, { file: 'audio-studio.json', problems: [] })).toBe(
      'Take 2 could not be chosen: audio-studio.json could not be read. Nothing was changed.',
    )
  })
})

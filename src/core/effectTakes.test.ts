import { describe, expect, it } from 'bun:test'
import {
  MakeEffectTakesBody,
  effectAcceptable,
  effectChangedAdvice,
  effectChangedFields,
  effectChangedLine,
  effectInTheGame,
  effectMakingStatus,
  effectTakeLength,
  effectStatus,
  effectTimeLeft,
  effectUnchooseQuestion,
  makeEffectTakesLabel,
  type EffectLockEntry,
} from './effectTakes'

const lock: EffectLockEntry = {
  fp: 'a'.repeat(16),
  model: 'small-sfx',
  take: 2,
  inputs: { description: 'A creaking door', seconds: 3 },
  at: '2026-11-03T10:00:00.000Z',
}
const now = { description: 'A creaking door', seconds: 3 }

describe('what changed since a take was chosen', () => {
  it('is nothing when the description and length are the same', () => {
    expect(effectChangedFields(lock, now)).toEqual([])
  })

  it('names the description, the length, or both, in that order', () => {
    expect(effectChangedFields(lock, { ...now, description: 'A slam' })).toEqual(['description'])
    expect(effectChangedFields(lock, { ...now, seconds: 4 })).toEqual(['length'])
    expect(effectChangedFields(lock, { description: 'x', seconds: 4 })).toEqual([
      'description',
      'length',
    ])
  })

  it('can be accepted only when it is the description alone', () => {
    expect(effectAcceptable(['description'])).toBe(true)
    expect(effectAcceptable(['length'])).toBe(false)
    expect(effectAcceptable(['description', 'length'])).toBe(false)
    expect(effectAcceptable([])).toBe(false)
  })

  it('words the box as agreed', () => {
    expect(effectChangedLine(['description'])).toBe(
      'Changed since its take was chosen: description.',
    )
    expect(effectChangedLine(['description', 'length'])).toBe(
      'Changed since its take was chosen: description and length.',
    )
    expect(effectChangedAdvice(['description'])).toBe(
      'The game plays the chosen take until you choose another. Make more takes to hear the new description, or Accept to count the chosen take as up to date.',
    )
    expect(effectChangedAdvice(['length'])).toBe(
      'The game plays the chosen take until you choose another. Make more takes to hear the new length. A changed length needs a new take.',
    )
    expect(effectChangedAdvice(['description', 'length'])).toBe(effectChangedAdvice(['length']))
  })
})

describe('an effect’s status', () => {
  const chosen = { lock, fileExists: true }
  it('is not known while the lock cannot be read, whatever else is true', () => {
    expect(effectStatus({ lockUnread: true, chosen, now, hasTakes: true })).toBe('unknown')
  })
  it('is none yet before any take, not chosen once there is one', () => {
    expect(effectStatus({ lockUnread: false, chosen: undefined, now, hasTakes: false })).toBe(
      'none-yet',
    )
    expect(effectStatus({ lockUnread: false, chosen: undefined, now, hasTakes: true })).toBe(
      'not-chosen',
    )
  })
  it('is chosen, changed, or missing (missing ahead of changed)', () => {
    expect(effectStatus({ lockUnread: false, chosen, now, hasTakes: true })).toBe('chosen')
    const changed = { ...now, seconds: 9 }
    expect(effectStatus({ lockUnread: false, chosen, now: changed, hasTakes: true })).toBe(
      'changed',
    )
    expect(
      effectStatus({
        lockUnread: false,
        chosen: { lock, fileExists: false },
        now: changed,
        hasTakes: true,
      }),
    ).toBe('missing')
  })
})

describe('what the In the game block shows', () => {
  it('is the chosen take, with its hint', () => {
    expect(effectInTheGame({ kind: 'take', take: 2, exists: true })).toEqual({
      kind: 'take',
      take: 2,
      missing: false,
      hint: 'Un-choose and the game plays nothing here.',
    })
  })
  it('says the clip is missing, and Choose again writes it again', () => {
    expect(effectInTheGame({ kind: 'take', take: 2, exists: false })).toMatchObject({
      missing: true,
      hint: "The game's clip for this effect is not there. Choose again writes it again.",
    })
  })
  it('is nothing, or not known', () => {
    expect(effectInTheGame({ kind: 'nothing' }).hint).toBe(
      'Choose a take below and the game plays it.',
    )
    expect(effectInTheGame({ kind: 'unknown' }).hint).toBe(
      'Which take the game plays is not known.',
    )
  })
  it('asks the Un-choose question as agreed', () => {
    expect(effectUnchooseQuestion(2)).toBe(
      "The game plays nothing here until another take is chosen. Take 2's clip is deleted from the game; Take 2 stays with the other takes, to be chosen again.",
    )
  })
})

describe('words for making takes', () => {
  it('words the button, with "more" once takes exist', () => {
    expect(makeEffectTakesLabel(4, false)).toBe('Make 4 takes')
    expect(makeEffectTakesLabel(4, true)).toBe('Make 4 more takes')
    expect(makeEffectTakesLabel(1, false)).toBe('Make 1 take')
  })
  it('words the time left on a card and in the list', () => {
    expect(effectTimeLeft({ state: 'waiting', elapsed: 0, expected: 2.5 })).toBe('waiting')
    expect(effectTimeLeft({ state: 'making', elapsed: 0, expected: 2.5 })).toBe(
      'making · about 2 s left',
    )
    expect(effectTimeLeft({ state: 'making', elapsed: 5, expected: 2.5 })).toBe(
      'making · about 1 s left',
    )
    expect(effectMakingStatus({ takes: 4, left: 10 })).toBe('making 4 takes · about 10 s')
    expect(effectMakingStatus({ takes: 1, left: 0.2 })).toBe('making 1 take · about 1 s')
  })
  it('accepts 1 to 8 takes at once, or a retry, and nothing else', () => {
    expect(MakeEffectTakesBody.safeParse({ count: 8 }).success).toBe(true)
    expect(MakeEffectTakesBody.safeParse({ count: 9 }).success).toBe(false)
    expect(MakeEffectTakesBody.safeParse({ count: 0 }).success).toBe(false)
    expect(MakeEffectTakesBody.safeParse({ retry: 3 }).success).toBe(true)
    expect(MakeEffectTakesBody.safeParse({ count: 2, model: 'x' }).success).toBe(false)
  })
})

describe('effectTakeLength', () => {
  it('writes the real length to a tenth of a second', () => {
    expect(effectTakeLength(1.4)).toBe('1.4 s')
    expect(effectTakeLength(2)).toBe('2.0 s')
    expect(effectTakeLength(0.5004)).toBe('0.5 s')
  })
})

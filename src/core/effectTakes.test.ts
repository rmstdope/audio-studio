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
  effectChipLine,
  effectTimeLeft,
  effectUnchooseQuestion,
  effectTakeChoosable,
  effectQuietLine,
  effectTakeKind,
  makeEffectTakesLabel,
  EffectLockSchema,
  EffectBoardTakeSchema,
  SetEffectFadesBody,
  effectFadable,
  effectFadesOf,
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

describe('how an effect plays, once or looping', () => {
  it('names a change of how it plays, in the direction it went', () => {
    expect(effectChangedFields(lock, { ...now, loops: true })).toEqual(['now loops'])
    const looping = { ...lock, inputs: { ...lock.inputs, loops: true } }
    expect(effectChangedFields(looping, now)).toEqual(['no longer loops'])
    expect(effectChangedFields(looping, { ...now, loops: true })).toEqual([])
    // A lock written before loops existed plays once.
    expect(effectChangedFields(lock, { ...now, loops: false })).toEqual([])
    expect(effectChangedFields(lock, { description: 'x', seconds: 4, loops: true })).toEqual([
      'description',
      'length',
      'now loops',
    ])
  })

  it('is never accepted', () => {
    expect(effectAcceptable(['description', 'now loops'])).toBe(false)
    expect(effectAcceptable(['no longer loops'])).toBe(false)
  })

  it('words the box as agreed, alone and with the description or length', () => {
    const head = 'Changed since its take was chosen:'
    expect(effectChangedLine(['now loops'])).toBe(`${head} now loops.`)
    expect(effectChangedLine(['no longer loops'])).toBe(`${head} no longer loops.`)
    expect(effectChangedLine(['description', 'now loops'])).toBe(
      `${head} description, and now loops.`,
    )
    expect(effectChangedLine(['length', 'no longer loops'])).toBe(
      `${head} length, and no longer loops.`,
    )
    expect(effectChangedLine(['description', 'length', 'now loops'])).toBe(
      `${head} description and length, and now loops.`,
    )
  })

  it('gives the advice for the direction of the change', () => {
    const once =
      "The game plays the chosen take until you choose another. Make more takes that loop. A take made to play once can't loop without a jump."
    const loops =
      'The game plays the chosen take until you choose another. Make more takes that play once. A take made to loop runs to the full length instead of ending with its sound.'
    expect(effectChangedAdvice(['now loops'])).toBe(once)
    expect(effectChangedAdvice(['length', 'now loops'])).toBe(once)
    expect(effectChangedAdvice(['description', 'no longer loops'])).toBe(loops)
  })

  it('says which kind a take is when it differs from the effect, and lets only the right kind be chosen', () => {
    expect(effectTakeKind({ loops: false }, true)).toBe('made to play once')
    expect(effectTakeKind({ loops: true }, false)).toBe('made to loop')
    expect(effectTakeKind({ loops: true }, true)).toBeNull()
    expect(effectTakeKind({ loops: false }, false)).toBeNull()
    expect(effectTakeChoosable({ loops: true }, true)).toBe(true)
    expect(effectTakeChoosable({ loops: false }, true)).toBe(false)
  })
})

describe('the line for a loop that goes quiet early', () => {
  it('names where, to a tenth of a second', () => {
    expect(effectQuietLine(6.2)).toBe('Goes quiet at 6.2 s, so it loops with a gap.')
    expect(effectQuietLine(8.04)).toBe('Goes quiet at 8.0 s, so it loops with a gap.')
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
    expect(effectMakingStatus({ takes: 4, left: 400 })).toBe('making 4 takes · about 6 min 40 s')
    expect(effectMakingStatus({ takes: 1, left: 0.2 })).toBe('making 1 take · about 1 s')
  })
  it('words a slow take’s time in minutes and a wait for the graphics chip', () => {
    expect(effectTimeLeft({ state: 'making', elapsed: 30, expected: 100 })).toBe(
      'making · about 1 min 10 s left',
    )
    expect(effectTimeLeft({ state: 'making', elapsed: 40, expected: 100 })).toBe(
      'making · about 1 min left',
    )
    expect(effectTimeLeft({ state: 'making', elapsed: 90, expected: 100 })).toBe(
      'making · about 10 s left',
    )
    expect(
      effectTimeLeft({ state: 'waiting', elapsed: 0, expected: 100, chip: { using: null } }),
    ).toBe('waiting for the graphics chip')
    expect(effectChipLine('music')).toBe('Music is being made first.')
    expect(effectChipLine('image')).toBe('An image is being made first.')
    expect(effectChipLine('effect')).toBe('Another effect is being made first.')
    expect(effectChipLine('recording')).toBe('A recording is being checked first.')
    expect(effectChipLine(null)).toBeNull()
  })
  it('accepts a model with a count, and only a known one', () => {
    expect(MakeEffectTakesBody.safeParse({ count: 2, model: 'open-1' }).success).toBe(true)
    expect(MakeEffectTakesBody.safeParse({ count: 2, model: 'huge' }).success).toBe(false)
    expect(MakeEffectTakesBody.safeParse({ retry: 2, model: 'open-1' }).success).toBe(false)
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

describe('the effects lock file', () => {
  const line = (id: string, inputs: string) =>
    ` "${id}": {"fp":"${'a'.repeat(16)}","model":"small-sfx","seed":7,"take":2,"inputs":${inputs},"at":"2026-11-03T10:00:00.000Z"}`
  const text = [
    '{',
    `${line('coins', '{"text":"Coins spill","seconds":0.5}')},`,
    line('rain', '{"text":"Steady rain","seconds":8,"loops":true}'),
    '}',
    '',
  ].join('\n')

  it('reads a take’s words as text, given to the studio as its description', () => {
    const read = EffectLockSchema.parse(JSON.parse(text))
    expect(read.coins!.inputs).toEqual({ description: 'Coins spill', seconds: 0.5 })
    expect(read.rain!.inputs).toEqual({ description: 'Steady rain', seconds: 8, loops: true })
    expect(read.rain).toMatchObject({ fp: 'a'.repeat(16), model: 'small-sfx', seed: 7, take: 2 })
  })

  it('refuses an entry whose words are written as description, as before version 2', () => {
    const old = { coins: { ...lock, inputs: { description: 'Coins', seconds: 1 } } }
    const parsed = EffectLockSchema.safeParse(old)
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['coins.inputs.text'])
  })
})

describe('fades of a sound effect take', () => {
  const fades = { in: 0.01, out: 0.4, shape: 'smooth' as const }

  it('keeps fades on a board take, and a take without them parses as before', () => {
    const take = {
      n: 1,
      hash: 'a'.repeat(16),
      model: 'small-sfx',
      seconds: 1.4,
      peaks: [0.5],
      inputs: { description: 'A door', seconds: 2 },
    }
    expect(EffectBoardTakeSchema.parse(take).fades).toBeUndefined()
    expect(EffectBoardTakeSchema.parse({ ...take, fades }).fades).toEqual(fades)
  })

  it('takes a body of two lengths and a shape, and nothing else', () => {
    expect(SetEffectFadesBody.safeParse(fades).success).toBe(true)
    expect(SetEffectFadesBody.safeParse({ ...fades, extra: 1 }).success).toBe(false)
    expect(SetEffectFadesBody.safeParse({ ...fades, in: -1 }).success).toBe(false)
  })

  it('is fadable only for a take made to play once on an effect that plays once', () => {
    expect(effectFadable({ loops: false }, false)).toBe(true)
    expect(effectFadable({ loops: true }, true)).toBe(false)
    expect(effectFadable({ loops: true }, false)).toBe(false)
    expect(effectFadable({ loops: false }, true)).toBe(false)
  })

  it('gives the saved fades while fadable, none while the effect loops, and again after', () => {
    expect(effectFadesOf({ loops: false, fades }, false)).toEqual(fades)
    expect(effectFadesOf({ loops: false, fades }, true)).toBeUndefined()
    expect(effectFadesOf({ loops: false, fades }, false)).toEqual(fades)
    expect(effectFadesOf({ loops: false }, false)).toBeUndefined()
    expect(
      effectFadesOf({ loops: false, fades: { ...fades, in: 0, out: 0 } }, false),
    ).toBeUndefined()
    expect(effectFadesOf({ loops: true, fades }, true)).toBeUndefined()
  })
})

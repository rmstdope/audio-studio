import { describe, expect, it } from 'bun:test'
import {
  applyDescription,
  effectName,
  effectSeconds,
  effectsDiff,
  keepMine,
  readEffectEntries,
  summarizeEffects,
  type EffectOverrides,
  type EffectsListState,
} from './effects'

const door = { id: 'door-creak', description: 'A slow wooden door creaks open', seconds: 3 }
const coins = { id: 'coins', description: 'Coins spill on stone', seconds: 0.5 }

describe('effectName and effectSeconds', () => {
  it('makes a readable name from the id', () => {
    expect(effectName('door-creak')).toBe('Door creak')
    expect(effectName('coins')).toBe('Coins')
  })

  it('writes the length in seconds, halves included', () => {
    expect(effectSeconds(3)).toBe('3 s')
    expect(effectSeconds(0.5)).toBe('0.5 s')
    expect(effectSeconds(10)).toBe('10 s')
  })
})

describe('readEffectEntries', () => {
  it('reads every entry in the game order', () => {
    const read = readEffectEntries([door, coins], 'tts/effects.json')
    expect(read).toMatchObject({ ok: true, effects: [door, coins], problems: [], unreadable: 0 })
  })

  it('is unreadable as a whole when the file is not a list', () => {
    expect(readEffectEntries({ effects: [] }, 'tts/effects.json')).toEqual({
      ok: false,
      problems: [{ file: 'tts/effects.json', path: '', message: 'expected a list of effects' }],
    })
  })

  it('leaves out an entry with a problem and names its file and place', () => {
    const read = readEffectEntries(
      [door, { id: 'Bad Id', description: 'x', seconds: 2 }, { id: 'wind', seconds: 0 }],
      'tts/effects.json',
    )
    if (!read.ok) throw new Error('expected a list')
    expect(read.effects).toEqual([door])
    expect(read.unreadable).toBe(2)
    expect(read.problems.map((p) => [p.file, p.path])).toEqual([
      ['tts/effects.json', '[1].id'],
      ['tts/effects.json', '[2].description'],
      ['tts/effects.json', '[2].seconds'],
    ])
    // The ids of the entries that failed are known, so their overrides are not taken for dropped.
    expect([...read.seenIds].sort()).toEqual(['Bad Id', 'door-creak', 'wind'])
  })

  it('leaves out both entries of an id used twice', () => {
    const read = readEffectEntries([door, coins, { ...door, seconds: 4 }], 'tts/effects.json')
    if (!read.ok) throw new Error('expected a list')
    expect(read.effects).toEqual([coins])
    expect(read.unreadable).toBe(2)
    expect(read.problems).toEqual([
      { file: 'tts/effects.json', path: '[0].id', message: '"door-creak" is used twice' },
      { file: 'tts/effects.json', path: '[2].id', message: '"door-creak" is used twice' },
    ])
  })
})

describe('an id used twice with one copy unreadable', () => {
  it('leaves out the readable copy too', () => {
    const read = readEffectEntries(
      [door, { id: 'door-creak', description: '', seconds: 1 }],
      'tts/effects.json',
    )
    if (!read.ok) throw new Error('expected a list')
    expect(read.effects).toEqual([])
    expect(read.problems.map((p) => p.path)).toContain('[0].id')
  })
})

describe('the studio’s own descriptions', () => {
  it('stores the words with the game’s words they were written over', () => {
    expect(applyDescription({}, 'coins', 'Coins on glass', coins.description)).toEqual({
      coins: { words: 'Coins on glass', gameWas: coins.description },
    })
  })

  it('trims the words', () => {
    expect(applyDescription({}, 'coins', '  Coins on glass \n', 'x').coins!.words).toBe(
      'Coins on glass',
    )
  })

  it('returns to the game’s words when emptied, set to null or typed back', () => {
    const own: EffectOverrides = { coins: { words: 'Mine', gameWas: coins.description } }
    expect(applyDescription(own, 'coins', '  ', coins.description)).toEqual({})
    expect(applyDescription(own, 'coins', null, coins.description)).toEqual({})
    expect(applyDescription(own, 'coins', coins.description, coins.description)).toEqual({})
  })

  it('keeps the other effects’ words', () => {
    const own: EffectOverrides = { door: { words: 'D', gameWas: 'd' } }
    expect(applyDescription(own, 'coins', 'C', 'c')).toEqual({
      door: { words: 'D', gameWas: 'd' },
      coins: { words: 'C', gameWas: 'c' },
    })
  })

  it('keeps mine by taking the game’s present words as the ones yours were written over', () => {
    const own: EffectOverrides = { coins: { words: 'Mine', gameWas: 'old' } }
    expect(keepMine(own, 'coins', 'new')).toEqual({ coins: { words: 'Mine', gameWas: 'new' } })
    expect(keepMine(own, 'door', 'x')).toEqual(own)
  })
})

describe('effectsDiff', () => {
  it('names the ids added and removed', () => {
    expect(effectsDiff([door], [coins])).toEqual({ added: ['coins'], removed: ['door-creak'] })
    expect(effectsDiff([door], [door])).toEqual({ added: [], removed: [] })
  })
})

describe('summarizeEffects', () => {
  const ok = (effects = [door, coins], extra: Partial<EffectsListState> = {}): EffectsListState =>
    ({
      status: 'ok',
      effects,
      problems: [],
      unreadable: 0,
      seenIds: new Set(effects.map((e) => e.id)),
      ...extra,
    }) as EffectsListState

  it('lists every effect, none yet, all needing attention', () => {
    const summary = summarizeEffects({ list: ok(), overrides: {}, canRefresh: true })
    expect(summary.status).toBe('ok')
    expect(summary.canRefresh).toBe(true)
    expect(summary.rows.map((r) => [r.id, r.name, r.seconds, r.status])).toEqual([
      ['door-creak', 'Door creak', 3, 'none-yet'],
      ['coins', 'Coins', 0.5, 'none-yet'],
    ])
    expect(summary.done).toEqual({ done: 0, total: 2, needs: ['door-creak', 'coins'] })
  })

  it('shows the studio’s words in use, with the game’s beside them', () => {
    const summary = summarizeEffects({
      list: ok(),
      overrides: { coins: { words: 'Coins on glass', gameWas: coins.description } },
      canRefresh: false,
    })
    const row = summary.rows[1]!
    expect(row).toMatchObject({
      description: 'Coins on glass',
      gameDescription: coins.description,
      changedHere: true,
      gameChanged: false,
    })
    expect(summary.rows[0]).toMatchObject({ changedHere: false, description: door.description })
  })

  it('flags an effect whose game words changed since yours were written', () => {
    const summary = summarizeEffects({
      list: ok(),
      overrides: { coins: { words: 'Mine', gameWas: 'Something older' } },
      canRefresh: false,
    })
    expect(summary.rows[1]).toMatchObject({ changedHere: true, gameChanged: true })
  })

  it('collects the words of effects the game dropped, but not those it only fails to read', () => {
    const summary = summarizeEffects({
      list: ok([door], { seenIds: new Set(['door-creak', 'wind']), unreadable: 1 }),
      overrides: {
        coins: { words: 'Mine', gameWas: 'x' },
        wind: { words: 'Howl', gameWas: 'y' },
      },
      canRefresh: false,
    })
    expect(summary.dropped).toEqual([{ id: 'coins', name: 'Coins', words: 'Mine' }])
    expect(summary.unreadable).toBe(1)
  })

  it('counts only the readable ones and keeps the problems', () => {
    const problem = { file: 'f', path: '[1].id', message: 'bad' }
    const summary = summarizeEffects({
      list: ok([door], { problems: [problem], unreadable: 1 }),
      overrides: {},
      canRefresh: false,
    })
    expect(summary.done.total).toBe(1)
    expect(summary.problems).toEqual([problem])
  })

  it('has no rows, no count and no dropped list while the list cannot be read', () => {
    const problems = [{ file: 'f', path: '', message: 'bad' }]
    const invalid = summarizeEffects({
      list: { status: 'invalid', problems },
      overrides: { coins: { words: 'Mine', gameWas: 'x' } },
      canRefresh: true,
    })
    expect(invalid).toMatchObject({ status: 'invalid', rows: [], dropped: [], problems })
    const missing = summarizeEffects({
      list: { status: 'missing' },
      overrides: {},
      canRefresh: false,
    })
    expect(missing).toMatchObject({ status: 'missing', rows: [], dropped: [], problems: [] })
  })

  it('is unreadable as a whole when no entry can be read', () => {
    const problems = [{ file: 'f', path: '[0].id', message: 'bad' }]
    const s = summarizeEffects({
      list: ok([], { problems, unreadable: 1 }),
      overrides: {},
      canRefresh: true,
    })
    expect(s).toMatchObject({ status: 'invalid', rows: [], dropped: [], problems })
  })

  it('is an empty list when the game asks for none', () => {
    const summary = summarizeEffects({ list: ok([]), overrides: {}, canRefresh: false })
    expect(summary).toMatchObject({ status: 'ok', rows: [], done: { done: 0, total: 0 } })
  })
})

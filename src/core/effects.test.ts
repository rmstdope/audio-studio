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
  type EffectsState,
} from './effects'

const door = { id: 'door-creak', description: 'A slow wooden door creaks open', seconds: 3 }
const coins = { id: 'coins', description: 'Coins spill on stone', seconds: 0.5 }

/** An effect as the game's list writes it: its words are `text`, read as its description. */
function listed<T extends { description: string }>(effect: T) {
  const { description, ...rest } = effect
  return { ...rest, text: description }
}

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

describe('an effect that loops', () => {
  it('reads loops from the game’s list, and a row says it, defaulting to plays once', () => {
    const rain = { id: 'rain', description: 'Steady rain', seconds: 8, loops: true }
    const read = readEffectEntries([listed(door), listed(rain)], 'tts/effects.json')
    expect(read).toMatchObject({ ok: true, effects: [door, rain], problems: [] })
    const summary = summarizeEffects({
      list: {
        status: 'ok',
        effects: [door, rain],
        problems: [],
        unreadable: 0,
        seenIds: new Set(),
      },
      overrides: {},
      canRefresh: false,
    })
    expect(summary.rows.map((r) => r.loops)).toEqual([false, true])
  })

  it('leaves out an entry whose loops is not true or false, naming the place', () => {
    const read = readEffectEntries([{ ...listed(door), loops: 'yes' }], 'tts/effects.json')
    expect(read).toMatchObject({
      ok: true,
      effects: [],
      problems: [{ file: 'tts/effects.json', path: '[0].loops' }],
    })
  })

  it('is changed since chosen when how it plays differs from the chosen take', () => {
    const lockEntry = {
      fp: 'a'.repeat(16),
      model: 'small-sfx',
      take: 1,
      inputs: { description: door.description, seconds: 3 },
      at: '2026-11-03T10:00:00.000Z',
    }
    const summary = summarizeEffects({
      list: {
        status: 'ok',
        effects: [{ ...door, loops: true }],
        problems: [],
        unreadable: 0,
        seenIds: new Set(),
      },
      overrides: {},
      canRefresh: false,
      state: {
        chosen: { 'door-creak': { lock: lockEntry, fileExists: true } },
        takesMade: new Set(),
      },
    })
    expect(summary.rows[0]).toMatchObject({ status: 'changed', changed: ['now loops'] })
  })
})

describe('readEffectEntries', () => {
  it('reads every entry in the game order', () => {
    const read = readEffectEntries([listed(door), listed(coins)], 'tts/effects.json')
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
      [listed(door), { id: 'Bad Id', text: 'x', seconds: 2 }, { id: 'wind', seconds: 0 }],
      'tts/effects.json',
    )
    if (!read.ok) throw new Error('expected a list')
    expect(read.effects).toEqual([door])
    expect(read.unreadable).toBe(2)
    expect(read.problems.map((p) => [p.file, p.path])).toEqual([
      ['tts/effects.json', '[1].id'],
      ['tts/effects.json', '[2].text'],
      ['tts/effects.json', '[2].seconds'],
    ])
    // The ids of the entries that failed are known, so their overrides are not taken for dropped.
    expect([...read.seenIds].sort()).toEqual(['Bad Id', 'door-creak', 'wind'])
  })

  it('leaves out both entries of an id used twice', () => {
    const read = readEffectEntries(
      [listed(door), listed(coins), { ...listed(door), seconds: 4 }],
      'tts/effects.json',
    )
    if (!read.ok) throw new Error('expected a list')
    expect(read.effects).toEqual([coins])
    expect(read.unreadable).toBe(2)
    expect(read.problems).toEqual([
      { file: 'tts/effects.json', path: '[0].id', message: '"door-creak" is used twice' },
      { file: 'tts/effects.json', path: '[2].id', message: '"door-creak" is used twice' },
    ])
  })
})

describe('the words and the title of an effect', () => {
  it('reads the game’s text as the effect’s description', () => {
    const read = readEffectEntries([listed(door)], 'tts/effects.json')
    expect(read).toMatchObject({ ok: true, effects: [door], problems: [] })
  })

  it('leaves out an entry that gives its words as description, as before version 2', () => {
    const read = readEffectEntries([door], 'tts/effects.json')
    expect(read).toMatchObject({
      ok: true,
      effects: [],
      problems: [{ file: 'tts/effects.json', path: '[0].text' }],
    })
  })

  it('reads an optional title and shows it as the effect’s name', () => {
    const titled = { ...listed(door), title: 'The cellar door' }
    const read = readEffectEntries([titled, listed(coins)], 'tts/effects.json')
    if (!read.ok) throw new Error('expected a list')
    expect(read.effects).toEqual([{ ...door, title: 'The cellar door' }, coins])
    const summary = summarizeEffects({
      list: { status: 'ok', ...read },
      overrides: {},
      canRefresh: false,
    })
    expect(summary.rows.map((r) => r.name)).toEqual(['The cellar door', 'Coins'])
  })

  it('leaves out an entry with an empty title, naming the place', () => {
    const read = readEffectEntries([{ ...listed(door), title: '' }], 'tts/effects.json')
    expect(read).toMatchObject({
      ok: true,
      effects: [],
      problems: [{ file: 'tts/effects.json', path: '[0].title' }],
    })
  })
})

describe('an id used twice with one copy unreadable', () => {
  it('leaves out the readable copy too', () => {
    const read = readEffectEntries(
      [listed(door), { id: 'door-creak', text: '', seconds: 1 }],
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

  describe('with takes', () => {
    const lock = (take: number, description: string, seconds: number) => ({
      fp: 'a'.repeat(16),
      model: 'small-sfx',
      take,
      inputs: { description, seconds },
      at: '2026-11-03T10:00:00.000Z',
    })
    const summarize = (state: EffectsState) =>
      summarizeEffects({ list: ok(), overrides: {}, canRefresh: false, state })
    const none = { chosen: {}, takesMade: new Set<string>() }

    it('reads none yet, then not chosen once a take exists', () => {
      const rows = summarize({ ...none, takesMade: new Set(['coins']) }).rows
      expect(rows.map((r) => r.status)).toEqual(['none-yet', 'not-chosen'])
    })

    it('reads chosen, with the chosen take and whether its clip is there', () => {
      const state = {
        ...none,
        chosen: {
          'door-creak': { lock: lock(2, door.description, 3), fileExists: true },
          coins: { lock: lock(1, coins.description, 0.5), fileExists: false },
        },
      }
      const { rows, done } = summarize(state)
      expect(rows.map((r) => [r.status, r.current])).toEqual([
        ['chosen', { kind: 'take', take: 2, exists: true }],
        ['missing', { kind: 'take', take: 1, exists: false }],
      ])
      // Up to date means chosen and not changed since; a missing clip needs attention.
      expect(done).toEqual({ done: 1, total: 2, needs: ['coins'] })
    })

    it('reads changed when the description in use or the length differs from the chosen take’s', () => {
      const state = {
        ...none,
        chosen: {
          'door-creak': { lock: lock(2, 'Other words', 3), fileExists: true },
          coins: { lock: lock(1, coins.description, 9), fileExists: true },
        },
      }
      const { rows, done } = summarize(state)
      expect(rows.map((r) => [r.status, r.changed])).toEqual([
        ['changed', ['description']],
        ['changed', ['length']],
      ])
      expect(done.done).toBe(0)
    })

    it('compares with the studio’s own words when they are in use', () => {
      const state = {
        ...none,
        chosen: { coins: { lock: lock(1, 'Coins on glass', 0.5), fileExists: true } },
      }
      const summary = summarizeEffects({
        list: ok(),
        overrides: { coins: { words: 'Coins on glass', gameWas: coins.description } },
        canRefresh: false,
        state,
      })
      expect(summary.rows[1]!.status).toBe('chosen')
    })

    it('is not known everywhere while the lock cannot be read', () => {
      const { rows, done } = summarize({ ...none, chosen: null })
      expect(rows.map((r) => [r.status, r.current])).toEqual([
        ['unknown', { kind: 'unknown' }],
        ['unknown', { kind: 'unknown' }],
      ])
      expect(done.done).toBe(0)
    })
  })
})

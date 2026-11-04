import { describe, expect, test } from 'bun:test'
import { createSceneEngine, type EngineRow } from './sceneEngine'

const row = (over: Partial<EngineRow>): EngineRow => ({
  id: 'fx',
  play: { mode: 'loop' },
  state: null,
  seconds: 2,
  ...over,
})

describe('the scene engine', () => {
  test('entering starts the loops of the state, and nothing else at once', () => {
    const engine = createSceneEngine({ random: () => 0 })
    const cues = engine.enter(
      [row({}), row({ state: 'cat' }), row({ play: { mode: 'random', everySeconds: [5, 5] } })],
      'plain',
      0,
    )
    expect(cues).toEqual([{ kind: 'start', slot: 0, loop: true, fade: false }])
  })

  test('a once effect starts after its delay and not again', () => {
    const engine = createSceneEngine({ random: () => 0 })
    engine.enter([row({ play: { mode: 'once', afterSeconds: 3 } })], 'plain', 0)
    expect(engine.now(0, 0)).toEqual({ kind: 'in', seconds: 3 })
    expect(engine.advance(2.9)).toEqual([])
    expect(engine.advance(3)).toEqual([{ kind: 'start', slot: 0, loop: false, fade: false }])
    expect(engine.now(0, 4)).toEqual({ kind: 'playing' })
    expect(engine.now(0, 5.5)).toEqual({ kind: 'played', at: 3 })
    expect(engine.advance(100)).toEqual([])
  })

  test('a random effect waits within its range before each start, the first included', () => {
    const engine = createSceneEngine({ random: () => 0.5 })
    engine.enter([row({ play: { mode: 'random', everySeconds: [10, 20] } })], 'plain', 0)
    expect(engine.now(0, 0)).toEqual({ kind: 'next', seconds: 15 })
    expect(engine.advance(14.9)).toEqual([])
    expect(engine.advance(15)).toHaveLength(1)
    expect(engine.now(0, 16)).toEqual({ kind: 'playing' })
    // The next wait counts from the end of the clip (15 + 2).
    expect(engine.now(0, 17)).toEqual({ kind: 'next', seconds: 15 })
    expect(engine.advance(31.9)).toEqual([])
    expect(engine.advance(32)).toHaveLength(1)
  })

  test('a late tick starts what is due once', () => {
    const engine = createSceneEngine({ random: () => 0 })
    engine.enter([row({ play: { mode: 'random', everySeconds: [1, 1] } })], 'plain', 0)
    expect(engine.advance(60)).toHaveLength(1)
  })

  test('a row with no clip sounds nothing but keeps its timing', () => {
    const engine = createSceneEngine({ random: () => 0 })
    engine.enter([row({ play: { mode: 'once', afterSeconds: 1 }, seconds: null })], 'plain', 0)
    expect(engine.advance(1)).toEqual([])
    expect(engine.now(0, 2)).toEqual({ kind: 'played', at: 1 })
  })

  test('switching state fades out old-only rows and fades in new-only rows; the rest carry on', () => {
    const engine = createSceneEngine({ random: () => 0 })
    engine.enter([row({ state: 'plain' }), row({ state: 'cat' }), row({})], 'plain', 0)
    expect(engine.setState('cat', 5)).toEqual([
      { kind: 'stop', slot: 0, loop: true, fade: true },
      { kind: 'start', slot: 1, loop: true, fade: true },
    ])
    expect(engine.now(0, 5)).toEqual({ kind: 'otherState' })
    expect(engine.now(2, 5)).toEqual({ kind: 'playing' })
    expect(engine.setState('cat', 6)).toEqual([])
  })

  test('leaving a state cancels a wait, and coming back starts it afresh; a sounded once stays sounded', () => {
    const engine = createSceneEngine({ random: () => 0 })
    engine.enter(
      [
        row({ state: 'plain', play: { mode: 'once', afterSeconds: 4 } }),
        row({ state: 'plain', play: { mode: 'once', afterSeconds: 1 } }),
      ],
      'plain',
      0,
    )
    engine.advance(1)
    engine.setState('cat', 3)
    expect(engine.advance(10)).toEqual([])
    engine.setState('plain', 10)
    expect(engine.now(0, 10)).toEqual({ kind: 'in', seconds: 4 })
    expect(engine.now(1, 10)).toEqual({ kind: 'played', at: 1 })
    expect(engine.advance(14)).toEqual([{ kind: 'start', slot: 0, loop: false, fade: false }])
  })

  test('a trigger plays its rows at once, once each, only in their state', () => {
    const engine = createSceneEngine({ random: () => 0 })
    engine.enter(
      [
        row({ play: { mode: 'trigger', trigger: 'door' } }),
        row({ play: { mode: 'trigger', trigger: 'door' }, state: 'cat' }),
        row({ play: { mode: 'trigger', trigger: 'bell' } }),
      ],
      'plain',
      0,
    )
    expect(engine.now(0, 0)).toEqual({ kind: 'waits', trigger: 'door' })
    expect(engine.fire('door', 1)).toEqual([{ kind: 'start', slot: 0, loop: false, fade: false }])
    expect(engine.now(0, 2)).toEqual({ kind: 'playing' })
    expect(engine.now(0, 3.5)).toEqual({ kind: 'waits', trigger: 'door' })
    expect(engine.now(1, 3.5)).toEqual({ kind: 'otherState' })
  })

  test('changed rows start afresh, added rows start, removed rows stop, the rest carry on', () => {
    const engine = createSceneEngine({ random: () => 0 })
    const loop = row({})
    const once = row({ id: 'bell', play: { mode: 'once', afterSeconds: 5 } })
    engine.enter([loop, once], 'plain', 0)
    engine.advance(5)
    const edited = row({ id: 'bell', play: { mode: 'once', afterSeconds: 2 } })
    const added = row({ id: 'purr' })
    const change = engine.setRows([loop, edited, added], 6)
    expect(change.slots).toEqual([0, 2, 3])
    expect(change.cues).toEqual([
      { kind: 'stop', slot: 1, loop: false, fade: true },
      { kind: 'start', slot: 3, loop: true, fade: false },
    ])
    expect(engine.now(2, 6)).toEqual({ kind: 'in', seconds: 2 })
    expect(engine.advance(8)).toEqual([{ kind: 'start', slot: 2, loop: false, fade: false }])
    // Removing the first row restarts none of the others.
    const removed = engine.setRows([edited, added], 9)
    expect(removed.slots).toEqual([2, 3])
    expect(removed.cues).toEqual([{ kind: 'stop', slot: 0, loop: true, fade: true }])
  })
})

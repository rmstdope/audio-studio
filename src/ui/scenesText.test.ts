import { describe, expect, it } from 'bun:test'
import type { SceneRow } from '../core/scenes'
import { howItPlays, levelText, listCount, statesLine } from './scenesText'

describe('how an effect plays', () => {
  it('is written as the page words it', () => {
    expect(howItPlays({ mode: 'loop' })).toBe('Round and round')
    expect(howItPlays({ mode: 'random', everySeconds: [15, 30] })).toBe(
      'Now and then, every 15–30 s',
    )
    expect(howItPlays({ mode: 'once', afterSeconds: 1.5 })).toBe('Once, 1.5 s after entering')
    expect(howItPlays({ mode: 'trigger', trigger: 'door-opens' })).toBe('On a trigger: door-opens')
  })
})

describe('a level', () => {
  it('is a whole percent', () => {
    expect(levelText(1)).toBe('100%')
    expect(levelText(0.6)).toBe('60%')
    expect(levelText(0.625)).toBe('63%')
    expect(levelText(3)).toBe('300%')
    expect(levelText(0)).toBe('0%')
  })
})

describe('what a scene list row says', () => {
  const row = (over: Partial<SceneRow>, effects = 0) =>
    ({ gone: 0, silent: 0, unreadable: false, effects: new Array(effects), ...over }) as SceneRow

  it('counts effects, none when there are none', () => {
    expect(listCount(row({}, 2))).toEqual({ text: '2 effects', red: false })
    expect(listCount(row({}, 1))).toEqual({ text: '1 effect', red: false })
    expect(listCount(row({}, 0))).toEqual({ text: 'none', red: false })
  })

  it('counts what is gone before what is silent, in red', () => {
    expect(listCount(row({ gone: 1, silent: 1 }, 3))).toEqual({ text: '1 gone', red: true })
    expect(listCount(row({ silent: 2 }, 3))).toEqual({ text: '2 silent', red: true })
  })

  it('says a scene that cannot be read is unreadable, in red', () => {
    expect(listCount(row({ unreadable: true }))).toEqual({ text: 'unreadable', red: true })
  })
})

describe('the line under the scene’s name', () => {
  it('lists the states and the triggers', () => {
    expect(statesLine({ states: ['plain', 'cat-home'], triggers: ['door-opens'] })).toBe(
      'States: plain, cat-home · Triggers: door-opens',
    )
  })
  it('says none for what the scene has none of', () => {
    expect(statesLine({ states: [], triggers: [] })).toBe('No states · No triggers')
    expect(statesLine({ states: [], triggers: ['bell-tolls'] })).toBe(
      'States: none · Triggers: bell-tolls',
    )
    expect(statesLine({ states: ['plain'], triggers: [] })).toBe('States: plain · Triggers: none')
  })
})

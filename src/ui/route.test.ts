import { describe, expect, it } from 'bun:test'
import { parseRoute, routeHref } from './route'

describe('a character’s language in the address', () => {
  it('keeps the language on the list of every character', () => {
    expect(parseRoute('#/characters?language=sv')).toEqual({ view: 'characters', language: 'sv' })
    expect(routeHref({ view: 'characters', language: 'sv' })).toBe('#/characters?language=sv')
    expect(parseRoute('#/characters')).toEqual({ view: 'characters' })
    expect(routeHref({ view: 'characters' })).toBe('#/characters')
  })

  it('is kept on the character’s page and on its audition', () => {
    expect(parseRoute('#/characters/mira?language=sv')).toEqual({
      view: 'character',
      character: 'mira',
      language: 'sv',
    })
    expect(parseRoute('#/characters/mira/audition?language=sv')).toEqual({
      view: 'audition',
      character: 'mira',
      language: 'sv',
    })
    expect(routeHref({ view: 'character', character: 'mira', language: 'sv' })).toBe(
      '#/characters/mira?language=sv',
    )
    expect(routeHref({ view: 'audition', character: 'old mira', language: 'sv' })).toBe(
      '#/characters/old%20mira/audition?language=sv',
    )
  })

  it('is left out when there is none, as before', () => {
    expect(parseRoute('#/characters/mira')).toEqual({ view: 'character', character: 'mira' })
    expect(routeHref({ view: 'character', character: 'mira' })).toBe('#/characters/mira')
  })
})

describe('parseRoute', () => {
  it('reads the spending page', () => {
    expect(parseRoute('#/spending')).toEqual({ view: 'spending' })
    expect(routeHref({ view: 'spending' })).toBe('#/spending')
  })

  it('reads a part', () => {
    expect(parseRoute('#/parts/act2')).toEqual({ view: 'part', part: 'act2' })
  })

  it('reads a part’s lines', () => {
    expect(parseRoute('#/parts/act1/lines')).toEqual({ view: 'lines', part: 'act1' })
    expect(routeHref({ view: 'lines', part: 'act1' })).toBe('#/parts/act1/lines')
  })

  it('reads a character’s audition', () => {
    expect(parseRoute('#/characters/narrator-act2/audition')).toEqual({
      view: 'audition',
      character: 'narrator-act2',
    })
    expect(routeHref({ view: 'audition', character: 'old mira' })).toBe(
      '#/characters/old%20mira/audition',
    )
  })

  it('reads a character’s page', () => {
    expect(parseRoute('#/characters/old%20mira')).toEqual({
      view: 'character',
      character: 'old mira',
    })
    expect(routeHref({ view: 'character', character: 'old mira' })).toBe('#/characters/old%20mira')
  })

  it('reads the setup page', () => {
    expect(parseRoute('#/setup')).toEqual({ view: 'setup' })
    expect(routeHref({ view: 'setup' })).toBe('#/setup')
  })

  it('reads the characters view', () => {
    expect(parseRoute('#/characters')).toEqual({ view: 'characters' })
  })

  it('reads the changes view, and writes it back', () => {
    expect(parseRoute('#/changes')).toEqual({ view: 'changes' })
    expect(routeHref({ view: 'changes' })).toBe('#/changes')
  })

  it('falls back to the default part', () => {
    expect(parseRoute('')).toEqual({ view: 'part', part: null })
    expect(parseRoute('#/nonsense')).toEqual({ view: 'part', part: null })
  })

  it('round-trips with routeHref', () => {
    expect(parseRoute(routeHref({ view: 'part', part: 'act1' }))).toEqual({
      view: 'part',
      part: 'act1',
    })
  })
})

describe('the language in a route', () => {
  it('is kept in the hash on a part and on its lines', () => {
    expect(parseRoute('#/parts/act1/lines?language=sv')).toEqual({
      view: 'lines',
      part: 'act1',
      language: 'sv',
    })
    expect(parseRoute('#/parts/act1?language=sv')).toEqual({
      view: 'part',
      part: 'act1',
      language: 'sv',
    })
    expect(routeHref({ view: 'lines', part: 'act1', language: 'sv' })).toBe(
      '#/parts/act1/lines?language=sv',
    )
    expect(routeHref({ view: 'part', part: 'act1', language: 'sv' })).toBe(
      '#/parts/act1?language=sv',
    )
  })

  it('is left out when there is none', () => {
    expect(parseRoute('#/parts/act1/lines')).toEqual({ view: 'lines', part: 'act1' })
    expect(routeHref({ view: 'lines', part: 'act1' })).toBe('#/parts/act1/lines')
  })
})

describe('the Music pages in the address', () => {
  it('opens Music, an act’s loops and the stingers', () => {
    expect(parseRoute('#/music')).toEqual({ view: 'music', page: null })
    expect(parseRoute('#/music/parts/act2')).toEqual({ view: 'music', page: 'act', part: 'act2' })
    expect(parseRoute('#/music/stingers')).toEqual({ view: 'music', page: 'stingers' })
    expect(parseRoute('#/music/tracks/game-over')).toEqual({
      view: 'music',
      page: 'track',
      track: 'game-over',
    })
    expect(routeHref({ view: 'music', page: 'track', track: 'game-over' })).toBe(
      '#/music/tracks/game-over',
    )
    expect(routeHref({ view: 'music', page: null })).toBe('#/music')
    expect(routeHref({ view: 'music', page: 'act', part: 'act 2' })).toBe('#/music/parts/act%202')
    expect(routeHref({ view: 'music', page: 'stingers' })).toBe('#/music/stingers')
  })

  it('tells an act called stingers from the stingers', () => {
    expect(parseRoute('#/music/parts/stingers')).toEqual({
      view: 'music',
      page: 'act',
      part: 'stingers',
    })
  })
})

describe('a list of what needs attention in the address', () => {
  it('is read and written for a music act, the stingers and an images act', () => {
    const routes = [
      { view: 'music', page: 'act', part: 'act1', show: 'attention' },
      { view: 'music', page: 'stingers', show: 'attention' },
      { view: 'images', page: 'act', part: 'act1', show: 'attention' },
    ] as const
    for (const route of routes) expect(parseRoute(routeHref(route))).toEqual(route)
    expect(routeHref(routes[0])).toBe('#/music/parts/act1?show=attention')
    expect(routeHref(routes[1])).toBe('#/music/stingers?show=attention')
    expect(routeHref(routes[2])).toBe('#/images/parts/act1?show=attention')
  })

  it('is left out when the whole list is shown, as before', () => {
    expect(parseRoute('#/music/parts/act1')).toEqual({ view: 'music', page: 'act', part: 'act1' })
    expect(routeHref({ view: 'images', page: 'act', part: 'act1' })).toBe('#/images/parts/act1')
  })
})

describe('the sound effects routes', () => {
  it('is read and written for the list, the list of what needs attention, and an effect', () => {
    const routes = [
      { view: 'effects', page: null },
      { view: 'effects', page: null, show: 'attention' },
      { view: 'effects', page: 'effect', effect: 'door-creak' },
    ] as const
    for (const route of routes) expect(parseRoute(routeHref(route))).toEqual(route)
    expect(routeHref(routes[0])).toBe('#/effects')
    expect(routeHref(routes[1])).toBe('#/effects?show=attention')
    expect(routeHref(routes[2])).toBe('#/effects/items/door-creak')
  })
})

describe('the Scenes routes', () => {
  it('round-trip the first act, an act and its open scene', () => {
    const routes = [
      { view: 'scenes', page: null },
      { view: 'scenes', page: 'act', part: 'act1' },
      { view: 'scenes', page: 'act', part: 'act1', scene: 'act1-general-store' },
    ] as const
    expect(routes.map((r) => routeHref(r))).toEqual([
      '#/scenes',
      '#/scenes/parts/act1',
      '#/scenes/parts/act1?scene=act1-general-store',
    ])
    for (const route of routes) expect(parseRoute(routeHref(route))).toEqual(route)
  })
})

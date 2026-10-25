import { describe, expect, it } from 'bun:test'
import { parseRoute, routeHref } from './route'

describe('a character’s language in the address', () => {
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

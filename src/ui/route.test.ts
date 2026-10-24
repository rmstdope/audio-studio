import { describe, expect, it } from 'bun:test'
import { parseRoute, routeHref } from './route'

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

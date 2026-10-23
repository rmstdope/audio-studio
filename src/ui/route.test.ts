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

  it('reads the characters view', () => {
    expect(parseRoute('#/characters')).toEqual({ view: 'characters' })
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

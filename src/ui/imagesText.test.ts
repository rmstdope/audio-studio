import { describe, expect, it } from 'bun:test'
import { chosenLine, outOfDateText, paletteText, styleNoticeText } from './imagesText'
import { parseRoute, routeHref } from './route'
import { openWorkspace } from './sidebarActs'

describe('the images words', () => {
  it('says how many are chosen', () => {
    expect(chosenLine('Act I', 4, 1)).toBe('The images the game asks for in Act I. 1 of 4 chosen.')
  })
  it('names what an out-of-date image changed, joined with "and"', () => {
    expect(outOfDateText(['the words'])).toBe('Out of date since it was chosen: the words.')
    expect(outOfDateText(['the words', 'the size'])).toBe(
      'Out of date since it was chosen: the words and the size.',
    )
    expect(outOfDateText(['the words', 'the size', 'the style'])).toBe(
      'Out of date since it was chosen: the words, the size and the style.',
    )
  })
  it('counts the palette', () => {
    expect(paletteText(16)).toBe('16 colours · set by the game')
    expect(paletteText(1)).toBe('1 colour · set by the game')
  })
  it('words the style notice for one image and for several', () => {
    expect(styleNoticeText(3)).toBe(
      '3 chosen images across all acts were made with the old style and are out of date. The game shows them until you choose new ones.',
    )
    expect(styleNoticeText(1)).toBe(
      '1 chosen image across all acts was made with the old style and is out of date. The game shows it until you choose a new one.',
    )
  })
})

describe('the images routes', () => {
  it('round-trips each page', () => {
    for (const route of [
      { view: 'images', page: null },
      { view: 'images', page: 'act', part: 'act 1' },
      { view: 'images', page: 'style' },
      { view: 'images', page: 'image', image: 'silver-stag-inn' },
    ] as const) {
      expect(parseRoute(routeHref(route))).toEqual(route)
    }
  })
  it('opens the images workspace in the sidebar', () => {
    expect(openWorkspace({ view: 'images', page: 'style' })).toBe('images')
  })
})

import { describe, expect, it } from 'bun:test'
import {
  bringFailureText,
  bringingText,
  chosenLine,
  disagreeText,
  listSeparator,
  joined,
  lookNoticeText,
  lookZoom,
  makeTakesText,
  modelCaption,
  outOfDateText,
  paletteText,
  styleNoticeText,
  takeCountText,
  unchooseNote,
} from './imagesText'
import { parseRoute, routeHref } from './route'
import { openWorkspace } from './sidebarActs'

describe('the images words', () => {
  it('says how many are chosen', () => {
    expect(chosenLine('Act I', 4, 1)).toBe('The images the game asks for in Act I. 1 of 4 chosen.')
  })
  it('names what an out-of-date image changed, joined with "and"', () => {
    expect(outOfDateText(['the words'], 'Act I')).toBe(
      'Out of date since it was chosen: the words.',
    )
    expect(outOfDateText(['the words', 'the size'], 'Act I')).toBe(
      'Out of date since it was chosen: the words and the size.',
    )
    expect(outOfDateText(['the words', 'the size', 'the style'], 'Act I')).toBe(
      'Out of date since it was chosen: the words, the size and the style.',
    )
  })
  it('names the act’s style with the act’s name', () => {
    expect(outOfDateText(['the words', 'the act style'], 'Act IV')).toBe(
      "Out of date since it was chosen: the words and Act IV's style.",
    )
  })
  it('joins what changed with and', () => {
    expect(joined(['the look', 'the palette', 'the addition for Act II'])).toBe(
      'the look, the palette and the addition for Act II',
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

describe('the image takes words', () => {
  it('counts takes in the menu', () => {
    expect([1, 2, 4].map(takeCountText)).toEqual(['1 take', '2 takes', '4 takes'])
  })
  it('names the make button after the count, and says "more" once there are takes', () => {
    expect(makeTakesText(2, false)).toBe('Make 2 takes')
    expect(makeTakesText(2, true)).toBe('Make 2 more takes')
    expect(makeTakesText(1, true)).toBe('Make 1 more take')
  })
  it('asks what un-choosing does', () => {
    expect(unchooseNote(2)).toBe(
      'The game shows no image here until you choose another. Take 2 stays among the takes.',
    )
  })
})

describe('the game’s look words', () => {
  it('zooms by the largest whole number at which both pictures fit side by side', () => {
    expect(lookZoom(1000, 10, 320)).toEqual({ zoom: 1, stacked: false })
    expect(lookZoom(1380, 10, 320)).toEqual({ zoom: 2, stacked: false })
    expect(lookZoom(2000, 10, 320)).toEqual({ zoom: 3, stacked: false })
    expect(lookZoom(650, 10, 320)).toEqual({ zoom: 1, stacked: false })
  })
  it('stacks them in a window too narrow for side by side, each at the largest whole number', () => {
    expect(lookZoom(640, 10, 320)).toEqual({ zoom: 2, stacked: true })
    expect(lookZoom(300, 10, 320)).toEqual({ zoom: 1, stacked: true })
    expect(lookZoom(0, 10, 320)).toEqual({ zoom: 1, stacked: false })
  })
  it('captions the model’s picture, adding that it is cropped', () => {
    expect(modelCaption(1280, 720, false)).toBe('1280 × 720')
    expect(modelCaption(1024, 1024, true)).toBe('1024 × 1024 · cropped to fit')
  })
  it('words the notices as agreed', () => {
    expect(lookNoticeText(14, ['its palette'])).toEqual({
      head: "The game's look changed",
      what: ' (its palette)',
      rest: '14 images and their takes still have the old look. Nothing needs making again.',
    })
    expect(lookNoticeText(1, ['its palette', 'its dithering']).rest).toBe(
      '1 image and its takes still have the old look. Nothing needs making again.',
    )
    expect(bringingText(6, 14)).toBe('Bringing images to the new look… 6 of 14')
    expect(bringFailureText(14, Array(5).fill({ reason: 'missing' }))).toEqual({
      head: 'Brought 9 of 14 images to the new look.',
      rest: "5 couldn't be: the model's picture for each is missing. Their old look stays until you make new takes.",
    })
  })
})

describe('the words of an image several acts list', () => {
  it('joins the names the way the lists do', () => {
    expect([0, 1, 2].map((i) => listSeparator(i, 3))).toEqual(['', ', ', ' and '])
    expect([0, 1].map((i) => listSeparator(i, 2))).toEqual(['', ' and '])
  })
  it('names the act style change when a picture is out of date because of it', () => {
    const change = (now: string | null, was: string | null) => ({ now, was })
    expect(outOfDateText(['the act style'], 'Act I', change('Act III', 'Act I'))).toBe(
      "Out of date since it was chosen: Act III's style instead of Act I's.",
    )
    expect(outOfDateText(['the act style'], 'Act I', change(null, 'Act I'))).toBe(
      "Out of date since it was chosen: Act I's style left out.",
    )
    expect(outOfDateText(['the words', 'the act style'], 'Act I', change('Act III', null))).toBe(
      "Out of date since it was chosen: the words and Act III's style.",
    )
  })
  it('says what the lists disagree about', () => {
    expect(disagreeText(['Act I', 'Act III'], ['words'])).toBe(
      "The game's lists disagree about this image: Act I and Act III give it different words. Fix them in the game, then Refresh from the game.",
    )
    expect(disagreeText(['Act I', 'Act III', 'Act V'], ['words', 'sizes'])).toContain(
      'Act I, Act III and Act V give it different words and sizes.',
    )
    expect(disagreeText(['Act I', 'Act III'], ['names'])).toContain('give it different names.')
  })
  it('keeps the act an image was opened from in its address', () => {
    expect(routeHref({ view: 'images', page: 'image', image: 'inn', from: 'act3' })).toBe(
      '#/images/items/inn?from=act3',
    )
    expect(parseRoute('#/images/items/inn?from=act3')).toEqual({
      view: 'images',
      page: 'image',
      image: 'inn',
      from: 'act3',
    })
    expect(parseRoute('#/images/items/inn')).toEqual({
      view: 'images',
      page: 'image',
      image: 'inn',
    })
  })
})

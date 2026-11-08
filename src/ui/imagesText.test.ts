import { describe, expect, it } from 'bun:test'
import {
  bringFailureText,
  bringingText,
  chosenLine,
  areasCountText,
  areasToPlaceText,
  disagreeText,
  listSeparator,
  joined,
  lookNoticeText,
  lookZoom,
  makeTakesText,
  pictureRendering,
  modelCaption,
  outOfDateText,
  paletteText,
  takeCountText,
  unchooseNote,
  makeAgainActLine,
  overlapActLine,
  overlapHeading,
  overlapOpenLine,
  overlapPairLine,
  makeAgainOpenLine,
  setAsideDim,
  setAsideDropSentence,
  setAsideSentence,
  setAsideTitle,
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
    expect(paletteText(16)).toBe('16 colours')
    expect(paletteText(1)).toBe('1 colour')
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
  it('shrinks them side by side to fit when not even the game’s size fits, down to half', () => {
    expect(lookZoom(890, 14, 640)).toEqual({ zoom: 0.68, stacked: false })
    expect(lookZoom(890, 14, 480)).toEqual({ zoom: 0.91, stacked: false })
    expect(lookZoom(640, 10, 320)).toEqual({ zoom: 0.98, stacked: false })
    expect(lookZoom(0, 10, 320)).toEqual({ zoom: 1, stacked: false })
  })
  it('stacks them, each fitted to the width, when side by side they would be under half size', () => {
    expect(lookZoom(300, 10, 320)).toEqual({ zoom: 0.93, stacked: true })
    expect(lookZoom(600, 10, 640)).toEqual({ zoom: 0.93, stacked: true })
  })
  it('never shrinks a picture away to nothing while the stage is still being laid out', () => {
    expect(lookZoom(5, 14, 640)).toEqual({ zoom: 0.1, stacked: true })
  })
  it('draws a shrunk picture smooth, and one at a whole size with hard pixels', () => {
    expect(pictureRendering(0.68)).toBe('auto')
    expect(pictureRendering(1)).toBe('pixelated')
    expect(pictureRendering(2)).toBe('pixelated')
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
    expect(
      bringFailureText(3, [
        { reason: `the model's picture of its patch "Bread taken" is missing` },
      ]),
    ).toEqual({
      head: 'Brought 2 of 3 images to the new look.',
      rest: `1 couldn't be: the model's picture of its patch "Bread taken" is missing. Its old look stays until you make new takes.`,
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
  it('says named areas among the things the lists disagree about', () => {
    expect(disagreeText(['Act I', 'Act III'], ['words', 'named areas'])).toContain(
      'give it different words and named areas.',
    )
  })
  it('counts the named areas placed and left to place', () => {
    expect(areasCountText(1, 5)).toBe('1 of 5 placed')
    expect(areasToPlaceText(4, 5)).toBe('4 of 5 areas to place')
    expect(areasToPlaceText(1, 1)).toBe('1 of 1 area to place')
    expect(areasToPlaceText(0, 5)).toBeNull()
    expect(areasToPlaceText(0, 0)).toBeNull()
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

describe('the questions about patches set aside', () => {
  it('counts the patches and says what the game does', () => {
    expect(setAsideSentence(2, 3)).toBe(
      '3 chosen patches were made on take 2. The game will stop showing them until you make new ones.',
    )
    expect(setAsideSentence(2, 1)).toBe(
      '1 chosen patch was made on take 2. The game will stop showing it until you make a new one.',
    )
  })
  it('says how to bring them back, and what comes back with the take chosen', () => {
    const q = (leaving: string[], to: number | null, returning: string[]) => ({
      from: 2,
      leaving,
      to,
      returning,
    })
    expect(setAsideDim(q(['A', 'B', 'C'], 4, []))).toBe(
      'Choosing take 2 again brings them all back.',
    )
    expect(setAsideDim(q(['A'], null, []))).toBe('Choosing take 2 again brings it back.')
    expect(setAsideDim(q(['Bread taken'], 1, ['Door open', 'Lamp lit']))).toBe(
      '2 patches made on take 1 come back: Door open, Lamp lit. Choosing take 2 again brings Bread taken back.',
    )
    expect(setAsideDim(q(['Bread taken', 'Well'], 1, ['Door open']))).toBe(
      '1 patch made on take 1 comes back: Door open. Choosing take 2 again brings Bread taken and Well back.',
    )
  })
  it('titles the questions', () => {
    expect(setAsideTitle({ kind: 'choose', n: 4 }, 2)).toBe('Choose take 4?')
    expect(setAsideTitle({ kind: 'drop', n: 2 }, 2)).toBe('Drop take 2?')
    expect(setAsideTitle({ kind: 'unchoose' }, 2)).toBe('Un-choose take 2?')
  })
  it('says a drop cannot be taken back', () => {
    expect(setAsideDropSentence(2, 3)).toBe(
      '3 chosen patches were made on take 2. After this they cannot be brought back; only new ones can be made.',
    )
    expect(setAsideDropSentence(2, 1)).toBe(
      '1 chosen patch was made on take 2. After this it cannot be brought back; only a new one can be made.',
    )
  })
})

describe('the marks of a patch to make again', () => {
  it('names them on the act’s row', () => {
    expect(makeAgainActLine(['Bread taken', 'Door open'])).toBe(
      'make again: Bread taken, Door open',
    )
  })
  it('says where the patch was chosen and how to get it back', () => {
    expect(makeAgainOpenLine([2], 4)).toBe(
      'Chosen on take 2 of the image, so the game does not show it now. Make a new one here, or choose take 2 again to bring it back.',
    )
    expect(makeAgainOpenLine([1, 2], 4)).toBe(
      'Chosen on takes 1 and 2 of the image, so the game does not show it now. Make a new one here, or choose one of those takes again to bring it back.',
    )
    expect(makeAgainOpenLine([2], null)).toBe(
      'Chosen on take 2 of the image, so the game does not show it now. Choose take 2 again to bring it back.',
    )
    expect(makeAgainOpenLine([1, 2], null)).toBe(
      'Chosen on takes 1 and 2 of the image, so the game does not show it now. Choose one of those takes again to bring it back.',
    )
    expect(makeAgainOpenLine([], 4)).toBe(
      'Chosen on an earlier take of the image, so the game does not show it now. Make a new one here.',
    )
  })
})

describe('overlapping patches', () => {
  const pairs: [string, string][] = [
    ['Bread taken', 'Door ajar'],
    ['Bread taken', 'Fire out'],
    ['Door ajar', 'Fire out'],
  ]
  it('says one overlap in its heading and several in a shorter one', () => {
    expect(overlapHeading(pairs.slice(0, 1))).toBe(
      'Two chosen patches overlap: Bread taken and Door ajar.',
    )
    expect(overlapHeading(pairs)).toBe('Some chosen patches overlap.')
  })
  it('writes a pair, and an open patch’s line naming what it overlaps', () => {
    expect(overlapPairLine(pairs[1]!)).toBe('Bread taken and Fire out')
    expect(overlapOpenLine(['Door ajar'])).toBe('The chosen take overlaps Door ajar.')
    expect(overlapOpenLine(['Door ajar', 'Fire out'])).toBe(
      'The chosen take overlaps Door ajar and Fire out.',
    )
    expect(overlapOpenLine(['Door ajar', 'Fire out', 'Lamp lit'])).toBe(
      'The chosen take overlaps Door ajar, Fire out and Lamp lit.',
    )
  })
  it('writes the act row’s line with the pairs separated by semicolons', () => {
    expect(overlapActLine(pairs.slice(0, 1))).toBe('patches overlap: Bread taken and Door ajar')
    expect(overlapActLine(pairs)).toBe(
      'patches overlap: Bread taken and Door ajar; Bread taken and Fire out; Door ajar and Fire out',
    )
  })
})

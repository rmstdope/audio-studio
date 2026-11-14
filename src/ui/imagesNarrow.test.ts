import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The body of the first rule for `selector` in `from`, or nothing when there is none. */
const rule = (selector: string, from = css) => {
  const at = from.indexOf(`${selector} {`)
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at))
}

describe('the images list in a narrow window', () => {
  it('drops the table’s minimum width, or each card is wider than the window and its status is off the edge', () => {
    const narrow = css.slice(css.indexOf('@container panel (max-width: 700px) {\n  .images-cmp'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    // The minimum width is dropped by the shared stack-table rule, which the table opts into.
    expect(css).toMatch(
      /\.stack-table,\n\s*\.stack-table tbody[^{]*\{\n\s*display: block;\n\s*min-width: 0;/,
    )
    expect(block).toContain('minmax(0, 1fr) auto')
  })
})

describe('the two sides of an image’s takes', () => {
  it('always sit side by side, each half the width, however narrow the window', () => {
    expect(rule('.image-stage')).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
    const narrow = css.slice(css.indexOf('@container panel (max-width: 1000px) {\n  .image-band'))
    expect(narrow.slice(0, narrow.indexOf('\n}\n'))).not.toContain('.image-stage')
  })
})

describe('the pictures on the stage', () => {
  it('are centred in their halves and drawn smooth', () => {
    expect(css).toMatch(
      /\.image-stage \.image-take-picture,\s*\.image-stage \.image-take-empty \{[^}]*margin-inline:\s*auto/,
    )
    expect(rule('.look-side')).toMatch(/align-items:\s*center/)
    expect(rule('.image-stage .image-take-picture')).toMatch(/image-rendering:\s*auto/)
  })
})

describe('an image’s workbench', () => {
  it('is a column: the band, a Make takes box of 360 px beside Prompt, the stage, the strip', () => {
    expect(rule('.image-workbench')).toMatch(/flex-direction:\s*column/)
    expect(rule('.image-band')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 360px/)
    // The page scrolls for the pictures: the frame takes no height of the window's.
    expect(rule('.image-workbench')).not.toMatch(/height/)
    expect(rule('.image-stage-panel')).not.toMatch(/overflow/)
    expect(rule('.image-thumbs')).toMatch(/overflow-x:\s*auto/)
  })

  it('puts Prompt above Make takes in a narrow window', () => {
    const narrow = css.slice(css.indexOf('@container panel (max-width: 1000px) {\n  .image-band'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(rule('.image-band', block)).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
  })
})

describe('the Patches workbench frame (as-uucl.3)', () => {
  it('stands the band, the picture and the takes one above the other, as wide as the panel', () => {
    expect(rule('.patch-bench')).toMatch(/flex-direction:\s*column/)
    expect(rule('.patch-band')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto/)
  })

  it('holds the picture to its width and never to the window’s height', () => {
    const box = rule('.patch-picture')
    expect(box).toMatch(/width:\s*100%/)
    expect(box).not.toMatch(/vh|cqh|height:/)
    expect(css).not.toMatch(/\.patch-bench[^{]*\{[^}]*--fill-height/)
  })

  it('pushes Patch off, Drop and Choose to the right end of the take’s row', () => {
    expect(rule('.patch-row .patch-controls')).toMatch(/margin-left:\s*auto/)
  })
})

describe('the Patches tab in a narrow window', () => {
  it('puts the list, the stage and the tools one above the other', () => {
    const narrow = css.slice(css.indexOf('@container panel (max-width: 700px) {\n  .patch-band,'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(block).toMatch(/\.patches-lefty/)
    expect(block).toMatch(/\.patch-band/)
    expect(block).toMatch(/grid-template-columns:\s*1fr/)
  })

  it('wraps the chips, and lets the list scroll inside itself', () => {
    expect(rule('.patches-chips')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('.patches-list')).toMatch(/overflow-y:\s*auto/)
  })
})

describe('the named areas picture in a narrow window (as-5v0)', () => {
  const stacked = () => {
    const narrow = css.slice(
      css.indexOf('@container panel (max-width: 760px) {\n  .named-areas-body'),
    )
    return rule('.named-areas-picture', narrow.slice(0, narrow.indexOf('\n}\n')))
  }

  it('hides the list behind an opaque background, or its text prints through the line and switches', () => {
    expect(stacked()).toMatch(/background:\s*var\(--panel\)/)
  })

  it('is drawn in front of the list, and reaches the window’s top so no row shows above it', () => {
    expect(stacked()).toMatch(/z-index:\s*1;/)
    expect(stacked()).toMatch(/top:\s*0;/)
  })

  it('leaves the picture’s position alone once stacked, so it stays held in view as agreed', () => {
    expect(stacked()).not.toMatch(/position:/)
  })
})

describe('a named areas picture taller than a narrow window (as-e39)', () => {
  it('is capped by the window’s height, keeping its shape, or it hides every row held in front of them', () => {
    const narrow = css.slice(
      css.indexOf('@container panel (max-width: 760px) {\n  .named-areas-body'),
    )
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(block).toMatch(
      /\.named-area-stage,\s*\.named-area-empty\s*\{[^}]*width:\s*min\(100%, calc\(50vh \* var\(--picture-ratio\)\)\)/,
    )
  })
})

describe('the list beside the named areas picture (as-kw3x.6)', () => {
  const narrow = css.slice(
    css.indexOf('@container panel (max-width: 760px) {\n  .named-areas-body'),
  )
  const block = narrow.slice(0, narrow.indexOf('\n}\n'))

  it('is never taller than the picture, and scrolls inside itself', () => {
    expect(rule('.named-areas-side')).toMatch(/contain:\s*size/)
    expect(rule('.named-areas-side')).toMatch(/align-self:\s*stretch/)
    expect(rule('.named-area-list')).toMatch(/overflow-y:\s*auto/)
    expect(rule('.named-area-list')).toMatch(/flex:\s*1 1 0/)
    // Never squeezed away by a wide, short picture: a few rows stay in reach.
    expect(rule('.named-area-list')).toMatch(/min-height:\s*7rem/)
  })

  it('takes the height of its rows once stacked under the picture, capped by the window', () => {
    expect(rule('.named-areas-side', block)).toMatch(/contain:\s*none/)
    expect(rule('.named-area-list', block)).toMatch(/max-height:\s*50vh/)
  })
})

describe('the patch list beside a portrait image (as-sgou)', () => {
  it('makes each patch a box as wide as the list, whatever its name', () => {
    expect(rule('.patch-pick-row')).toMatch(/width:\s*100%/)
    expect(rule('.patch-pick-row')).toMatch(/box-sizing:\s*border-box/)
  })
})

describe('fitting a picture to the window (as-5wln)', () => {
  it('names no pixels of what else is on the page: no image rule subtracts a length from the window’s height', () => {
    // Every rule but the Scenes list's, which is no picture.
    const images = css.replace(/\.scene-list \{[^}]*\}/, '')
    expect(images).not.toMatch(/100d?vh\s*-\s*\d+px/)
  })

  it('sizes every fitted picture by the room its track gives it, in a wide window', () => {
    const wide = css.slice(css.indexOf('@container panel (min-width: 821px) {\n  .fit-picture'))
    const block = wide.slice(0, wide.indexOf('\n}\n'))
    expect(rule('.fit-picture', block)).toMatch(/container-type:\s*size/)
    expect(rule('.fit-shape', block)).toMatch(
      /width:\s*min\(100cqw, calc\(100cqh \* var\(--picture-ratio, 1\)\)\)/,
    )
  })

  it('gives the pages a frame as tall as the window below where it starts, the stage row taking what the rest leaves', () => {
    const wide = css.slice(css.indexOf('@container panel (min-width: 821px) {\n  .fit-picture'))
    const block = wide.slice(0, wide.indexOf('\n}\n'))
    expect(block).toMatch(/\.named-areas-body\s*\{[^}]*var\(--fill-height, 360px\)/)
  })

  it('caps a picture by half the window when nothing is fitted', () => {
    expect(rule('.fit-shape')).toMatch(
      /width:\s*min\(100%, calc\(50vh \* var\(--picture-ratio, 1\)\)\)/,
    )
  })
})

describe('the Fine-tune tab’s layout (as-uucl.2)', () => {
  it('is a column of the band, the bar, the picture and the strip, with no fitted frame', () => {
    expect(rule('.fine-job')).toMatch(/flex-direction:\s*column/)
    expect(css).not.toMatch(/\.fine-job\s*\{[^}]*--fill-height/)
    // The picture is as wide as the panel; its own pixel size is the max-width the page sets.
    expect(rule('.fine-picture')).toMatch(/width:\s*100%/)
    expect(rule('.fine-picture')).toMatch(/margin-inline:\s*auto/)
  })

  it('lays the history over the picture, about twelve lines tall, scrolling', () => {
    const pop = rule('.history-popover')
    expect(pop).toMatch(/position:\s*absolute/)
    expect(pop).toMatch(/max-height:\s*calc\(12 \* 1\.6em/)
    expect(pop).toMatch(/overflow-y:\s*auto/)
  })

  it('puts the words box across the full width in a narrow panel', () => {
    const narrow = css.slice(css.indexOf('@container panel (max-width: 820px) {\n  .fine-words'))
    expect(rule('.fine-words', narrow.slice(0, narrow.indexOf('\n}\n')))).toMatch(
      /flex-basis:\s*100%/,
    )
  })
})

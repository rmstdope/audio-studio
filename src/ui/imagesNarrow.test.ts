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
  it('sit side by side when both fit, and one above the other when the stage says they stack', () => {
    expect(rule(".image-stage[data-stacked='false']")).toMatch(
      /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    )
    expect(rule('.image-stage')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
  })
})

describe('an image’s workbench', () => {
  it('is a frame: the stage, the tools column of about 300 px, and the strip along the bottom', () => {
    expect(rule('.image-workbench')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 300px/)
    expect(rule('.image-workbench')).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\) auto/)
    // The window's height reaches the frame as where it starts (--fill-height), never as a sum of
    // what is above it.
    expect(rule('.image-workbench')).toMatch(/height:\s*max\(520px, var\(--fill-height, 520px\)\)/)
    expect(rule(".image-workbench > [data-area='strip']")).toMatch(/grid-column:\s*1 \/ -1/)
    expect(rule('.image-thumbs')).toMatch(/overflow-x:\s*auto/)
  })

  it('puts the columns one above the other in a narrow window', () => {
    const narrow = css.slice(
      css.indexOf('@container panel (max-width: 1000px) {\n  .image-workbench'),
    )
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(rule('.image-workbench', block)).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(rule('.image-workbench', block)).toMatch(/height:\s*auto/)
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
    expect(block).toMatch(/\.fine-job\s*\{[^}]*var\(--fill-height, 0px\)/)
    // `auto` as the least, not 0: a tall strip makes the page scroll instead of crushing the stage.
    expect(block).toMatch(/grid-template-rows:\s*minmax\(auto, 1fr\) auto/)
    expect(block).not.toMatch(/\.(fine-stage)\s*\{[^}]*min-height:\s*0/)
    expect(block).toMatch(/\.named-areas-body\s*\{[^}]*var\(--fill-height, 360px\)/)
  })

  it('lets the Patches and Fine-tune frames shrink to the window, and grow only to what their rows hold (as-3xtn)', () => {
    const wide = css.slice(css.indexOf('@container panel (min-width: 821px) {\n  .fit-picture'))
    const block = wide.slice(0, wide.indexOf('\n}\n'))
    const frame = rule('.fine-job', block)
    // The window's room is the least the frame is, never a fixed height with a pixel floor: a
    // 480 px floor kept the frame past a 763 px window's 413 px with the picture still able to
    // shrink, and a fixed height lets a tall takes strip draw past the panel.
    expect(frame).toMatch(/min-height:\s*var\(--fill-height, 0px\);/)
    expect(frame).not.toMatch(/(^|[\s;])height:/)
    // The tools take no room of their own, so the row is what the picture's track and the strip
    // leave, and they scroll inside it.
    expect(rule('.fine-tools', block)).toMatch(/contain:\s*size/)
  })

  it('caps a picture by half the window when nothing is fitted', () => {
    expect(rule('.fit-shape')).toMatch(
      /width:\s*min\(100%, calc\(50vh \* var\(--picture-ratio, 1\)\)\)/,
    )
  })
})

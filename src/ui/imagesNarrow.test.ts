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
    expect(rule('.image-workbench')).toMatch(/height:\s*max\(520px, calc\(100vh - 230px\)\)/)
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

describe('the Patches workbench frame', () => {
  it('puts the stage beside a 300 px tools column, the takes below both', () => {
    expect(rule('.game-patches .patch-bench')).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\) 300px/,
    )
    expect(rule('.game-patches .patch-bench > .patch-takes')).toMatch(/grid-column:\s*1 \/ -1/)
  })

  it('leaves the Fine-tune workbench its own two columns', () => {
    expect(rule('.patch-bench')).toMatch(
      /grid-template-columns:\s*minmax\(0, 3fr\) minmax\(0, 2fr\)/,
    )
  })
})

describe('the Patches tab in a narrow window', () => {
  it('puts the list, the stage and the tools one above the other', () => {
    const narrow = css.slice(css.indexOf('@container panel (max-width: 700px) {\n  .patch-bench,'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(block).toMatch(/\.patches-lefty/)
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

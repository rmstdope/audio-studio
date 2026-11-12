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
    const narrow = css.slice(css.indexOf('@media (max-width: 700px) {\n  .images-cmp'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(block).toMatch(/^\s*\.images-table\s*\{[^}]*min-width:\s*0/m)
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
    const narrow = css.slice(css.indexOf('@media (max-width: 1000px) {\n  .image-workbench'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(rule('.image-workbench', block)).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(rule('.image-workbench', block)).toMatch(/height:\s*auto/)
  })
})

describe('a patch row the game asks for (as-9b8)', () => {
  it('holds the chevron on the first line, and wraps only the words beside it', () => {
    expect(rule('.game-patch-row')).not.toMatch(/flex-wrap/)
    expect(rule('.game-patch-chev')).toMatch(/flex:\s*none/)
    expect(rule('.game-patch-words')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('.game-patch-words')).toMatch(/flex:\s*1/)
    expect(rule('.game-patch-words')).toMatch(/min-width:\s*0/)
  })
})

describe('the named areas picture in a narrow window (as-5v0)', () => {
  const stacked = () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 760px) {\n  .named-areas-body'))
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
    const narrow = css.slice(css.indexOf('@media (max-width: 760px) {\n  .named-areas-body'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(block).toMatch(
      /\.named-area-stage,\s*\.named-area-empty\s*\{[^}]*width:\s*min\(100%, calc\(50vh \* var\(--picture-ratio\)\)\)/,
    )
  })
})

describe('the Place again line above the named areas list (as-7dz)', () => {
  it('stays at the list, the picture’s spare height going to the list’s row', () => {
    expect(rule('.named-areas-body.has-place-again')).toMatch(/grid-template-rows:\s*auto 1fr/)
  })

  it('leaves the rows to their content once picture, line and list are stacked', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 760px) {\n  .named-areas-body'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(rule('.named-areas-body.has-place-again', block)).toMatch(/grid-template-rows:\s*none/)
  })
})

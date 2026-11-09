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
  it('puts the tools beside the pictures, both held in view, the takes scrolling on their own', () => {
    expect(rule('.image-workbench')).toMatch(
      /grid-template-columns:\s*minmax\(260px, 300px\) minmax\(0, 1fr\)/,
    )
    expect(rule('.image-workbench-tools')).toMatch(/position:\s*sticky/)
    expect(rule('.image-workbench-tools')).toMatch(/max-height:\s*calc\(100vh - 32px\)/)
    expect(rule('.image-stage-panel')).toMatch(/position:\s*sticky/)
    expect(rule('.image-thumbs')).toMatch(/overflow-y:\s*auto/)
  })

  it('puts the columns one above the other in a narrow window', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 1000px) {\n  .image-workbench'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(rule('.image-workbench', block)).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(block).toMatch(/position:\s*static/)
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
  it('scrolls with the page once stacked, or its line and switches are drawn over the list', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 760px) {\n  .named-areas-body'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n'))
    expect(rule('.named-areas-picture', block)).toMatch(/position:\s*static/)
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

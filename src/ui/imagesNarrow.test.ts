import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

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
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`)
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
    }
    expect(rule(".image-stage[data-stacked='false']")).toMatch(
      /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    )
    expect(rule('.image-stage')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/)
  })
})

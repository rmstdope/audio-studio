import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`, outside any media query. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(source)?.[1] ?? ''
}

// The lines table keeps a 760 px minimum inside a box that scrolls sideways, and a scene band spans
// the whole table, so in a narrow window its text must be held to the box's visible width.
describe('a scene band keeps its text in view in a narrow window', () => {
  it('measures the lines table box, so a band can size itself to what is visible', () => {
    expect(rule(css, '.table-box')).toContain('container-type: inline-size')
  })

  it('wraps the band within the visible width, less its padding, and keeps it there on scrolling', () => {
    const band = rule(css, '.scene-band td > *')
    expect(band).toContain('max-width: calc(100cqi - 24px)')
    expect(band).toContain('position: sticky')
    expect(band).toContain('left: 12px')
  })
})

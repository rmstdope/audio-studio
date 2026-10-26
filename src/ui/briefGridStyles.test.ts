import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`, outside any media query. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(source)?.[1] ?? ''
}

describe('the brief grid keeps labels level', () => {
  it('does not bottom-align the fields, which lifts a label above its neighbours when a tag wraps', () => {
    expect(rule(css, '.music-brief-grid')).not.toContain('align-items: end')
  })

  it('shares the head, input and message rows between fields on a wide screen', () => {
    const wide = /@media \(min-width: 701px\) \{([\s\S]*?\n)\}/.exec(
      css.slice(css.indexOf('.music-brief-grid')),
    )?.[1]
    expect(wide).toContain('.brief-field')
    expect(wide).toContain('grid-template-rows: subgrid')
    expect(wide).toContain('grid-row: span 3')
  })

  it('keeps the Kind chip as wide as its text now that its cell is a grid', () => {
    expect(rule(css, '.music-kind')).toContain('justify-self: start')
  })
})

describe("Setup's short-model line is a quiet note", () => {
  it('uses the faint colour and a small size, as the mockup shows', () => {
    const declarations = rule(css, '.mshort')
    expect(declarations).toContain('color: var(--faint)')
    expect(declarations).toMatch(/font-size: 1[0-3]px/)
  })
})

describe("a music take card's model line and length are quiet notes", () => {
  it('styles the faint and small spans inside a take card', () => {
    expect(rule(css, '.take .faint')).toContain('color: var(--faint)')
    expect(rule(css, '.take .small')).toMatch(/font-size: 1[0-3]px/)
  })
})

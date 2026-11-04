import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const rule = (selector: string, from = css) => {
  const at = from.indexOf(`${selector} {`)
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at))
}

describe('the Scenes sound effects table', () => {
  it('keeps every heading on one line, so the header row never grows while a scene plays', () => {
    expect(rule('.scene-effects .table th')).toMatch(/white-space:\s*nowrap/)
  })

  it('cuts a long effect name with an ellipsis and never cuts the mark beside it', () => {
    expect(rule('.scene-effect-name')).toMatch(/max-width:\s*20ch/)
    expect(rule('.scene-effect-name')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.scene-effect-name')).toMatch(/white-space:\s*nowrap/)
    expect(rule('.scene-effect-name')).toMatch(/min-width:\s*0/)
  })

  it('makes the effect cell as wide as name plus chip, so the chip never runs under the next column', () => {
    expect(rule('.scene-effect-name')).toMatch(/display:\s*inline-block/)
    expect(rule('.scene-effect-cell')).toMatch(/white-space:\s*nowrap/)
    expect(rule('.scene-effect-cell')).not.toMatch(/display:\s*flex/)
  })

  it('sizes the effect column to its content, so a short name beside a chip is never cut', () => {
    const wide = css.slice(0, css.indexOf('@media (max-width: 700px) {\n  .scenes-body'))
    const fixed = [...wide.matchAll(/([^{}]*\.scene-effect)\s*\{([^}]*)\}/g)].filter(([, , body]) =>
      /(^|[\s;])(min-|max-)?width:/.test(body ?? ''),
    )
    expect(fixed).toEqual([])
  })

  it('moves "every 4–9 s" whole under its menu rather than squeezing', () => {
    expect(rule('.scene-seconds')).toMatch(/white-space:\s*nowrap/)
  })

  it('lets the card in a narrow window use its grid column and cut the name only when it does not fit', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 700px) {\n  .scenes-body'))
    expect(rule('.scene-effects .table td.scene-effect', narrow)).toMatch(/min-width:\s*0/)
    const name = rule('.scene-effects .table .scene-effect-name', narrow)
    expect(rule('.scene-effects .table .scene-effect-cell', narrow)).toMatch(/display:\s*flex/)
    expect(name).toMatch(/flex:\s*0 1 auto/)
    expect(name).toMatch(/max-width:\s*none/)
  })
})

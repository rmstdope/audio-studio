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
    expect(rule('.scene-effect-name')).toMatch(/max-width:\s*12ch/)
    expect(rule('.scene-effect-name')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.scene-effect-name')).toMatch(/white-space:\s*nowrap/)
    expect(rule('.scene-effect-name')).not.toMatch(/min-width/)
  })

  it('drops the chip whole under the name when the column is short of room, never under the next column', () => {
    expect(rule('.scene-effect-name')).toMatch(/display:\s*inline-block/)
    expect(rule('.scene-effect-name')).not.toMatch(/margin/)
    expect(rule('\n.scene-effect-name:has(+ .chip)')).toMatch(/margin-right:\s*8px/)
    const wide = css.slice(0, css.indexOf('@media (max-width: 700px) {\n  .scenes-body'))
    const cellRules = [...wide.matchAll(/([^{}]*\.scene-effect-cell[^{}]*)\{([^}]*)\}/g)].filter(
      ([, selector]) => !/\.chip/.test(selector ?? ''),
    )
    expect(cellRules.filter(([, , body]) => /nowrap|display:\s*flex/.test(body ?? ''))).toEqual([])
    const nowrapped = [...wide.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter(
      ([, selector, body]) =>
        /\.scene-effect(-cell)?\s*$/m.test((selector ?? '').trim().split(',').pop() ?? '') &&
        /white-space:\s*nowrap/.test(body ?? ''),
    )
    expect(nowrapped).toEqual([])
    expect(rule('\n.scene-effect-cell .chip')).toMatch(/display:\s*inline-block/)
    expect(wide).toMatch(
      /\.scene-effect \.chip,\n\.scene-how \.chip,\n\.scene-state \.chip \{\n  white-space:\s*nowrap/,
    )
    expect(css).not.toMatch(/\.scene-effect \.chip[,\s][^{]*\{[^}]*margin-left:\s*8px/)
  })

  it('gives each cell 6 px on either side, so the table fits its panel at 1300 px', () => {
    const cells = rule('.scene-effects .table th,\n.scene-effects .table td')
    expect(cells).toMatch(/padding-left:\s*6px/)
    expect(cells).toMatch(/padding-right:\s*6px/)
  })

  it('lets the Level slider shrink to 48 px when short of room, and no wider than 110 px', () => {
    const slider = rule('.scene-level-cell .scene-slider input')
    expect(slider).toMatch(/width:\s*100%/)
    expect(slider).toMatch(/min-width:\s*48px/)
    expect(slider).toMatch(/max-width:\s*110px/)
    expect(rule('.scene-level-cell .scene-slider')).toMatch(/width:\s*100%/)
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

  it('shows each effect as a card whenever the panel is too narrow for the table, not only in a narrow window', () => {
    expect(rule('.scene-effects')).toMatch(/container-type:\s*inline-size/)
    expect(rule('.scene-effects')).toMatch(/container-name:\s*scene-effects/)
    const at = css.indexOf('@container scene-effects (max-width: 700px) {')
    expect(at).toBeGreaterThan(-1)
    const cards = css.slice(at, css.indexOf('\n}\n', at))
    expect(rule('.scene-effects .table tr', cards)).toMatch(/display:\s*grid/)
    expect(rule('.scene-effects .table thead', cards)).toMatch(/display:\s*none/)
    const narrow = css.slice(css.indexOf('@media (max-width: 700px) {\n  .scenes-body'))
    expect(narrow.slice(0, narrow.indexOf('\n}\n'))).not.toContain('.scene-effects .table')
  })

  it('lets the card use its grid column and cut the name only when it does not fit', () => {
    const at = css.indexOf('@container scene-effects (max-width: 700px) {')
    const cards = css.slice(at, css.indexOf('\n}\n', at))
    expect(rule('.scene-effects .table td', cards)).toMatch(/padding:\s*0/)
    expect(rule('.scene-effects .table td.scene-effect', cards)).toMatch(/min-width:\s*0/)
    const name = rule('.scene-effects .table .scene-effect-name', cards)
    expect(rule('.scene-effects .table .scene-effect-cell', cards)).toMatch(/display:\s*flex/)
    expect(name).toMatch(/min-width:\s*0/)
    expect(name).toMatch(/flex:\s*0 1 auto/)
    expect(name).toMatch(/max-width:\s*none/)
    expect(rule('.scene-effects .table .scene-effect-cell .chip', cards)).toMatch(
      /margin-left:\s*8px/,
    )
    expect(rule('.scene-effects .table .scene-effect-name:has(+ .chip)', cards)).toMatch(
      /margin-right:\s*0/,
    )
  })
})

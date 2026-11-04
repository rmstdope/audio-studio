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

  it('gives the Now column 11em, not 14em, so the effect names keep their room', () => {
    expect(rule('.scene-effects th.scene-now-head')).toMatch(/width:\s*11em/)
  })

  it('cuts a long effect name with an ellipsis and never cuts the mark beside it', () => {
    expect(rule('.scene-effect')).toMatch(/max-width:\s*0/)
    expect(rule('.scene-effect-name')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.scene-effect-name')).toMatch(/white-space:\s*nowrap/)
    expect(rule('.scene-effect-name')).toMatch(/min-width:\s*0/)
    expect(rule('.scene-effect-cell')).toMatch(/display:\s*flex/)
    expect(rule('.scene-effect-cell .chip')).toMatch(/flex:\s*none/)
  })

  it('moves "every 4–9 s" whole under its menu rather than squeezing', () => {
    expect(rule('.scene-seconds')).toMatch(/white-space:\s*nowrap/)
  })

  it('lets the card in a narrow window use its grid column and still cut the name', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 700px) {\n  .scenes-body'))
    const block = rule('.scene-effects .table td.scene-effect', narrow)
    expect(block).toMatch(/max-width:\s*none/)
    expect(block).toMatch(/width:\s*auto/)
  })
})

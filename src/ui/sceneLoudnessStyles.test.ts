import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The body of the Scenes page's narrow-window block, the one that stacks the scene list. */
function narrow(): string {
  const from = css.indexOf('@container panel (max-width: 700px) {\n  .scenes-body')
  return from < 0 ? '' : css.slice(from, css.indexOf('\n}\n', from))
}

/** The declarations of `selector` inside `from`, empty when no rule names it. */
function rule(selector: string, from: string): string {
  const at = from.indexOf(`${selector} {`)
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at))
}

// as-snr: the header only wrapped when the row no longer fitted, so at 520 and 600 px Measure
// loudness stayed beside the heading and its target, where the agreed narrow state puts it below.
describe("the Loudness panel's header in a narrow window", () => {
  it('stacks the heading and its target line, then the button below them, on the left', () => {
    const head = rule('.scene-loud-head', narrow())
    expect(head).toMatch(/flex-direction:\s*column/)
    expect(head).toMatch(/align-items:\s*flex-start/)
    // The mockup's 10 px gap and the button's 6 px margin above it.
    expect(head).toMatch(/row-gap:\s*16px/)
  })

  it('leaves the table alone, so it keeps its three columns', () => {
    expect(narrow()).toContain('.scene-list')
    expect(narrow()).not.toContain('.scene-loud-table')
  })
})

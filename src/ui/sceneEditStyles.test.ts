import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`, outside any media query. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(source)?.[1] ?? ''
}

describe('the scene editor’s styles', () => {
  it('draws a bad seconds box and its line in the danger colour', () => {
    expect(rule(css, '.scene-num.scene-bad')).toContain('var(--danger-ink)')
    expect(rule(css, '.scene-error')).toContain('var(--danger-ink)')
    expect(rule(css, '.scene-status-red')).toContain('var(--danger-ink)')
  })

  it('draws a gone value’s closed face in red', () => {
    expect(rule(css, '.menu-button.menu-gone')).toContain('var(--danger-ink)')
  })

  it('uses tokens, not colours, in the editor’s rules', () => {
    const editor = css.slice(
      css.indexOf('.scene-status {'),
      css.indexOf('@media (max-width: 700px)', css.indexOf('.scene-status {')),
    )
    expect(editor).not.toMatch(/#[0-9a-f]{3,6}\b/i)
  })

  it('lets the conflict panel’s buttons wrap in a narrow window', () => {
    expect(rule(css, '.confirm-actions')).toContain('flex-wrap: wrap')
  })

  it('stacks each effect as a card in a narrow window, the red line under its box', () => {
    const narrow = css.slice(
      css.indexOf('@media (max-width: 700px)', css.indexOf('.scenes-body {')),
    )
    expect(narrow).toContain('.scene-effects .table tr {')
    expect(narrow).toContain('.scene-effects .table td.scene-how')
  })
})

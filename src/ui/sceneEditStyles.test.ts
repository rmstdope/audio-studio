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

  it('keeps the gone mark whole, dropping it under its menu rather than breaking it', () => {
    expect(css).toMatch(/\.scene-how \.chip,\n\.scene-state \.chip \{[^}]*white-space: nowrap/)
  })

  it('uses tokens, not colours, in the editor’s rules', () => {
    const editor = css.slice(
      css.indexOf('.scene-status {'),
      css.indexOf('@container panel (max-width: 700px)', css.indexOf('.scene-status {')),
    )
    expect(editor).not.toMatch(/#[0-9a-f]{3,6}\b/i)
  })

  it('lets the conflict panel’s buttons wrap in a narrow window', () => {
    expect(rule(css, '.confirm-actions')).toContain('flex-wrap: wrap')
  })

  it('stacks each effect as a card in a narrow window, the red line under its box', () => {
    const narrow = css.slice(
      css.indexOf('@container panel (max-width: 700px)', css.indexOf('.scenes-body {')),
    )
    expect(narrow).toContain('.scene-effects .table tr {')
    expect(narrow).toContain('.scene-effects .table td.scene-how')
  })

  it('draws M on in red and S on in yellow, and the sounding row green', () => {
    expect(rule(css, '.scene-ms-mute.on')).toContain('var(--danger-ink)')
    expect(rule(css, '.scene-ms-solo.on')).toContain('var(--warn)')
    expect(rule(css, '.scene-sounding td')).toContain('var(--ok-bg)')
    expect(rule(css, '.scene-now-bad')).toContain('var(--danger-ink)')
  })

  it('uses tokens, not colours, in the playing rules', () => {
    const from = css.indexOf('/* Playing a scene (as-p86.4) */')
    const playing = css.slice(from, css.indexOf('@container panel (max-width: 700px)', from))
    expect(playing).not.toMatch(/#[0-9a-f]{3,6}\b/i)
  })

  it('pins the play bar to the bottom', () => {
    expect(rule(css, '.scene-playbar')).toContain('position: sticky')
  })

  it('keeps room for the mute and solo count at its widest in the play bar (as-lzp)', () => {
    expect(rule(css, '.scene-bar-count')).toContain('display: inline-grid')
    expect(rule(css, '.scene-bar-count::before')).toContain('visibility: hidden')
    expect(rule(css, '.scene-bar-count::before')).toContain('Muted: 99')
  })

  it('opens the add-effect menu in front of the play bar, its list scrolling', () => {
    const z = (...selectors: string[]) =>
      Number(selectors.map((s) => /z-index:\s*(\d+)/.exec(rule(css, s))?.[1]).find(Boolean))
    expect(z('.scene-open .menu-list', '.menu-list')).toBeGreaterThan(z('.scene-playbar'))
    expect(rule(css, '.scene-add-list ul')).toContain('max-height')
    expect(rule(css, '.scene-add-list ul')).toContain('overflow-y: auto')
  })

  it('opens every menu of the scene editor in front of the play bar', () => {
    const z = (...selectors: string[]) =>
      Number(selectors.map((s) => /z-index:\s*(\d+)/.exec(rule(css, s))?.[1]).find(Boolean))
    // The Music menu, an effect's How it plays, Trigger and In which state menus, and Add.
    expect(z('.scene-open .menu-list', '.menu-list')).toBeGreaterThan(z('.scene-playbar'))
  })
})

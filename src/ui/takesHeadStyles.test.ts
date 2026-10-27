import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`, outside any media query. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(source)?.[1] ?? ''
}

/** The body of the container query on the Takes panel that holds the narrow layout. */
function narrow(source: string): string {
  return /@container takes \(max-width: 599px\) \{([\s\S]*?\n)\}/.exec(source)?.[1] ?? ''
}

/** The declarations of `selector` inside a block's body, indented one level. */
function inner(body: string, selector: string): string {
  return rule(body.replace(/\n {2}/g, '\n'), selector)
}

// Whether the menu and its button sit under the heading depends on the panel's width, not the
// window's: with the sidebar shown, a 900 px window leaves the panel as narrow as a 680 px one
// without it. The narrow layout is therefore keyed on the panel, and it decides the wrap itself, so
// the menu is never capped on a line of its own.
describe("the Takes panel's model menu fills a narrow panel", () => {
  it('measures the Takes panel, so its narrow layout follows the panel and not the window', () => {
    const panel = rule(css, '.takes-panel')
    expect(panel).toContain('container-type: inline-size')
    expect(panel).toContain('container-name: takes')
  })

  it('keeps the heading and the controls on one line while the panel is wide', () => {
    expect(rule(css, '.takes-head')).toContain('flex-wrap: nowrap')
  })

  it('puts the menus and the make button on their own line under the heading, the menu uncapped', () => {
    const body = narrow(css)
    expect(inner(body, '.takes-head')).toContain('flex-wrap: wrap')
    expect(inner(body, '.takes-controls')).toContain('flex: 1 1 100%')
    expect(inner(body, '.takes-controls')).toContain('flex-wrap: nowrap')
    expect(inner(body, '.takes-model')).toContain('max-width: none')
  })

  it('keeps the make button beside the menus in the empty state, the menu filling the line', () => {
    expect(inner(narrow(css), '.takes-make')).toContain('flex-wrap: nowrap')
  })

  it('keeps the count menu at its own width beside the model menu, which takes the spare room', () => {
    expect(rule(css, '.takes-count')).toContain('flex: 0 0 auto')
    expect(rule(css, '.takes-count:disabled')).toContain('opacity')
  })

  it('no longer keys the menu on the window width, which left it capped beside a gap', () => {
    expect(css).not.toMatch(/@media \(max-width: 640px\) \{\s*\.takes-controls/)
  })
})

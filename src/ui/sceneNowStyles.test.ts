import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`, outside any media query. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(source)?.[1] ?? ''
}

describe('the scene table while it plays', () => {
  it('never breaks a word inside the how-it-plays and state columns to make room', () => {
    expect(rule(css, '.scene-how,\n.scene-state')).toContain('overflow-wrap: break-word')
  })

  it('keeps "Now and then" and the state names on one line', () => {
    const block = rule(css, '.scene-how .menu-button,\n.scene-state .menu-button')
    expect(block).toContain('white-space: nowrap')
  })

  it('gives the Now column a fixed width and lets its words wrap inside it', () => {
    expect(rule(css, '.scene-effects th.scene-now-head')).toContain('width: 14em')
    expect(rule(css, '.scene-effects td.scene-now')).toContain('white-space: normal')
  })
})

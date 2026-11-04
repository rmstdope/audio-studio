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
    for (const selector of ['.scene-effect,\n.scene-how,\n.scene-state']) {
      expect(css).toContain(`${selector} {`)
    }
    const block = css.slice(css.indexOf('.scene-effect,\n.scene-how,\n.scene-state {'))
    expect(block.slice(0, block.indexOf('}'))).not.toContain('anywhere')
  })

  it('gives the Now column a width that does not follow its words', () => {
    expect(rule(css, '.scene-effects th.scene-now-head')).toContain('min-width')
  })
})

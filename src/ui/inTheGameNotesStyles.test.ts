import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations of the first rule whose selector list is exactly `selector`, outside any media query. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(source)?.[1] ?? ''
}

describe('the notes in an In the game block', () => {
  it('are grey like the take cards notes', () => {
    expect(rule(css, '.take .faint,\n.track-in-game .faint')).toContain('color: var(--faint)')
  })

  it('are 12px like the take cards notes', () => {
    expect(rule(css, '.take .small,\n.track-in-game .small')).toContain('font-size: 12px')
  })
})

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('Make takes for every image, in a narrow window', () => {
  it('drops the action under the count, as one unit', () => {
    expect(rule('.status-row')).toContain('flex-wrap: wrap')
    expect(rule('.make-all-line')).toContain('flex-wrap: wrap')
  })

  it('wraps the question’s buttons under its text and long image names inside the list', () => {
    expect(rule('.make-all-buttons')).toContain('flex-wrap: wrap')
    expect(rule('.make-all-question ul')).toContain('overflow-wrap: anywhere')
  })
})

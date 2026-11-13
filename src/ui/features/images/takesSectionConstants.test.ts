import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./TakesSection.tsx', import.meta.url), 'utf8')

describe('what Make reads of its page’s layout (as-5wln)', () => {
  it('keeps no copy of the stylesheet’s breakpoint, side chrome or gap', () => {
    for (const name of ['NARROW', 'SIDE_CHROME', 'STAGE_GAP']) expect(source).not.toContain(name)
  })
})

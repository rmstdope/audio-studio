import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('the page', () => {
  it('is titled Content Studio', () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
    expect(html).toContain('<title>Content Studio</title>')
  })
})

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`, outside any media query. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

// Aurora (docs/ui/restyle.html, A): translucent glass panels on a deep background with two faint
// glows, rounder corners, and the accent as a gradient on the main action and the logo only.
describe('the Aurora look', () => {
  it('lays the page on a deep background with two faint glows that stay put', () => {
    expect(rule('body')).toContain('radial-gradient')
    expect(rule('body')).toContain('background-attachment: fixed')
  })

  it('makes panels, cards and tables glass with soft edges and round corners', () => {
    for (const selector of ['.panel', '.card', '.table-box']) {
      expect(rule(selector)).toContain('background: var(--glass)')
      expect(rule(selector)).toContain('border: 1px solid var(--edge)')
    }
    expect(rule('.panel')).toContain('border-radius: 20px')
  })

  it('keeps the gradient for the main action and the logo', () => {
    expect(rule(':root')).toContain('--accent-grad: linear-gradient(135deg, #ff7a3d, #ff4f8b)')
    expect(rule('.btn-primary')).toContain('background: var(--accent-grad)')
    expect(rule('.brand-mark')).toContain('background: var(--accent-grad)')
  })

  it('groups tabs (the languages, the line filters) in one glass segmented control', () => {
    expect(rule('.tabs')).toContain('display: inline-flex')
    expect(rule('.tabs')).toContain('background: var(--glass)')
    expect(rule('.tabs')).toContain('padding: 3px')
    expect(rule(".tab[aria-selected='true']")).toContain('background: var(--glass-strong)')
  })

  it('lifts a card a little under the pointer, and sets a delivery cue in a dark well', () => {
    expect(rule('.card:hover')).toContain('transform: translateY(-2px)')
    expect(rule('.style-cue')).toContain('background: rgb(0 0 0 / 25%)')
  })

  it('gives pages a larger, tighter title', () => {
    expect(rule('.page-header h1')).toContain('letter-spacing: -0.03em')
  })

  it('blurs nothing behind the panels, which would hold the dialogs inside them', () => {
    expect(css).not.toContain('backdrop-filter')
  })
})

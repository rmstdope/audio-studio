import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`, anywhere in `source`. */
function rule(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`)
  return at < 0 ? '' : source.slice(at, source.indexOf('}', at))
}

/** The body of the first media query with this condition. */
function media(condition: string): string {
  const at = css.indexOf(`@media ${condition} {`)
  return at < 0 ? '' : css.slice(at, css.indexOf('\n}\n', at))
}

// A laptop's window is narrow for the pages: the sidebar and the page's margins give the content
// as much of it as they can.
describe('the room the shell leaves the pages', () => {
  it('keeps the sidebar slim beside the page', () => {
    expect(rule(media('(min-width: 900px)'), '.sidebar')).toContain('flex: 0 0 212px')
    expect(rule(css, '.sidebar')).toContain('padding: 16px 10px')
  })

  it('folds the sidebar to a 72px rail with its dots coloured by how far each act is', () => {
    expect(rule(css, '.sidebar.sidebar-rail')).toContain('flex: 0 0 72px')
    expect(rule(css, ".rail-dot[data-dot='all']")).toContain('var(--ok)')
    expect(rule(css, ".rail-dot[data-dot='some']")).toContain('var(--warn)')
    expect(rule(css, ".rail-pill[aria-current='page']")).toContain('var(--accent)')
  })

  it('gives the page small margins at its sides', () => {
    expect(rule(css, '.content')).toContain('padding: 20px 24px 32px')
  })
})

// The previous/next control wraps below a title as one piece (as-5wz).
describe('the previous/next control', () => {
  it('never splits its buttons from the count', () => {
    expect(rule(css, '.pager')).toContain('white-space: nowrap')
    expect(rule(css, '.pager')).toContain('display: inline-flex')
  })
})

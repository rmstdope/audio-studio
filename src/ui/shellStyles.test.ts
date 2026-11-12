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
    // The unfolded sidebar keeps its own sticky full-height rules (the folded rail repeats them)
    expect(rule(media('(min-width: 900px)'), '.sidebar')).toContain('position: sticky')
    expect(rule(media('(min-width: 900px)'), '.sidebar')).toContain('height: 100vh')
  })

  it('folds the sidebar to a 72px rail with its dots coloured by how far each act is', () => {
    expect(rule(css, '.sidebar.sidebar-rail')).toContain('flex: 0 0 72px')
    expect(rule(css, ".rail-dot[data-dot='all']")).toContain('var(--ok)')
    expect(rule(css, ".rail-dot[data-dot='some']")).toContain('var(--warn)')
    expect(rule(css, ".rail-pill[aria-current='page']")).toContain('var(--accent)')
  })

  // The Stingers pill is narrow enough to squeeze a shrinkable dot to a sliver (as-4zpu).
  it("keeps every rail pill's dot a 6px circle, however narrow the pill", () => {
    const dot = rule(css, '.rail-dot')
    expect(dot).toContain('width: 6px')
    expect(dot).toContain('height: 6px')
    expect(dot).toContain('border-radius: 50%')
    expect(dot).toContain('flex-shrink: 0')
  })

  // The Stingers pill is the widest: at verification its dot, gap and label ran 50px across while
  // its border left only 45px inside, so the dot sat on the left border and the s on the right
  // (as-1iaf). Every pill's room is what the rail, its padding, the pills' padding and the pill's
  // own border and padding leave of the 72px.
  it('leaves the widest rail pill, Stingers, room inside its border for its dot and label', () => {
    /** The pixel numbers of `property` in `declarations`, as written (`0` when it is not). */
    const lengths = (declarations: string, property: string): number[] => {
      const value = new RegExp(`(?:^|[;\\s{])${property}:\\s*([^;]+);`).exec(declarations)?.[1]
      return (value ?? '0')
        .trim()
        .split(/\s+/)
        .map((part) => parseFloat(part) || 0)
    }
    /** The left-and-right padding of a `padding` shorthand of one to four lengths. */
    const sidePadding = (declarations: string): number => {
      const [top = 0, right = top, , left = right] = lengths(declarations, 'padding')
      return right + left
    }
    /** A rule outside any media query, its selector alone at the start of a line. */
    const top = (selector: string): string => rule(css, `\n${selector}`)
    const pill = top('.rail-pill')
    const inside =
      72 -
      lengths(top('.sidebar'), 'border-right')[0]! -
      sidePadding(top('.sidebar-rail')) -
      sidePadding(top('.rail-pills')) -
      2 * lengths(pill, 'border')[0]! -
      sidePadding(pill)
    const content = 6 + lengths(pill, 'gap')[0]! + 40 // dot, gap, "Stingers" at 10.5px as measured
    expect(inside - content).toBeGreaterThanOrEqual(2 * 2) // at least 2px clear at each side
  })

  // Folded, the rail is a full-height column on the left at every width (as-zlty).
  it('keeps the folded rail a sticky full-height column beside the page at any width', () => {
    const rail = rule(css, '.sidebar.sidebar-rail')
    for (const d of ['position: sticky', 'top: 0', 'height: 100vh', 'overflow-y: auto'])
      expect(rail).toContain(d)
    expect(rule(css, '.shell:has(> .sidebar-rail)')).toContain('flex-wrap: nowrap')
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

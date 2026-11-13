import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mediaQueries, selectorsAtPanelWidth } from '../../test/stylesheet'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('rows stack into cards (as-4rfy)', () => {
  it('is one rule: the tables that stack opt in with stack-table, none has a block of its own', () => {
    for (const file of [
      './features/music/OrphansPanel.tsx',
      './features/images/ActPage.tsx',
      './features/effects/EffectsList.tsx',
      './features/scenes/SceneDetail.tsx',
    ]) {
      expect(read(file)).toContain('stack-table')
    }
    expect(css.match(/\.stack-table thead \{/g)?.length).toBe(1)
    expect(css).not.toMatch(/\.(images-table|effects-table|music-orphans-table) thead/)
    expect(css).not.toMatch(/\.scene-effects \.table thead/)
  })
})

describe('a panel changes layout by its own width', () => {
  it('measures the page and the scenes panel as the same named container', () => {
    for (const selector of ['.content', '.scene-effects']) {
      const at = css.indexOf(`\n${selector} {`)
      const body = css.slice(at, css.indexOf('}', at))
      expect(body).toContain('container-type: inline-size')
      expect(body).toContain('container-name: panel')
    }
  })

  it('stacks the rows in a 650 px panel and not in an 800 px one, whatever the window is', () => {
    expect(selectorsAtPanelWidth(650)).toContain('.stack-table thead')
    expect(selectorsAtPanelWidth(800)).not.toContain('.stack-table thead')
  })

  it('leaves only the shell and the viewport to media queries', () => {
    expect(mediaQueries().sort()).toEqual(
      [
        '@media (min-width: 900px)',
        '@media (max-width: 600px)',
        '@media (max-width: 600px)',
        '@media (min-width: 1100px)',
        '@media (prefers-reduced-motion: reduce)',
      ].sort(),
    )
  })
})

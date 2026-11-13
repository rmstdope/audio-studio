import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/**
 * The stylesheet's rules as `scope | selector` keys, one per rule block: the scope is the
 * enclosing at-rule (`@media …`) or empty at the top level. Comments are dropped first.
 */
function ruleKeys(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const keys: string[] = []
  const scopes: string[] = []
  // What each open brace is: an at-rule's name (its scope) or '' for a rule's own block.
  const open: string[] = []
  let prelude = ''
  for (const char of text) {
    if (char === '{') {
      const head = prelude.trim().replace(/\s+/g, ' ')
      const scoped = head.startsWith('@')
      if (scoped) scopes.push(head)
      else if (!open.includes('') && !scopes.some((scope) => scope.startsWith('@keyframes'))) {
        keys.push(`${scopes.join(' > ')} | ${head}`)
      }
      open.push(scoped ? head : '')
      prelude = ''
    } else if (char === '}') {
      if (open.pop()) scopes.pop()
      prelude = ''
    } else if (char === ';') {
      prelude = ''
    } else prelude += char
  }
  return keys
}

describe('the stylesheet', () => {
  it('defines no selector twice in the same scope', () => {
    const seen = new Set<string>()
    const twice = ruleKeys(css).filter((key) => (seen.has(key) ? true : (seen.add(key), false)))
    expect(twice).toEqual([])
  })

  it('has one named section per feature at its end, where new rules go there', () => {
    const banners = [...css.matchAll(/^\/\* ===== (.+) ===== \*\/$/gm)].map((match) => match[1])
    expect(banners).toEqual(['Narration', 'Music', 'Images', 'Sound effects', 'Scenes', 'Setup'])
  })
})

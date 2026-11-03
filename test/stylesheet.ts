import { readFileSync } from 'node:fs'

/** The studio's stylesheet with its comments and its `@media` / `@container` blocks taken out. */
function alwaysRules(): { selectors: string[]; body: string }[] {
  const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@[a-z]+ [^{]*\{[\s\S]*?\n\}\n/g, '')
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(',').map((s) => s.trim()),
    body: m[2]!,
  }))
}

/**
 * The non-zero `min-width`s that the stylesheet's rules for every window width give an element,
 * each with the selector that gives it. Empty means nothing stops the element from shrinking.
 */
export function minWidthsInEveryWindow(element: Element): string[] {
  const found: string[] = []
  for (const rule of alwaysRules()) {
    const width = /(?:^|[;\s])min-width:\s*([^;]+);/.exec(rule.body)?.[1]?.trim()
    if (!width || width === '0') continue
    for (const selector of rule.selectors) {
      let matches = false
      try {
        matches = element.matches(selector)
      } catch {
        // A selector the DOM cannot test (a pseudo-element) applies to no element.
      }
      if (matches) found.push(`${selector}: ${width}`)
    }
  }
  return found
}

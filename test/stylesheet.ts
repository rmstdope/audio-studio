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
 * each with the selector that gives it. Empty means no rule outside a media or container block
 * gives the element itself a minimum width; widths, cells and the cascade are not looked at.
 */
export function minWidthsInEveryWindow(element: Element): string[] {
  return valuesInEveryWindow(element, 'min-width').filter((found) => !/: 0(px)?$/.test(found))
}

/**
 * The values that the stylesheet's rules for every window width give `property` on an element,
 * each with the selector that gives it, in stylesheet order. Only the property written out is
 * seen, never a shorthand (`margin: 0 auto` gives no `margin-left`); media and container blocks,
 * the cascade and inheritance are not looked at.
 */
export function valuesInEveryWindow(element: Element, property: string): string[] {
  const found: string[] = []
  const declaration = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`)
  for (const rule of alwaysRules()) {
    const value = declaration.exec(rule.body)?.[1]?.trim()
    if (!value) continue
    for (const selector of rule.selectors) {
      let matches = false
      try {
        matches = element.matches(selector)
      } catch {
        // A selector the DOM cannot test (a pseudo-element) applies to no element.
      }
      if (matches) found.push(`${selector}: ${value}`)
    }
  }
  return found
}

/**
 * The pixels a CSS length of numbers, `px`, `vh`, `%`, `calc`, `min`, `max` and
 * `var(--picture-ratio, …)` (or another `--…-ratio`) comes to, given what `100%` and `100vh` are and
 * that ratio:
 * enough to check a rule such as the fitted stage's width at a window size without a browser.
 */
export function cssLength(
  value: string,
  at: { percent: number; vh: number; ratio: number },
): number {
  const js = value
    .replace(/var\(--[a-z-]+-ratio, [^)]*\)/g, String(at.ratio))
    .replace(/([\d.]+)%/g, (_, n: string) => String((Number(n) * at.percent) / 100))
    .replace(/([\d.]+)vh/g, (_, n: string) => String((Number(n) * at.vh) / 100))
    .replace(/([\d.]+)px/g, '$1')
    .replace(/calc\(/g, '(')
    .replace(/\b(min|max)\(/g, 'Math.$1(')
  if (!/^[\d.\s+\-*/(),Mathminax]*$/.test(js)) throw new Error(`Not a length this reads: ${value}`)
  return Number(new Function(`return ${js}`)())
}

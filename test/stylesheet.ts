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
  return valuesIn(alwaysRules(), element, property)
}

/** The values `rules` give `property` on an element, each with the selector that gives it. */
function valuesIn(
  rules: { selectors: string[]; body: string }[],
  element: Element,
  property: string,
): string[] {
  const found: string[] = []
  const declaration = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`)
  for (const rule of rules) {
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

/** The stylesheet without its comments. */
function stylesheetText(): string {
  return readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
}

/** The at-rules of the stylesheet (`@media …`, `@container …`) with their prelude and body. */
function atBlocks(): { prelude: string; body: string }[] {
  const css = stylesheetText()
  const blocks: { prelude: string; body: string }[] = []
  for (const start of css.matchAll(/^@(?:media|container)[^{]*\{/gm)) {
    let depth = 1
    let i = start.index + start[0].length
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    blocks.push({
      prelude: start[0].slice(0, -1).trim(),
      body: css.slice(start.index + start[0].length, i - 1),
    })
  }
  return blocks
}

/** Every `@media` prelude in the stylesheet, such as `@media (max-width: 600px)`. */
export function mediaQueries(): string[] {
  return atBlocks()
    .map((b) => b.prelude)
    .filter((p) => p.startsWith('@media'))
}

/**
 * The selectors the stylesheet's `@container panel (max-width: N)` blocks apply to a panel `width`
 * px wide, whatever the window's width is: the panel's own width decides, as a browser would.
 */
export function selectorsAtPanelWidth(width: number): string[] {
  const selectors: string[] = []
  for (const block of atBlocks()) {
    const max = /^@container panel \(max-width: (\d+)px\)$/.exec(block.prelude)?.[1]
    if (max === undefined || width > Number(max)) continue
    for (const m of block.body.matchAll(/([^{}]+)\{[^}]*\}/g)) {
      for (const s of m[1]!.split(',')) selectors.push(s.trim())
    }
  }
  return selectors
}

/**
 * The non-zero `min-width`s the stylesheet gives an element in a panel `width` px wide: the rules
 * for every width and those of the `@container panel (max-width: N)` and `(min-width: N)` blocks
 * that apply at that width, each with the selector that gives it. Other at-rules (`@media`, a
 * container query with more than one condition) are not read; like `minWidthsInEveryWindow`, the
 * cascade is not looked at.
 */
export function minWidthsAtPanelWidth(element: Element, width: number): string[] {
  const rules = [...alwaysRules()]
  for (const block of atBlocks()) {
    const query = /^@container panel \((max|min)-width: (\d+)px\)$/.exec(block.prelude)
    if (!query) continue
    const limit = Number(query[2])
    if (query[1] === 'max' ? width > limit : width < limit) continue
    for (const m of block.body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      rules.push({ selectors: m[1]!.split(',').map((s) => s.trim()), body: m[2]! })
    }
  }
  return valuesIn(rules, element, 'min-width').filter((found) => !/: 0(px)?$/.test(found))
}

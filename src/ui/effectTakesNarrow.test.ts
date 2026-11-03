import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const panel = readFileSync(
  new URL('./features/effects/EffectTakesPanel.tsx', import.meta.url),
  'utf8',
)

/** The declarations of the first rule whose selector is exactly `selector`, outside any block. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(source)?.[1] ?? ''
}

/** The bodies of every narrow container query on the Takes panel, indented one level less. */
function narrow(source: string): string {
  return [...source.matchAll(/@container takes \(max-width: 599px\) \{([\s\S]*?\n)\}/g)]
    .map((match) => match[1] ?? '')
    .join('\n')
    .replace(/\n {2}/g, '\n')
}

// A sound-effects model's entry is long ('Stable Audio 3 Small SFX — about 2 s a take'). Music's
// narrow layout keeps the menu, the count and the button on one line, which cut the entry at a
// 600 px window; on an effect's page the menu takes a line of its own instead, so its whole name
// shows.
describe("an effect's model menu shows its whole entry in a narrow panel", () => {
  it('marks the Takes panel as an effect one', () => {
    expect(panel).toContain('className="panel takes-panel effect-takes"')
  })

  it('lets the controls wrap under the heading, the menu on a line of its own', () => {
    const body = narrow(css)
    expect(rule(body, '.effect-takes .takes-controls')).toContain('flex-wrap: wrap')
    expect(rule(body, '.effect-takes .takes-make')).toContain('flex-wrap: wrap')
    expect(rule(body, '.effect-takes .takes-model')).toContain('flex: 1 1 100%')
  })
})

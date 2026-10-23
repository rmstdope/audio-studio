import type { Cast } from './resources'

/** Lines longer than this are broken up: the pronunciation table goes one entry per line. */
const LINE_LIMIT = 100

/**
 * The cast as text, in the layout RetroQuest's cast already has: one line per character, nested
 * values inline, so a change to one character is a one-line diff. Unknown top-level fields are
 * kept after `speakers` and `pronounce`.
 */
export function formatCast(cast: Cast): string {
  const { speakers, pronounce, ...rest } = cast
  const sections = [
    `  "speakers": ${block(speakers, 2)}`,
    `  "pronounce": ${fitting(pronounce, '  "pronounce": ')}`,
    ...Object.entries(rest).map(([key, value]) => `  ${JSON.stringify(key)}: ${inline(value)}`),
  ]
  return `{\n${sections.join(',\n')}\n}\n`
}

/** An object with one entry per line, each value inline. */
function block(record: Record<string, unknown>, indent: number): string {
  const entries = Object.entries(record)
  if (!entries.length) return '{}'
  const pad = ' '.repeat(indent + 2)
  const lines = entries.map(([key, value]) => `${pad}${JSON.stringify(key)}: ${inline(value)}`)
  return `{\n${lines.join(',\n')}\n${' '.repeat(indent)}}`
}

/** An object inline if it fits on its line after `prefix`, else one entry per line. */
function fitting(record: Record<string, unknown>, prefix: string): string {
  const one = inline(record)
  const indent = prefix.length - prefix.trimStart().length
  return prefix.length + one.length <= LINE_LIMIT ? one : block(record, indent)
}

/** A value on one line, spaced as `{ "a": 1, "b": [1, 2] }`. */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (!entries.length) return '{}'
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')} }`
  }
  return JSON.stringify(value)
}

/** Lines longer than this are broken up: the pronunciation table goes one entry per line. */
const LINE_LIMIT = 100

/**
 * The cast as text, in the layout RetroQuest's cast already has: one line per character, nested
 * values inline, so a change to one character is a one-line diff. Top-level fields stay in their
 * order, and none is added.
 */
export function formatCast(cast: Record<string, unknown>): string {
  const sections = Object.entries(cast).map(([key, value]) => {
    const prefix = `  ${JSON.stringify(key)}: `
    if (key === 'speakers' && isRecord(value)) return prefix + block(value, 2)
    if (key === 'pronounce' && isRecord(value)) return prefix + fitting(value, prefix)
    return prefix + inline(value)
  })
  return `{\n${sections.join(',\n')}\n}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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

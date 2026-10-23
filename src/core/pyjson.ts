/**
 * JSON as Python's `json.dumps(value, indent=1)` writes it, so a file a Python tool wrote (the
 * game's narration manifest) is rewritten without changing lines nobody touched: one-space
 * indents, non-ASCII escaped as `\uXXXX`, and every number written as a float (`0.0`), since the
 * manifest's numbers are all floats.
 */
export function pythonJson(value: unknown, indent = 0): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return pythonFloat(value)
  if (typeof value === 'string') return pythonString(value)
  const pad = ' '.repeat(indent + 1)
  const close = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[\n${value.map((v) => pad + pythonJson(v, indent + 1)).join(',\n')}\n${close}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (!entries.length) return '{}'
    const lines = entries.map(([k, v]) => `${pad}${pythonString(k)}: ${pythonJson(v, indent + 1)}`)
    return `{\n${lines.join(',\n')}\n${close}}`
  }
  throw new Error(`cannot write ${typeof value} as JSON`)
}

function pythonFloat(value: number): string {
  if (!Number.isFinite(value)) throw new Error('cannot write a non-finite number as JSON')
  const text = String(value)
  return /[.eE]/.test(text) ? text : `${text}.0`
}

const SHORT: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
}

/** A string as Python writes it with `ensure_ascii`: printable ASCII as is, the rest escaped. */
function pythonString(value: string): string {
  let out = '"'
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    const code = value.charCodeAt(i)
    if (SHORT[char]) out += SHORT[char]
    else if (code >= 0x20 && code <= 0x7e) out += char
    else out += `\\u${code.toString(16).padStart(4, '0')}`
  }
  return `${out}"`
}

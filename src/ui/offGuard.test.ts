import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Every non-test `.tsx` file under `dir`, with its source. */
function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    if (!name.endsWith('.tsx') || name.endsWith('.test.tsx')) return []
    return [{ file: path, text: readFileSync(path, 'utf8') }]
  })
}

const files = sources(new URL('.', import.meta.url).pathname)

/** The tags opened in `text` that carry `attribute`, as `file:line`. */
function found(attribute: RegExp, keep: (tag: string) => boolean = () => true): string[] {
  return files.flatMap(({ file, text }) =>
    [...text.matchAll(/<([A-Za-z][\w.]*)((?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)>/g)]
      .filter((m) => attribute.test(m[2]!) && keep(m[1]!))
      .map((m) => `${file}:${text.slice(0, m.index).split('\n').length}`),
  )
}

describe('every greyed control explains itself', () => {
  it('uses off(...) and never the native disabled attribute (an <option> may stay)', () => {
    expect(found(/(^|\s)disabled(=|\s|$)/, (tag) => tag !== 'option')).toEqual([])
  })

  it('never writes aria-disabled by hand, so no greyed control is left without its reason', () => {
    expect(found(/(^|\s)aria-disabled=/)).toEqual([])
  })
})

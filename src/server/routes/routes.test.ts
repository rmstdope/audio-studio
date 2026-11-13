import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const files = ['setup', 'narration', 'music', 'images', 'effects', 'scenes']

/** The paths one route file registers: the quoted `/api/…` keys at the start of its entries. */
function pathsOf(file: string): string[] {
  const source = readFileSync(new URL(`./${file}.ts`, import.meta.url), 'utf8')
  return [...source.matchAll(/^ {4}'(\/api\/[^']*)': /gm)].map((match) => match[1] as string)
}

describe('the route files', () => {
  it('register no path twice, in one file or across them', () => {
    const all = files.flatMap(pathsOf)
    expect(all.length).toBeGreaterThan(100)
    expect(all.filter((path, at) => all.indexOf(path) !== at)).toEqual([])
  })

  it('keep each medium’s paths in its own file', () => {
    expect(pathsOf('music').every((path) => path.startsWith('/api/music/'))).toBe(true)
    expect(pathsOf('effects').every((path) => path.startsWith('/api/effects/'))).toBe(true)
    expect(pathsOf('scenes').every((path) => /^\/api\/scene/.test(path))).toBe(true)
    expect(pathsOf('images').every((path) => /^\/api\/image/.test(path))).toBe(true)
  })
})

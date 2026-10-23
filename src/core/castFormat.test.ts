import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatCast } from './castFormat'

const retroquest = readFileSync(
  join(import.meta.dir, '../../test/fixtures/retroquest-cast.json'),
  'utf8',
)

describe('formatCast', () => {
  it('writes RetroQuest’s cast back exactly as it is', () => {
    expect(formatCast(JSON.parse(retroquest))).toBe(retroquest)
  })

  it('writes each character on one line, nested values inline', () => {
    const text = formatCast({
      speakers: {
        mira: { voice: 'v1', audition: { keywords: ['old', 'calm'], phrase: null } },
      },
      pronounce: {},
    })
    expect(text).toBe(
      '{\n' +
        '  "speakers": {\n' +
        '    "mira": { "voice": "v1", "audition": { "keywords": ["old", "calm"], "phrase": null } }\n' +
        '  },\n' +
        '  "pronounce": {}\n' +
        '}\n',
    )
  })

  it('writes a long pronunciation table one entry per line', () => {
    const pronounce = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`Word${i}`, `Said as word number ${i}`]),
    )
    const text = formatCast({ speakers: {}, pronounce })
    expect(text).toContain('  "pronounce": {\n    "Word0": "Said as word number 0",\n')
    expect(JSON.parse(text)).toEqual({ speakers: {}, pronounce })
  })

  it('keeps top-level fields in their order, adding none', () => {
    const text = formatCast({ notes: 'hi', speakers: { a: { voice: 'v' } } })
    expect(text).toBe('{\n  "notes": "hi",\n  "speakers": {\n    "a": { "voice": "v" }\n  }\n}\n')
  })
})

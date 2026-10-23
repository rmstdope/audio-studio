import { describe, expect, it } from 'bun:test'
import { resolveInRoot } from './paths'

describe('resolveInRoot', () => {
  it('resolves a path inside the root', () => {
    expect(resolveInRoot('/repo', 'tts/act1/script.json')).toBe('/repo/tts/act1/script.json')
  })

  it('refuses a path that climbs out of the root', () => {
    expect(() => resolveInRoot('/repo', '../other/cast.json')).toThrow('outside the project root')
  })

  it('refuses an absolute path elsewhere', () => {
    expect(() => resolveInRoot('/repo', '/etc/passwd')).toThrow('outside the project root')
  })

  it('refuses the root itself', () => {
    expect(() => resolveInRoot('/repo', '.')).toThrow('outside the project root')
  })

  it('allows names that merely start with dots', () => {
    expect(resolveInRoot('/repo', '..cache/x')).toBe('/repo/..cache/x')
  })
})

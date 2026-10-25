import { describe, expect, it } from 'bun:test'
import { badgeFor } from './CharacterCard'

describe('badgeFor', () => {
  it('says Ready only when every line is up to date', () => {
    expect(badgeFor(true, { ok: 3 }).label).toBe('Ready')
    expect(badgeFor(true, { missing: 1, stale: 1 }).label).toBe('2 to record')
  })

  it('never calls uncast or untranslated lines ready', () => {
    expect(badgeFor(true, { uncast: 1 }).label).toBe('Uncast')
    expect(badgeFor(true, { ok: 2, untranslated: 6 }).label).toBe('Not translated')
  })
})

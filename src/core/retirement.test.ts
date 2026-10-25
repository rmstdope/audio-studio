import { describe, expect, it } from 'bun:test'
import {
  bannerWords,
  doneWords,
  failureBody,
  hasRetired,
  questionItems,
  retiringTakes,
} from './retirement'

const before = new Date('2026-12-31T23:59:59Z')
const after = new Date('2027-01-01T00:00:00Z')

describe('retiringTakes', () => {
  it('lists the takes recorded with s1, draft first', () => {
    expect(retiringTakes({ draft: 's1', final: 's1' })).toEqual(['draft', 'final'])
    expect(retiringTakes({ draft: 's1', final: 's2-pro' })).toEqual(['draft'])
    expect(retiringTakes({ draft: 's2.1-pro-free', final: 's1' })).toEqual(['final'])
    expect(retiringTakes({ draft: 's2.1-pro-free', final: 's2-pro' })).toEqual([])
  })
})

describe('hasRetired', () => {
  it('turns true on 1 January 2027', () => {
    expect(hasRetired(before)).toBe(false)
    expect(hasRetired(after)).toBe(true)
  })
})

describe('bannerWords', () => {
  it('says what retires and what to do, before the day', () => {
    expect(bannerWords(['draft', 'final'], before)).toEqual({
      heading: 's1 retires on 31 December 2026',
      body: 'This project records its draft and final takes with s1. From 1 January Fish records them with s2.1-pro instead, at the same price.',
    })
    expect(bannerWords(['draft'], before).body).toBe(
      'This project records its draft takes with s1. From 1 January Fish records them with s2.1-pro instead, at the same price.',
    )
    expect(bannerWords(['final'], before).body).toContain('its final takes with s1')
  })

  it('goes into the past tense from 1 January', () => {
    expect(bannerWords(['draft', 'final'], after)).toEqual({
      heading: 's1 retired on 31 December 2026',
      body: "Fish no longer has s1: this project's draft and final takes are now recorded with s2.1-pro, at the same price. Switch to say so in the project file.",
    })
    expect(bannerWords(['draft'], after).body).toContain("this project's draft takes are now")
    expect(bannerWords(['final'], after).body).toContain("this project's final takes are now")
  })
})

describe('the question, the confirmation and the failure', () => {
  it('lists one line per take on s1, then the two fixed lines', () => {
    expect(questionItems(['draft', 'final'])).toEqual([
      'Draft: s1 → s2.1-pro',
      'Final: s1 → s2.1-pro',
      'Saved in audio-studio.json; nothing else in it changes.',
      'Lines already recorded with s1 stay as they are.',
    ])
    expect(questionItems(['final'], 'game.json')[0]).toBe('Final: s1 → s2.1-pro')
    expect(questionItems(['final'], 'game.json')[1]).toBe(
      'Saved in game.json; nothing else in it changes.',
    )
  })

  it('says what is now on s2.1-pro', () => {
    const tail = 'saved in audio-studio.json. Lines already recorded with s1 stay as they are.'
    expect(doneWords(['draft', 'final'], 'audio-studio.json')).toBe(
      `Draft and final now use s2.1-pro, ${tail}`,
    )
    expect(doneWords(['draft'], 'audio-studio.json')).toBe(`Draft now uses s2.1-pro, ${tail}`)
    expect(doneWords(['final'], 'audio-studio.json')).toBe(`Final now uses s2.1-pro, ${tail}`)
  })

  it('names the file and the reason', () => {
    expect(failureBody('audio-studio.json', 'disk full')).toBe(
      'audio-studio.json could not be saved: disk full. Nothing was changed.',
    )
  })
})

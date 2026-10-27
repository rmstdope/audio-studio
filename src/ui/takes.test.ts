import { describe, expect, it } from 'bun:test'
import {
  extraTakeWords,
  isAbout,
  takeAnswerState,
  takeToRecord,
  withAuditionTakes,
  withTake,
  withVoiceTake,
} from './takes'

const candidates = {
  ok: true as const,
  audition: { phrase: 'New.', own: true, spoken: '[warm] New.' },
  takes: { a: 'key-a' } as Record<string, string>,
}

describe('withTake', () => {
  it('adds a take of the phrase shown', () => {
    expect(withTake(candidates, 'b', { key: 'key-b', spoken: '[warm] New.' }).takes).toEqual({
      a: 'key-a',
      b: 'key-b',
    })
  })

  it('ignores a take of a phrase no longer shown', () => {
    expect(withTake(candidates, 'b', { key: 'old', spoken: '[warm] Old.' })).toBe(candidates)
  })
})

describe('withAuditionTakes', () => {
  it('keeps takes recorded meanwhile when the phrase is the same', () => {
    const fresh = withAuditionTakes(candidates, candidates.audition, { c: 'key-c' })
    expect(fresh.takes).toEqual({ a: 'key-a', c: 'key-c' })
  })

  it('takes the fresh take where both have one for the voice', () => {
    const fresh = withAuditionTakes(candidates, candidates.audition, { a: 'key-a2' })
    expect(fresh.takes).toEqual({ a: 'key-a2' })
  })

  it('takes only the fresh takes for a new phrase', () => {
    const audition = { phrase: 'Other.', own: true, spoken: '[warm] Other.' }
    const fresh = withAuditionTakes(candidates, audition, { c: 'key-c' })
    expect(fresh).toMatchObject({ audition, takes: { c: 'key-c' } })
  })
})

const voiced = {
  ok: true as const,
  id: 'v1' as string | null,
  voice: null,
  lookup: null as { reason: 'no-key' | 'fish'; message: string } | null,
  take: null as string | null,
  audition: { phrase: 'New.', own: true, spoken: '[warm] New.' },
  language: 'en',
}

describe('withVoiceTake', () => {
  it('adds a take of the cast voice saying the phrase shown', () => {
    expect(withVoiceTake(voiced, 'v1', { key: 'k', spoken: '[warm] New.' }).take).toBe('k')
  })

  it('leaves out a take of another voice, or of a phrase changed meanwhile', () => {
    expect(withVoiceTake(voiced, 'v2', { key: 'k', spoken: '[warm] New.' })).toBe(voiced)
    expect(withVoiceTake(voiced, 'v1', { key: 'k', spoken: '[warm] Old.' })).toBe(voiced)
  })
})

describe('takeToRecord', () => {
  it('asks for the cast voice’s take when it has none, once per phrase', () => {
    expect(takeToRecord(voiced, 'v1')).toBe('[warm] New.\nv1')
    expect(takeToRecord({ ...voiced, take: 'k' }, 'v1')).toBeNull()
  })

  it('asks nothing for another voice than the one cast now, or without a key', () => {
    expect(takeToRecord(voiced, 'v2')).toBeNull()
    expect(takeToRecord({ ...voiced, id: null }, null)).toBeNull()
    const keyless = { ...voiced, lookup: { reason: 'no-key' as const, message: 'Set the key.' } }
    expect(takeToRecord(keyless, 'v1')).toBeNull()
  })

  it('asks nothing for an ElevenLabs voice, which makes no takes yet', () => {
    expect(takeToRecord({ ...voiced, id: 'eleven:g1' }, 'eleven:g1')).toBeNull()
  })
})

describe('isAbout', () => {
  it('tells an answer about the voice cast now from one about an earlier voice', () => {
    expect(isAbout({ id: 'v1' }, 'v1')).toBe(true)
    expect(isAbout({ id: 'v1' }, 'v2')).toBe(false)
    expect(isAbout({ id: null }, null)).toBe(true)
  })
})

describe('extraTakeWords', () => {
  it('keeps the free model’s words as they were', () => {
    const words = extraTakeWords('s2.1-pro-free')
    expect(words.empty).toBe(
      'No extra takes yet. Another take records the line once more, with the free model, to compare with the clip; it costs nothing and changes nothing until you use it.',
    )
    expect(words.hover).toBe('Record the line once more, with the free model, into the cache')
  })

  it('names a paid draft model, and says it asks before it spends', () => {
    const words = extraTakeWords('s2.1-pro')
    expect(words.empty).toBe(
      'No extra takes yet. Another take records the line once more with the draft model, s2.1-pro, which is paid: it asks what it can cost before it spends, and changes nothing until you use it.',
    )
    expect(words.hover).toBe(
      'Record the line once more, with the paid draft model s2.1-pro, into the cache; asks before it spends',
    )
  })
})

describe('takeAnswerState', () => {
  it('asks to pay the ceiling rounded up to the cent', () => {
    const asked = { ok: false as const, reason: 'confirm' as const, ceiling: 0.0151, message: 'm' }
    expect(takeAnswerState(asked)).toEqual({ toConfirm: 0.02, refusal: null })
  })

  it('shows a refusal to spend, and asks nothing', () => {
    const credit = { ok: false as const, reason: 'credit' as const, message: 'No credit.' }
    expect(takeAnswerState(credit)).toEqual({ toConfirm: null, refusal: 'No credit.' })
  })

  it('leaves other answers to the failure display, and a take made asks nothing', () => {
    expect(takeAnswerState({ ok: false, reason: 'fish', message: 'x' })).toEqual({
      toConfirm: null,
      refusal: null,
    })
    expect(takeAnswerState({ ok: false, problems: [] })).toEqual({ toConfirm: null, refusal: null })
  })
})

import { describe, expect, it } from 'bun:test'
import {
  addVoice,
  bringMore,
  finalist,
  nextRound,
  queueMore,
  setVerdict,
  startSession,
  type AuditionSession,
} from './audition'
import type { Candidate, Voice } from './voiceSearch'

function voice(id: string): Voice {
  return {
    id,
    title: id.toUpperCase(),
    description: '',
    tags: [],
    languages: [],
    uses: 0,
    likes: 0,
    author: '',
    sample: null,
  }
}

function candidates(...ids: string[]): Candidate[] {
  return ids.map((id) => ({ voice: voice(id), matched: ['warm'] }))
}

function start(current: Voice | null = null): AuditionSession {
  return startSession({
    character: 'mira',
    keywords: ['warm'],
    current,
    candidates: candidates('a', 'b', 'c', 'd', 'e', 'f'),
    perRound: 3,
  })
}

describe('startSession', () => {
  it('starts round 1 with the current voice and the top candidates, the rest queued', () => {
    const session = start(voice('cur'))
    expect(session.round).toBe(1)
    expect(session.pool).toEqual(['cur', 'a', 'b', 'c'])
    expect(session.queue).toEqual(['d', 'e', 'f'])
    expect(session.current).toBe('cur')
    expect(Object.keys(session.voices).sort()).toEqual(['a', 'b', 'c', 'cur', 'd', 'e', 'f'])
    expect(session.matched.a).toEqual(['warm'])
  })
})

describe('verdicts and rounds', () => {
  it('sets and clears a verdict, only for voices in the round', () => {
    let session = setVerdict(start(), 'a', 'keep')
    expect(session.verdicts).toEqual({ a: 'keep' })
    session = setVerdict(session, 'a', null)
    expect(session.verdicts).toEqual({})
    expect(setVerdict(session, 'zzz', 'drop')).toBe(session)
  })

  it('moves on with the voices not dropped, remembering the dropped ones', () => {
    let session = setVerdict(start(), 'a', 'drop')
    session = setVerdict(session, 'b', 'keep')
    session = nextRound(session)
    expect(session.round).toBe(2)
    expect(session.pool).toEqual(['b', 'c'])
    expect(session.verdicts).toEqual({})
    expect(session.dropped).toEqual(['a'])
    expect(session.rounds).toEqual([{ round: 1, voices: 3 }])
  })

  it('does not move on when nothing was dropped, or everything was', () => {
    const session = start()
    expect(nextRound(session)).toBe(session)
    const all = ['a', 'b', 'c'].reduce((s, v) => setVerdict(s, v, 'drop'), session)
    expect(nextRound(all)).toBe(all)
  })
})

describe('bringMore and addVoice', () => {
  it('brings in the next voices from the queue', () => {
    const session = bringMore(start(), 2)
    expect(session.pool).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(session.queue).toEqual(['f'])
  })

  it('adds a voice found by id, unless it was seen already', () => {
    const session = addVoice(start(), voice('x'))
    expect(session.pool.at(-1)).toBe('x')
    expect(session.voices.x?.title).toBe('X')
    expect(addVoice(session, voice('x'))).toBe(session)
    const dropped = nextRound(setVerdict(start(), 'a', 'drop'))
    expect(addVoice(dropped, voice('a'))).toBe(dropped)
  })
})

describe('queueMore', () => {
  it('queues new candidates from another search, never ones seen before', () => {
    const dropped = nextRound(setVerdict(start(voice('cur')), 'a', 'drop'))
    const session = queueMore(dropped, candidates('a', 'cur', 'f', 'g'))
    expect(session.queue).toEqual(['d', 'e', 'f', 'g'])
    expect(session.voices.g?.title).toBe('G')
  })

  it('takes a queued voice added by id out of the queue', () => {
    const session = addVoice(start(), voice('e'))
    expect(session.pool.at(-1)).toBe('e')
    expect(session.queue).toEqual(['d', 'f'])
  })
})

describe('finalist', () => {
  it('is the one voice left in the round', () => {
    let session = start()
    expect(finalist(session)).toBeNull()
    session = setVerdict(setVerdict(session, 'a', 'drop'), 'b', 'drop')
    expect(finalist(session)).toBe('c')
  })
})

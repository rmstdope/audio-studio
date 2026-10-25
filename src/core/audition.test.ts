import { describe, expect, it } from 'bun:test'
import {
  addSpent,
  addVoice,
  bringMore,
  drop,
  queueMore,
  shortlist,
  startSession,
  undoDrop,
  unlist,
  AuditionSessionSchema,
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
  it('puts the current voice on the shortlist and the top candidates up to hear', () => {
    const session = start(voice('cur'))
    expect(session.shortlist).toEqual(['cur'])
    expect(session.toHear).toEqual(['a', 'b', 'c'])
    expect(session.queue).toEqual(['d', 'e', 'f'])
    expect(session.voices.cur?.title).toBe('CUR')
    expect(AuditionSessionSchema.safeParse(session).success).toBe(true)
  })

  it('starts with an empty shortlist for a character with no voice, never listing the current one twice', () => {
    expect(start().shortlist).toEqual([])
    const again = startSession({
      character: 'mira',
      keywords: [],
      current: voice('a'),
      candidates: candidates('a', 'b'),
      perRound: 3,
    })
    expect([again.shortlist, again.toHear]).toEqual([['a'], ['b']])
  })
})

describe('shortlist and unlist', () => {
  it('moves a voice to the end of the shortlist, and back to the front of the voices to hear', () => {
    const listed = shortlist(start(voice('cur')), 'b')
    expect([listed.shortlist, listed.toHear]).toEqual([
      ['cur', 'b'],
      ['a', 'c'],
    ])
    const back = unlist(listed, 'b')
    expect([back.shortlist, back.toHear]).toEqual([['cur'], ['b', 'a', 'c']])
  })

  it('leaves the session as it is for a voice not where it would move from', () => {
    const session = start()
    expect(shortlist(session, 'f')).toBe(session)
    expect(unlist(session, 'a')).toBe(session)
  })
})

describe('drop and undo', () => {
  it('takes a voice off the board, and the last drop can be undone to where it was', () => {
    let session = shortlist(start(), 'a')
    session = drop(session, 'b')
    session = drop(session, 'a')
    expect([session.shortlist, session.toHear]).toEqual([[], ['c']])
    expect(session.dropped).toEqual([
      { id: 'b', from: 'toHear' },
      { id: 'a', from: 'shortlist' },
    ])
    session = undoDrop(session)
    expect([session.shortlist, session.toHear, session.dropped]).toEqual([
      ['a'],
      ['c'],
      [{ id: 'b', from: 'toHear' }],
    ])
    session = undoDrop(session)
    expect(session.toHear).toEqual(['b', 'c'])
    expect(undoDrop(session)).toBe(session)
  })

  it('leaves the session as it is for a voice not on the board', () => {
    const session = start()
    expect(drop(session, 'f')).toBe(session)
  })
})

describe('more voices', () => {
  it('brings in the next candidates from the queue', () => {
    const session = bringMore(start(), 2)
    expect(session.toHear).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(session.queue).toEqual(['f'])
    expect(bringMore(bringMore(session, 5), 5).queue).toEqual([])
  })

  it('queues new candidates, leaving out every voice the audition has seen', () => {
    const session = drop(start(voice('cur')), 'a')
    const next = queueMore(session, candidates('a', 'cur', 'd', 'g'))
    expect(next.queue).toEqual(['d', 'e', 'f', 'g'])
    expect(next.voices.g?.title).toBe('G')
    expect(queueMore(next, candidates('a'))).toBe(next)
  })

  it('brings a voice in by id at the front of the voices to hear, also one dropped before', () => {
    const session = drop(start(), 'b')
    const added = addVoice(addVoice(session, voice('x')), voice('b'))
    expect(added.toHear).toEqual(['b', 'x', 'a', 'c'])
    expect(added.dropped).toEqual([])
    const queued = addVoice(start(), voice('e'))
    expect([queued.toHear, queued.queue]).toEqual([
      ['e', 'a', 'b', 'c'],
      ['d', 'f'],
    ])
    expect(addVoice(queued, voice('a'))).toBe(queued)
  })
})

describe('what an audition has cost', () => {
  const fresh = startSession({
    character: 'mara',
    keywords: [],
    current: null,
    candidates: [],
    perRound: 5,
  })

  it('starts at nothing, and a saved session without the figure reads as nothing', () => {
    expect(fresh.spent).toBe(0)
    const { spent: _spent, ...older } = fresh
    expect(AuditionSessionSchema.parse(older).spent).toBe(0)
  })

  it('adds up what takes were charged', () => {
    expect(addSpent(addSpent(fresh, 0.01), 0.02).spent).toBeCloseTo(0.03, 12)
    expect(addSpent(fresh, 0)).toBe(fresh)
  })
})

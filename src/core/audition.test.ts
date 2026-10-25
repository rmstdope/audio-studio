import { describe, expect, it } from 'bun:test'
import {
  addVoice,
  bringMore,
  drop,
  queueMore,
  setOwnVoices,
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

const mine = (id: string): Voice => ({ ...voice(id), own: true })

describe('your own voices', () => {
  it('puts every own voice in Your voices, whatever the keywords, marked as own', () => {
    const session = setOwnVoices(start(), [mine('m1'), mine('m2')])
    expect(session.yours).toEqual(['m1', 'm2'])
    expect(session.mine).toEqual(['m1', 'm2'])
    expect(session.voices.m1?.own).toBe(true)
    expect(session.matched.m1).toBeUndefined()
  })

  it('moves an own voice found by the search out of To hear and the queue', () => {
    const session = setOwnVoices(start(), [mine('a'), mine('e')])
    expect(session.yours).toEqual(['a', 'e'])
    expect(session.toHear).toEqual(['b', 'c'])
    expect(session.queue).toEqual(['d', 'f'])
  })

  it('leaves alone an own voice shortlisted or dropped, and is idempotent', () => {
    let session = start()
    session = setOwnVoices(session, [mine('m1'), mine('m2'), mine('m3')])
    session = shortlist(session, 'm1')
    session = drop(session, 'm2')
    const again = setOwnVoices(session, [mine('m1'), mine('m2'), mine('m3'), mine('m4')])
    expect(again.yours).toEqual(['m3', 'm4'])
    expect(again.shortlist).toEqual(['m1'])
    expect(again.voices.m1?.own).toBe(true)
    expect(setOwnVoices(again, [mine('m1'), mine('m2'), mine('m3'), mine('m4')])).toBe(again)
  })

  it('keeps an own voice ruled out in an earlier audition out of Your voices', () => {
    const session = setOwnVoices(start(), [mine('m1'), mine('m2')], ['m1'])
    expect(session.yours).toEqual(['m2'])
    expect(session.mine).toEqual(['m1', 'm2'])
  })

  it('marks the current voice as own without moving it off the shortlist', () => {
    const session = setOwnVoices(start(voice('cur')), [mine('cur'), mine('m1')])
    expect(session.shortlist).toEqual(['cur'])
    expect(session.yours).toEqual(['m1'])
    expect(session.voices.cur?.own).toBe(true)
  })

  it('shortlists from Your voices, unlists back to it, and drops and undoes there', () => {
    const base = setOwnVoices(start(), [mine('m1'), mine('m2')])
    const listed = shortlist(base, 'm2')
    expect([listed.yours, listed.shortlist]).toEqual([['m1'], ['m2']])
    const unlisted = unlist(listed, 'm2')
    expect(unlisted.yours).toEqual(['m2', 'm1'])
    expect(unlisted.toHear).toEqual(['a', 'b', 'c'])
    const dropped = drop(base, 'm1')
    expect(dropped.yours).toEqual(['m2'])
    expect(dropped.dropped).toEqual([{ id: 'm1', from: 'yours' }])
    expect(undoDrop(dropped).yours).toEqual(['m1', 'm2'])
  })

  it('brings an own voice in by id into Your voices', () => {
    const base = setOwnVoices(start(), [mine('m1')])
    const dropped = drop(base, 'm1')
    const added = addVoice(dropped, voice('m1'))
    expect(added.yours).toEqual(['m1'])
    expect(added.voices.m1?.own).toBe(true)
    expect(added.dropped).toEqual([])
  })

  it('reads a saved session from before Your voices existed', () => {
    const { yours: _y, mine: _m, ...old } = start()
    const parsed = AuditionSessionSchema.parse(old)
    expect([parsed.yours, parsed.mine]).toEqual([[], []])
  })
})

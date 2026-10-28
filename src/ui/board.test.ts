import { describe, expect, it } from 'bun:test'
import {
  castEffects,
  droppedRuledOut,
  ownSectionState,
  playsVoice,
  designFailureLine,
  recordable,
  saveFailedLine,
  freeEffects,
  slotWaiters,
  slotsLine,
  sampleClip,
  stopEffects,
  stopEffectsFor,
  takeClip,
  takesToRecord,
  undoFor,
  takeWaits,
  waitingForCredits,
} from './board'

describe('takesToRecord', () => {
  it('records the voices shown without a take, once, and not again after it failed', () => {
    expect(
      takesToRecord(['a', 'b', 'c', 'd'], { a: 'k1' }, new Set(['b']), { c: 'Fish is busy' }),
    ).toEqual(['d'])
  })
})

const titles = new Map([
  ['act1', 'Act I'],
  ['act3', 'Act III'],
])

describe('castEffects in a language', () => {
  it('names the language, and uses the sentence about its stale lines', () => {
    expect(
      castEffects({
        name: 'Grandmother',
        current: 'Varm Mormor',
        replacing: true,
        recorded: [{ part: 'act1', lines: 18 }],
        titles,
        dropped: 0,
        unheard: 0,
        language: 'Svenska',
        stale: '18 Svenska lines go stale and need recording again: Act I 18.',
      }),
    ).toEqual([
      '18 Svenska lines go stale and need recording again: Act I 18.',
      'Varm Mormor is no longer Grandmother’s Svenska voice. It is not ruled out: it can come back in a later audition.',
      'The audition ends.',
    ])
  })

  it('leaves the stale sentence out when nothing is recorded', () => {
    expect(
      castEffects({
        name: 'Grandmother',
        current: null,
        replacing: true,
        recorded: [],
        titles,
        dropped: 0,
        unheard: 0,
        language: 'Svenska',
        stale: null,
      }),
    ).toEqual(['The audition ends.'])
  })
})

describe('castEffects', () => {
  it('says which recorded lines go stale, that the old voice is not ruled out, and how the audition ends', () => {
    expect(
      castEffects({
        name: 'Grandmother',
        current: 'Gentle Granny',
        replacing: true,
        recorded: [
          { part: 'act1', lines: 26 },
          { part: 'act3', lines: 9 },
        ],
        titles,
        dropped: 3,
        unheard: 6,
      }),
    ).toEqual([
      '35 recorded lines go stale (Act I: 26, Act III: 9). They record again the next time you generate.',
      'Gentle Granny is no longer Grandmother’s voice. It is not ruled out: it can come back in a later audition.',
      'The audition ends. The 3 voices you dropped stay ruled out; the 6 still to hear or waiting are not.',
    ])
  })

  it('does not end an audition when none is going on', () => {
    expect(
      castEffects({
        name: 'Mira',
        current: 'Old Sage',
        replacing: true,
        recorded: [],
        titles,
        dropped: 0,
        unheard: 0,
        auditioning: false,
      }),
    ).toEqual([
      'Old Sage is no longer Mira’s voice. It is not ruled out: it can come back in a later audition.',
    ])
  })

  it('leaves out what does not apply to a character without a voice or lines', () => {
    expect(
      castEffects({
        name: 'Mira',
        current: null,
        replacing: false,
        recorded: [],
        titles,
        dropped: 0,
        unheard: 4,
      }),
    ).toEqual(['The audition ends.'])
  })
})

describe('stopEffects', () => {
  it('says the cast stays, what stays ruled out, and what is let go', () => {
    expect(
      stopEffects({
        name: 'Grandmother',
        current: 'Gentle Granny',
        lines: 35,
        dropped: 3,
        shortlisted: 1,
      }),
    ).toEqual([
      'Nothing changes in the cast: Grandmother keeps Gentle Granny.',
      'The 3 voices you dropped stay ruled out. You can allow them again from the list of ruled-out voices.',
      'The shortlist (1 voice) is let go: shortlisted and unheard voices can turn up again next time.',
    ])
  })

  it('says a character without a voice stays uncast', () => {
    expect(
      stopEffects({ name: 'The Miller', current: null, lines: 14, dropped: 1, shortlisted: 0 }),
    ).toEqual([
      'The Miller stays uncast: 14 lines cannot be recorded until it has a voice.',
      'The voice you dropped stays ruled out. You can allow it again from the list of ruled-out voices.',
    ])
  })
})

describe('castEffects, keeping the voice', () => {
  it('says the old voice goes by whether it is replaced, not by its title', () => {
    const effects = (replacing: boolean) =>
      castEffects({
        name: 'Mira',
        current: 'Narrator',
        replacing,
        recorded: [],
        titles,
        dropped: 1,
        unheard: 0,
      })
    expect(effects(true)[0]).toBe(
      'Narrator is no longer Mira’s voice. It is not ruled out: it can come back in a later audition.',
    )
    expect(effects(false)).toEqual(['The audition ends. The voice you dropped stays ruled out.'])
  })
})

describe('stopEffects, without lines', () => {
  it('says only that a character with no voice stays uncast', () => {
    expect(
      stopEffects({ name: 'Mira', current: null, lines: 0, dropped: 0, shortlisted: 0 }),
    ).toEqual(['Mira stays uncast.'])
  })
})

describe('droppedRuledOut', () => {
  it('gives the voices dropped in the audition that are still ruled out, never the cast one', () => {
    const dropped = [
      { id: 'a', from: 'toHear' as const },
      { id: 'b', from: 'toHear' as const },
      { id: 'cur', from: 'shortlist' as const },
    ]
    expect(droppedRuledOut(dropped, ['b', 'z'], 'cur')).toEqual(['b'])
    expect(droppedRuledOut(dropped, null, 'cur')).toEqual(['a', 'b'])
  })
})

describe('undoFor', () => {
  it('offers to undo the drop this page made, while it is the last one', () => {
    const dropped = [
      { id: 'a', from: 'toHear' as const },
      { id: 'b', from: 'shortlist' as const },
    ]
    expect(undoFor('b', dropped)).toBe('b')
    expect(undoFor('a', dropped)).toBeNull()
    expect(undoFor(null, dropped)).toBeNull()
    expect(undoFor('b', [])).toBeNull()
  })
})

describe('stopEffectsFor', () => {
  it('says what stopping an audition does, from the session and the ruled-out voices', () => {
    const session = {
      current: 'cur',
      shortlist: ['cur', 'b'],
      dropped: [
        { id: 'a', from: 'toHear' as const },
        { id: 'c', from: 'toHear' as const },
      ],
      voices: { cur: { title: 'Gentle Granny' } },
    }
    expect(stopEffectsFor(session, { name: 'Grandmother', lines: 3, ruledOut: ['a'] })).toEqual(
      stopEffects({
        name: 'Grandmother',
        current: 'Gentle Granny',
        lines: 3,
        dropped: 1,
        shortlisted: 1,
      }),
    )
  })
})

describe('playsVoice', () => {
  it('tells whether what plays is the take or the sample of a voice', () => {
    expect(playsVoice(takeClip('v1'), 'v1')).toBe(true)
    expect(playsVoice(sampleClip('v1'), 'v1')).toBe(true)
    expect(playsVoice(takeClip('v12'), 'v1')).toBe(false)
    expect(playsVoice(sampleClip('v2'), 'v1')).toBe(false)
    expect(takeClip('v1')).not.toBe(sampleClip('v1'))
    expect(playsVoice(null, 'v1')).toBe(false)
  })
})

describe('ownSectionState', () => {
  const some = { yours: ['m1'], mine: ['m1'] }
  it('waits for Fish before the first answer, and shows the voices meanwhile if it has them', () => {
    expect(ownSectionState({ yours: [], mine: [] }, { fetched: false, error: null })).toBe(
      'loading',
    )
    // On a resume too: the earlier fetch's voices wait for Fish's answer, as the acceptance says.
    expect(ownSectionState(some, { fetched: false, error: null })).toBe('loading')
  })
  it('says the account has none once Fish answered with none', () => {
    expect(ownSectionState({ yours: [], mine: [] }, { fetched: true, error: null })).toBe('none')
  })
  it('says all are used up when the account has voices and none is left to hear', () => {
    expect(ownSectionState({ yours: [], mine: ['m1'] }, { fetched: true, error: null })).toBe(
      'allUsed',
    )
    expect(ownSectionState({ yours: [], mine: ['m1'] }, { fetched: false, error: null })).toBe(
      'loading',
    )
  })
  it('shows the voices, and the error, when Fish could not be asked again', () => {
    expect(ownSectionState(some, { fetched: true, error: 'down' })).toBe('cards')
    expect(ownSectionState({ yours: [], mine: [] }, { fetched: false, error: 'down' })).toBe(
      'error',
    )
  })
})

describe('recordable', () => {
  it('leaves out designed voices: their preview is their take, kept when they were made', () => {
    const designed = { design: { n: 1, description: 'd', at: 't' } }
    const session = {
      shortlist: ['s', 'd1'],
      yours: ['y'],
      toHear: ['h'],
      designed: ['d2'],
      voices: { d1: designed, d2: designed },
    }
    expect(recordable(session as never, true)).toEqual(['s', 'y', 'h'])
  })

  const mixed = {
    shortlist: ['eleven:s'],
    yours: [],
    toHear: ['h', 'eleven:h'],
    designed: [],
    voices: {},
  }

  it('leaves out ElevenLabs voices while the audition has no credits for them', () => {
    expect(recordable(mixed as never, false)).toEqual(['h'])
  })

  it('takes in ElevenLabs voices once it has', () => {
    expect(recordable(mixed as never, true)).toEqual(['eleven:s', 'h', 'eleven:h'])
  })
})

describe('waitingForCredits', () => {
  it('counts the ElevenLabs voices on the board that have no take', () => {
    const session = {
      shortlist: ['eleven:s'],
      yours: [],
      toHear: ['h', 'eleven:h', 'eleven:t'],
      designed: [],
      voices: {},
    }
    expect(waitingForCredits(session as never, { 'eleven:t': 'k' })).toEqual([
      'eleven:s',
      'eleven:h',
    ])
  })
})

describe('castEffects for a designed voice', () => {
  it('says it is saved to the Fish account first', () => {
    const effects = castEffects({
      name: 'Mara',
      current: null,
      replacing: true,
      recorded: [],
      titles: new Map(),
      dropped: 0,
      unheard: 0,
      saves: true,
    })
    expect(effects[0]).toBe(
      'It is saved to your Fish account first, as a private voice named “Mara (designed)” (“Mara (designed 2)” and so on if that name is taken).',
    )
  })
})

describe('castEffects for a library voice not yet added', () => {
  it('says it is added to the ElevenLabs voices first, using a slot', () => {
    const effects = castEffects({
      name: 'Mara',
      current: null,
      replacing: true,
      recorded: [],
      titles: new Map(),
      dropped: 0,
      unheard: 0,
      adds: true,
    })
    expect(effects[0]).toBe(
      'It is added to your ElevenLabs voices first, using one of your plan’s voice slots.',
    )
  })
})

describe('saveFailedLine', () => {
  it('gives ElevenLabs’ reason for a library voice it would not add', () => {
    expect(saveFailedLine('You have reached your voice limit.', 'elevenlabs')).toBe(
      'ElevenLabs couldn’t add this voice: You have reached your voice limit. It wasn’t cast.',
    )
  })

  it('gives Fish’s reason and says the voice was not cast', () => {
    expect(saveFailedLine('Audio too short.')).toBe(
      'Fish couldn’t save this voice: Audio too short. It wasn’t cast.',
    )
  })
})

describe('designFailureLine', () => {
  it('says nothing was charged only when Fish refused', () => {
    expect(designFailureLine({ reason: 'fish', message: 'Too busy.' })).toBe(
      'Fish couldn’t design voices: Too busy. Nothing was charged.',
    )
  })

  it('says Fish may have charged when the studio failed after asking', () => {
    expect(designFailureLine({ reason: 'failed', message: 'ffmpeg is needed' })).toBe(
      'The voices weren’t kept: ffmpeg is needed. Fish may have charged $0.01.',
    )
  })

  it('gives the studio’s own reasons as they are, without blaming Fish', () => {
    for (const reason of ['confirm', 'credit', 'invalid', 'no-key', 'no-phrase']) {
      expect(designFailureLine({ reason, message: 'Say it.' })).toBe('Say it.')
    }
    expect(designFailureLine({ ok: false } as never)).toBe('The project’s files need fixing.')
  })
})

describe('takeWaits', () => {
  const none = new Set<string>()
  it('an ElevenLabs voice without a take waits for credits while the audition has none', () => {
    expect(takeWaits('eleven:g', { credits: false, waiting: none, take: false })).toBe('credits')
    expect(takeWaits('eleven:g', { credits: false, waiting: none, take: true })).toBeUndefined()
    expect(takeWaits('eleven:g', { credits: true, waiting: none, take: false })).toBeUndefined()
  })
  it('a voice the server made wait waits for more of its own money', () => {
    const waiting = new Set(['eleven:g', 'f'])
    expect(takeWaits('eleven:g', { credits: true, waiting, take: false })).toBe('more-credits')
    expect(takeWaits('f', { credits: false, waiting, take: false })).toBe('money')
  })
})

describe('voice slots', () => {
  const lib = (added: boolean) => ({ library: { owner: 'o', added } })
  const session = {
    shortlist: ['eleven:a'],
    yours: [],
    toHear: ['eleven:b', 'eleven:c', 'eleven:d', 'f'],
    designed: [],
    voices: {
      'eleven:a': lib(false),
      'eleven:b': lib(true),
      'eleven:c': lib(false),
      'eleven:d': lib(false),
    },
  }

  it('makes the library voices a take would add wait beyond the slots left, in board order', () => {
    expect([...slotWaiters(session as never, {}, 1)]).toEqual(['eleven:c', 'eleven:d'])
    // A voice with a take was added already: it takes no slot.
    expect([...slotWaiters(session as never, { 'eleven:a': 'k' }, 1)]).toEqual(['eleven:d'])
    expect([...slotWaiters(session as never, {}, 0)]).toEqual(['eleven:a', 'eleven:c', 'eleven:d'])
    // Unknown slots: nothing waits; ElevenLabs refuses at its limit anyway.
    expect([...slotWaiters(session as never, {}, null)]).toEqual([])
  })

  it('leaves the voices that wait for a slot out of the voices to record', () => {
    const waiting = slotWaiters(session as never, {}, 1)
    expect(recordable(session as never, true, waiting)).toEqual(['eleven:a', 'eleven:b', 'f'])
  })

  it('says a take waits for a free slot once it has credits', () => {
    const none = new Set<string>()
    expect(takeWaits('eleven:c', { credits: true, waiting: none, take: false, slot: true })).toBe(
      'slot',
    )
    expect(takeWaits('eleven:c', { credits: false, waiting: none, take: false, slot: true })).toBe(
      'credits',
    )
  })

  it('says how many slots are used, and when all are', () => {
    expect(slotsLine({ used: 8, limit: 10 })).toBe('ElevenLabs voice slots: 8 of 10 used')
    expect(slotsLine({ used: 10, limit: 10 })).toBe(
      'All 10 ElevenLabs voice slots are used: takes that would add a library voice wait until one is free.',
    )
  })

  it('names the voices freeing removes, and what it does not touch', () => {
    expect(
      freeEffects([
        { voice: 'eleven:a', name: 'Gravel', character: 'wizard' },
        { voice: 'eleven:b', name: 'Brook', character: 'gran' },
      ]),
    ).toEqual([
      'Removes Gravel and Brook from your ElevenLabs voices. The studio added them in auditions; neither is cast or on an audition in progress.',
      'Their takes are kept. A voice removed can be found in the library and added again.',
      'Voices you added on ElevenLabs yourself are never removed.',
    ])
    expect(freeEffects([{ voice: 'eleven:a', name: 'Gravel', character: 'wizard' }])[0]).toBe(
      'Removes Gravel from your ElevenLabs voices. The studio added it in an audition; it is not cast or on an audition in progress.',
    )
  })
})

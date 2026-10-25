import { describe, expect, it } from 'bun:test'
import { projectJson } from '../../test/helpers'
import { clipInputs, fingerprint } from './fingerprint'
import { adoptUntracked, planPart, type PlanInput } from './planner'
import { ProjectSchema } from './project'
import type { Cast, Line, LockEntry } from './resources'

const narration = ProjectSchema.parse(projectJson()).narration

const lines: Line[] = [
  { key: 'n1', speaker: 'narrator', text: 'Elior wakes.' },
  { key: 'm1', speaker: 'mira', text: 'Welcome, child.' },
  { key: 't1', speaker: 'tilda', text: 'Have you heard?' },
]

const cast: Cast = {
  speakers: {
    narrator: { voice: 'v-narrator', style: '[warm]' },
    mira: { voice: 'v-mira', style: '[low, calm]' },
  },
  pronounce: {},
}

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    lines,
    cast,
    cues: {},
    lock: {},
    manifest: {
      n1: { file: 'n1.mp3', speaker: 'narrator', duration: 2.5 },
      m1: { file: 'm1.mp3', speaker: 'mira', duration: 1.5 },
    },
    files: new Set(['n1.mp3', 'm1.mp3']),
    narration,
    ...overrides,
  }
}

/** The lock entry a clip of `line` made with today's inputs would have. */
function entryFor(line: Line, theCast: Cast = cast, extra: Partial<LockEntry> = {}): LockEntry {
  const inputs = clipInputs(line, theCast.speakers[line.speaker], {}, theCast.pronounce, narration)!
  const { fp, parts } = fingerprint(inputs)
  return { fp, voice: inputs.voice, model: inputs.model, parts, at: 'then', ...extra }
}

const trackedLock = { n1: entryFor(lines[0]!), m1: entryFor(lines[1]!) }

function statuses(state: ReturnType<typeof planPart>) {
  return Object.fromEntries(state.lines.map((l) => [l.key, l.status]))
}

describe('planPart', () => {
  it('marks clips matching their inputs ok, and a speaker without a voice uncast', () => {
    const state = planPart(input({ lock: trackedLock }))
    expect(statuses(state)).toEqual({ n1: 'ok', m1: 'ok', t1: 'uncast' })
    expect(state.counts).toMatchObject({ ok: 2, uncast: 1, stale: 0 })
    expect(state.lines[0]).toMatchObject({ cue: '[warm]', duration: 2.5, file: 'n1.mp3' })
  })

  it('marks clips nothing knows the inputs of as untracked', () => {
    expect(statuses(planPart(input()))).toMatchObject({ n1: 'untracked', m1: 'untracked' })
  })

  it('marks a line without a clip, or whose file is gone, as missing', () => {
    const state = planPart(input({ lock: trackedLock, files: new Set(['n1.mp3']) }))
    expect(statuses(state)).toMatchObject({ n1: 'ok', m1: 'missing' })
    expect(state.lines[1]).toMatchObject({ file: null, duration: null })
  })

  it('names a changed voice', () => {
    const recast: Cast = {
      ...cast,
      speakers: { ...cast.speakers, mira: { voice: 'v-new', style: '[low, calm]' } },
    }
    const state = planPart(input({ lock: trackedLock, cast: recast }))
    expect(state.lines[1]).toMatchObject({ status: 'stale', reasons: ['voice'] })
    expect(state.lines[0]!.status).toBe('ok')
  })

  it('names a line cue that replaces the style', () => {
    const state = planPart(input({ lock: trackedLock, cues: { n1: '[hushed]' } }))
    expect(state.lines[0]).toMatchObject({ status: 'stale', reasons: ['cue'], cue: '[hushed]' })
  })

  it('makes a pronunciation stale only the lines that contain it', () => {
    const said: Cast = { ...cast, pronounce: { Elior: 'El-ee-or' } }
    const state = planPart(input({ lock: trackedLock, cast: said }))
    expect(state.lines[0]).toMatchObject({ status: 'stale', reasons: ['pronunciation'] })
    expect(state.lines[1]!.status).toBe('ok')
  })

  it('speaks a character at its own speed, a change of which is a settings change', () => {
    const quick: Cast = {
      ...cast,
      speakers: { ...cast.speakers, mira: { ...cast.speakers.mira, speed: 1.2 } },
    }
    const state = planPart(input({ lock: trackedLock, cast: quick }))
    expect(state.lines[1]).toMatchObject({ status: 'stale', reasons: ['settings'] })
    expect(state.lines[0]!.status).toBe('ok')
  })

  it('names changed generation settings', () => {
    const slower = { ...narration, tts: { ...narration.tts, speed: 0.9 } }
    const state = planPart(input({ lock: trackedLock, narration: slower }))
    expect(state.lines[0]).toMatchObject({ status: 'stale', reasons: ['settings'] })
  })

  it('marks an up-to-date clip heard below the bar as weak', () => {
    const lock = { ...trackedLock, n1: entryFor(lines[0]!, cast, { heard: 0.8 }) }
    const state = planPart(input({ lock }))
    expect(state.lines[0]).toMatchObject({ status: 'weak', heard: 0.8 })
  })

  it('takes a weak clip the user accepted as ok, saying it was accepted', () => {
    const lock = { ...trackedLock, n1: entryFor(lines[0]!, cast, { heard: 0.8, accepted: true }) }
    const state = planPart(input({ lock }))
    expect(state.lines[0]).toMatchObject({ status: 'ok', heard: 0.8, accepted: true })
    expect(state.lines[1]).toMatchObject({ status: 'ok', accepted: false })
    expect(state.counts.weak).toBe(0)
  })

  it('says a clip was accepted only while it is up to date', () => {
    const slower = { ...narration, tts: { ...narration.tts, speed: 0.9 } }
    const lock = { ...trackedLock, n1: entryFor(lines[0]!, cast, { heard: 0.8, accepted: true }) }
    const state = planPart(input({ lock, narration: slower }))
    expect(state.lines[0]).toMatchObject({ status: 'stale', accepted: false })
  })

  it('lists clips and cues whose line left the dialog', () => {
    const state = planPart(
      input({
        manifest: { ...input().manifest, old: { file: 'old.mp3', speaker: 'mira' } },
        cues: { gone: '[soft]', n1: '[warm]' },
      }),
    )
    expect(state.orphans).toEqual([{ key: 'old', speaker: 'mira', file: 'old.mp3' }])
    expect(state.orphanCues).toEqual([{ key: 'gone', cue: '[soft]' }])
  })
})

describe('planPart, orphaned cues', () => {
  it('lists them in the cues file’s order, as the user sees it there', () => {
    const state = planPart(input({ cues: { zz: '[a]', n1: '[warm]', gone: '[b]' } }))
    expect(state.orphanCues.map((c) => c.key)).toEqual(['zz', 'gone'])
  })
})

describe('adoptUntracked', () => {
  it('takes untracked clips as made from today’s inputs, leaving the rest alone', () => {
    const existing = { n1: entryFor(lines[0]!, cast, { heard: 0.95 }) }
    const { lock, adopted } = adoptUntracked(input({ lock: existing }), '2026-10-23T12:00:00Z')
    expect(adopted).toBe(1)
    expect(lock.n1).toEqual(existing.n1)
    expect(lock.m1).toMatchObject({ voice: 'v-mira', adopted: true, at: '2026-10-23T12:00:00Z' })
    expect(lock.t1).toBeUndefined()
    expect(statuses(planPart(input({ lock })))).toEqual({ n1: 'ok', m1: 'ok', t1: 'uncast' })
  })
})

describe('planPart, cues', () => {
  it('tells a line’s own cue from its character’s style', () => {
    const state = planPart(input({ cues: { m1: '[sad]' } }))
    expect(state.lines.find((l) => l.key === 'm1')).toMatchObject({ cue: '[sad]', ownCue: true })
    expect(state.lines.find((l) => l.key === 'n1')).toMatchObject({ cue: '[warm]', ownCue: false })
  })

  it('takes a key named like an object property for a line key, not a cue', () => {
    const odd: Line[] = [
      { key: 'toString', speaker: 'narrator', text: 'One.' },
      { key: 'constructor', speaker: 'narrator', text: 'Two.' },
    ]
    const state = planPart(input({ lines: odd, manifest: {}, files: new Set() }))
    for (const line of state.lines) expect(line).toMatchObject({ cue: '[warm]', ownCue: false })
  })
})

describe('planPart, clips made with the final model', () => {
  const withFinal = { ...narration, models: { ...narration.models, final: 's2-pro' } }
  /** A lock entry for `line` as made with `model`. */
  function madeWith(line: Line, model: string): LockEntry {
    const inputs = clipInputs(
      line,
      cast.speakers[line.speaker],
      {},
      cast.pronounce,
      withFinal,
      model,
    )!
    const { fp, parts } = fingerprint(inputs)
    return { fp, voice: inputs.voice, model, parts, at: 'then' }
  }

  it('counts a final clip as up to date, and says it is final', () => {
    const lock = { n1: madeWith(lines[0]!, 's2-pro'), m1: madeWith(lines[1]!, 's2.1-pro-free') }
    const state = planPart(input({ lock, narration: withFinal }))
    expect(state.lines[0]).toMatchObject({ status: 'ok', final: true })
    expect(state.lines[1]).toMatchObject({ status: 'ok', final: false })
  })

  it('knows no final clip while final and draft are the same model', () => {
    const state = planPart(input({ lock: trackedLock }))
    expect(state.lines[0]).toMatchObject({ status: 'ok', final: false })
  })

  it('finds a final clip stale when its inputs change', () => {
    const lock = { n1: madeWith(lines[0]!, 's2-pro') }
    const state = planPart(input({ lock, narration: withFinal, cues: { n1: '[sad]' } }))
    // Stale for its cue only: the final model is still a model it may be made with.
    expect(state.lines[0]).toMatchObject({ status: 'stale', final: false, reasons: ['cue'] })
  })
})

describe('planPart, a weak final clip', () => {
  it('is weak and final', () => {
    const withFinal = { ...narration, models: { ...narration.models, final: 's2-pro' } }
    const inputs = clipInputs(
      lines[0]!,
      cast.speakers.narrator,
      {},
      cast.pronounce,
      withFinal,
      's2-pro',
    )!
    const { fp, parts } = fingerprint(inputs)
    const lock = { n1: { fp, voice: inputs.voice, model: 's2-pro', parts, at: 'then', heard: 0.5 } }
    expect(planPart(input({ lock, narration: withFinal })).lines[0]).toMatchObject({
      status: 'weak',
      final: true,
    })
  })
})

describe('planPart in a language besides the source', () => {
  const source: Line[] = lines
  const swedish: Line[] = [
    { key: 'm1', speaker: 'mira', text: 'Välkommen, barn.' },
    { key: 'x1', speaker: 'narrator', text: 'Bara på svenska.' },
    { key: 'n1', speaker: 'narrator', text: 'Elior vaknar.' },
  ]

  it('lists the source order, with untranslated lines and lines only here', () => {
    const state = planPart(input({ lines: swedish, source }))
    expect(state.lines.map((l) => l.key)).toEqual(['n1', 'm1', 't1', 'x1'])
    expect(statuses(state)).toEqual({
      n1: 'untracked',
      m1: 'untracked',
      t1: 'untranslated',
      x1: 'missing',
    })
  })

  it('carries the source text beside the language’s own, and null where there is none', () => {
    const state = planPart(input({ lines: swedish, source }))
    const by = Object.fromEntries(state.lines.map((l) => [l.key, l]))
    expect(by.m1).toMatchObject({ text: 'Välkommen, barn.', english: 'Welcome, child.' })
    expect(by.t1).toMatchObject({ text: '', english: 'Have you heard?', speaker: 'tilda' })
    expect(by.x1).toMatchObject({ text: 'Bara på svenska.', english: null })
  })

  it('counts untranslated lines, and a line with blank text is one', () => {
    const blank = swedish.map((l) => (l.key === 'n1' ? { ...l, text: '  ' } : l))
    const state = planPart(input({ lines: blank, source }))
    expect(state.counts.untranslated).toBe(2)
    expect(state.lines.find((l) => l.key === 'n1')).toMatchObject({
      status: 'untranslated',
      file: null,
      duration: null,
      heard: null,
    })
  })

  it('leaves the source language as it was: no english, no untranslated', () => {
    const state = planPart(input({ lock: trackedLock }))
    expect(state.lines.every((l) => l.english === null)).toBe(true)
    expect(state.counts.untranslated).toBe(0)
  })
})

describe('planPart, a blank source line', () => {
  it('is no gap in a translation, unless the language has the line', () => {
    const source: Line[] = [
      { key: 'b1', speaker: 'narrator', text: '' },
      { key: 'b2', speaker: 'narrator', text: '' },
    ]
    const state = planPart(
      input({ lines: [{ key: 'b2', speaker: 'narrator', text: 'Ja.' }], source }),
    )
    expect(state.lines.map((l) => [l.key, l.english])).toEqual([['b2', '']])
    expect(state.counts.untranslated).toBe(0)
  })
})

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

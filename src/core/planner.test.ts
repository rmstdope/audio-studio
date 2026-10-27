import { describe, expect, it } from 'bun:test'
import { projectJson } from '../../test/helpers'
import { clipInputs, cueInputs, fingerprint } from './fingerprint'
import { mergeCues } from './cued'
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
function entryFor(
  line: Line,
  theCast: Cast = cast,
  extra: Partial<LockEntry> = {},
  cues: Record<string, string> = {},
): LockEntry {
  const inputs = clipInputs(
    line,
    theCast.speakers[line.speaker],
    cues,
    theCast.pronounce,
    narration,
  )!
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

  it('lists no orphan while the dialog is held (unreadable or gone)', () => {
    const state = planPart(
      input({
        held: true,
        manifest: { ...input().manifest, old: { file: 'old.mp3', speaker: 'mira' } },
        cues: { gone: '[soft]' },
      }),
    )
    expect([state.orphans, state.orphanCues]).toEqual([[], []])
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
    expect(state.lines.find((l) => l.key === 'm1')).toMatchObject({ cue: '[sad]', cueFrom: 'own' })
    expect(state.lines.find((l) => l.key === 'n1')).toMatchObject({
      cue: '[warm]',
      cueFrom: 'style',
    })
  })

  it('takes a key named like an object property for a line key, not a cue', () => {
    const odd: Line[] = [
      { key: 'toString', speaker: 'narrator', text: 'One.' },
      { key: 'constructor', speaker: 'narrator', text: 'Two.' },
    ]
    const state = planPart(input({ lines: odd, manifest: {}, files: new Set() }))
    for (const line of state.lines) expect(line).toMatchObject({ cue: '[warm]', cueFrom: 'style' })
  })
})

describe('planPart, cues in a language besides the source', () => {
  const source: Line[] = lines
  const swedish: Line[] = [
    { key: 'n1', speaker: 'narrator', text: 'Elior vaknar.' },
    { key: 'm1', speaker: 'mira', text: 'Välkommen, barn.' },
  ]

  it('follows the source line’s cue, then the character’s style; its own cue wins', () => {
    // `cues` is what the language is spoken with; `ownCues` the part of it the language wrote.
    const state = planPart(
      input({
        lines: swedish,
        source,
        cues: { n1: '[worried]', m1: '[sad]' },
        ownCues: { m1: '[sad]' },
      }),
    )
    const by = Object.fromEntries(state.lines.map((l) => [l.key, l]))
    expect(by.n1).toMatchObject({ cue: '[worried]', cueFrom: 'source' })
    expect(by.m1).toMatchObject({ cue: '[sad]', cueFrom: 'own' })
  })

  it('keeps the source language’s cue beside a line’s own, for the editor to show', () => {
    const state = planPart(
      input({
        lines: swedish,
        source,
        cues: { n1: '[worried]', m1: '[sad]' },
        ownCues: { m1: '[sad]' },
        sourceCues: { n1: '[worried]', m1: '[soft]' },
      }),
    )
    const by = Object.fromEntries(state.lines.map((l) => [l.key, l]))
    expect(by.n1).toMatchObject({ cueFrom: 'source', sourceCue: '[worried]' })
    expect(by.m1).toMatchObject({ cueFrom: 'own', sourceCue: '[soft]' })
    // The source language has no other language's cue to follow.
    expect(planPart(input({ cues: { m1: '[sad]' } })).lines[1]!.sourceCue).toBeNull()
  })

  it('falls back to the character’s style when neither language has a cue', () => {
    const state = planPart(input({ lines: swedish, source, ownCues: {} }))
    expect(state.lines.find((l) => l.key === 'n1')).toMatchObject({
      cue: '[warm]',
      cueFrom: 'style',
    })
  })

  it('lists only the language’s own unused cues as orphaned', () => {
    const state = planPart(
      input({ lines: swedish, source, cues: { gone: '[x]', old: '[y]' }, ownCues: { old: '[y]' } }),
    )
    expect(state.orphanCues).toEqual([{ key: 'old', cue: '[y]' }])
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

describe('planPart, clips made with s1 after the switch to s2.1-pro', () => {
  const onS1 = { ...narration, models: { ...narration.models, draft: 's1', final: 's1' } }
  const onS21 = {
    ...narration,
    models: { ...narration.models, draft: 's2.1-pro', final: 's2.1-pro' },
  }
  function madeOnS1(line: Line): LockEntry {
    const inputs = clipInputs(line, cast.speakers[line.speaker], {}, cast.pronounce, onS1)!
    const { fp, parts } = fingerprint(inputs)
    return { fp, voice: inputs.voice, model: 's1', parts, at: 'then' }
  }

  it('keeps them up to date: Fish records s1 with s2.1-pro at the same price', () => {
    const lock = { n1: madeOnS1(lines[0]!), m1: madeOnS1(lines[1]!) }
    const state = planPart(input({ lock, narration: onS21 }))
    expect(statuses(state)).toMatchObject({ n1: 'ok', m1: 'ok' })
  })

  it('still finds them stale when something else changed', () => {
    const lock = { n1: madeOnS1(lines[0]!) }
    const state = planPart(input({ lock, narration: onS21, cues: { n1: '[sad]' } }))
    expect(state.lines[0]).toMatchObject({ status: 'stale', reasons: ['cue'] })
  })

  it('finds a clip made with another model stale for the model', () => {
    const other = {
      ...narration,
      models: { ...narration.models, draft: 's2-pro', final: 's2-pro' },
    }
    const inputs = clipInputs(lines[0]!, cast.speakers.narrator, {}, cast.pronounce, other)!
    const { fp, parts } = fingerprint(inputs)
    const lock = { n1: { fp, voice: inputs.voice, model: 's2-pro', parts, at: 'then' } }
    const state = planPart(input({ lock, narration: onS21 }))
    expect(state.lines[0]).toMatchObject({ status: 'stale', reasons: ['model'] })
  })

  it('names no model reason for an s1 clip that was the final recording', () => {
    const split = {
      ...narration,
      models: { ...narration.models, draft: 's2.1-pro-free', final: 's2.1-pro' },
    }
    const wasS1 = {
      ...narration,
      models: { ...narration.models, draft: 's2.1-pro-free', final: 's1' },
    }
    const inputs = clipInputs(lines[0]!, cast.speakers.narrator, {}, cast.pronounce, wasS1, 's1')!
    const { fp, parts } = fingerprint(inputs)
    const lock = { n1: { fp, voice: inputs.voice, model: 's1', parts, at: 'then' } }
    const state = planPart(input({ lock, narration: split, cues: { n1: '[sad]' } }))
    expect(state.lines[0]).toMatchObject({ status: 'stale', reasons: ['cue'] })
  })
})

describe('planPart, scene cues', () => {
  const scened: Line[] = [
    { key: 'n1', speaker: 'narrator', text: 'Elior wakes.', scene: 'Cave' },
    { key: 'm1', speaker: 'mira', text: 'Welcome, child.', scene: 'Cave' },
    { key: 'n2', speaker: 'narrator', text: 'Light fades.', scene: 'Cave' },
    { key: 'n3', speaker: 'narrator', text: 'Morning.' },
    { key: 'n4', speaker: 'narrator', text: 'Back again.', scene: 'Cave' },
  ]
  const plan = (overrides: Partial<PlanInput> = {}) =>
    planPart(input({ lines: scened, ...overrides }))
  const by = (state: ReturnType<typeof planPart>) =>
    Object.fromEntries(state.lines.map((l) => [l.key, l]))

  it('gives a scene’s cue to the narrator’s lines, before the style', () => {
    const lines = by(plan({ cues: { 'scene:Cave': '[dark]' } }))
    expect(lines.n1).toMatchObject({
      cue: '[dark]',
      cueFrom: 'scene',
      followsScene: true,
      scene: 'Cave',
    })
    expect(lines.n3).toMatchObject({
      cue: '[warm]',
      cueFrom: 'style',
      followsScene: false,
      scene: null,
    })
  })

  it('leaves speakers the project does not name on their own cue or style', () => {
    const lines = by(plan({ cues: { 'scene:Cave': '[dark]' } }))
    expect(lines.m1).toMatchObject({ cue: '[low, calm]', cueFrom: 'style', followsScene: false })
  })

  it('lets a line’s own cue win, and follows other named speakers', () => {
    const state = plan({
      cues: { 'scene:Cave': '[dark]', n2: '[hushed]', m1: '[sad]' },
      narration: { ...narration, sceneCueSpeakers: ['narrator', 'mira'] },
    })
    const lines = by(state)
    expect(lines.n2).toMatchObject({ cue: '[hushed]', cueFrom: 'own', followsScene: false })
    expect(lines.m1).toMatchObject({ cue: '[sad]', cueFrom: 'own' })
    expect(
      by(
        plan({
          cues: { 'scene:Cave': '[dark]' },
          narration: { ...narration, sceneCueSpeakers: ['mira'] },
        }),
      ).m1?.cue,
    ).toBe('[dark]')
  })

  it('marks recorded lines stale for the cue when the scene cue changes, and ok when it goes back', () => {
    const lock = Object.fromEntries(
      scened.filter((l) => l.speaker === 'narrator').map((l) => [l.key, entryFor(l)]),
    )
    const manifest = Object.fromEntries(
      scened
        .filter((l) => l.speaker === 'narrator')
        .map((l) => [l.key, { file: `${l.key}.mp3`, speaker: 'narrator' }]),
    )
    const files = new Set(Object.values(manifest).map((c) => c.file))
    const changed = plan({ lock, manifest, files, cues: { 'scene:Cave': '[dark]' } })
    expect(by(changed).n1).toMatchObject({ status: 'stale', reasons: ['cue'] })
    expect(by(changed).n3?.status).toBe('ok')
    expect(plan({ lock, manifest, files }).counts.ok).toBe(4)
  })

  it('describes each scene: its cue, followers, recorded followers and first follower', () => {
    const lock = { n2: entryFor(scened[2]!, cast, {}, { 'scene:Cave': '[dark]' }) }
    const manifest = { n2: { file: 'n2.mp3', speaker: 'narrator' } }
    const state = plan({
      lock,
      manifest,
      files: new Set(['n2.mp3']),
      cues: { 'scene:Cave': '[dark]' },
    })
    expect(state.scenes).toEqual([
      {
        name: 'Cave',
        cue: '[dark]',
        cueFrom: 'own',
        sourceCue: null,
        lines: 4,
        following: 3,
        recordedFollowing: 1,
        firstFollowing: 'n1',
      },
    ])
    expect(plan().scenes[0]).toMatchObject({ cue: null, cueFrom: null })
  })

  it('counts only up-to-date clips as recorded followers, since a stale one is marked already', () => {
    const cues = { 'scene:Cave': '[dark]' }
    const lock = {
      n1: entryFor(scened[0]!, cast, {}, cues),
      n2: entryFor(scened[2]!, cast, { fp: 'older', voice: 'an older voice' }, cues),
    }
    const manifest = {
      n1: { file: 'n1.mp3', speaker: 'narrator' },
      n2: { file: 'n2.mp3', speaker: 'narrator' },
    }
    const state = plan({ lock, manifest, files: new Set(['n1.mp3', 'n2.mp3']), cues })
    expect(by(state).n1?.status).toBe('ok')
    expect(by(state).n2?.status).toBe('stale')
    expect(state.scenes[0]).toMatchObject({ following: 3, recordedFollowing: 1 })
  })

  it('has no scenes when the dialog names none', () => {
    expect(planPart(input()).scenes).toEqual([])
    expect(planPart(input()).lines.every((l) => l.scene === null)).toBe(true)
  })

  it('follows the source language’s scene cue until the language has its own', () => {
    const source: Line[] = scened
    const svenska: Line[] = scened.map((l) => ({ ...l, text: `sv ${l.text}`, scene: undefined }))
    const followed = by(
      planPart(
        input({
          lines: svenska,
          source,
          cues: { 'scene:Cave': '[mörkt]' },
          ownCues: {},
          sourceCues: { 'scene:Cave': '[mörkt]' },
        }),
      ),
    )
    expect(followed.n1).toMatchObject({ scene: 'Cave', cue: '[mörkt]', cueFrom: 'sceneSource' })
    const own = planPart(
      input({
        lines: svenska,
        source,
        cues: { 'scene:Cave': '[eget]' },
        ownCues: { 'scene:Cave': '[eget]' },
        sourceCues: { 'scene:Cave': '[mörkt]' },
      }),
    )
    expect(by(own).n1).toMatchObject({ cue: '[eget]', cueFrom: 'scene' })
    expect(own.scenes[0]).toMatchObject({ cueFrom: 'own', cue: '[eget]', sourceCue: '[mörkt]' })
  })

  it('lists a scene cue whose scene left the dialog as an orphan, never while held', () => {
    const cues = { 'scene:Cave': '[dark]', 'scene:Gone': '[old]', gone: '[soft]' }
    expect(plan({ cues }).orphanCues).toEqual([
      { key: 'scene:Gone', cue: '[old]' },
      { key: 'gone', cue: '[soft]' },
    ])
    expect(plan({ cues, held: true }).orphanCues).toEqual([])
  })
})

describe('planPart, cues inside a line', () => {
  const inside = '[warm] Elior [low] wakes.'

  it('keeps the opening cue in `cue`, lists the cues inside, and leaves the fingerprint alone without them', () => {
    const state = planPart(input({ lock: trackedLock, cues: { n1: '[warm]' } }))
    expect(state.lines[0]).toMatchObject({ status: 'ok', inside: [], insideStale: null })
    const placed = planPart(input({ lock: trackedLock, cues: { n1: inside } })).lines[0]!
    expect(placed).toMatchObject({
      cue: '[warm]',
      cueFrom: 'own',
      inside: [{ at: 1, cue: '[low]' }],
      insideStale: null,
      status: 'stale',
      reasons: ['cue'],
    })
  })

  it('is stale again when the cue inside changes, and ok when a clip was made with it', () => {
    const entry = (cue: string) => {
      const inputs = clipInputs(lines[0]!, cast.speakers.narrator, { n1: cue }, {}, narration)!
      const { fp, parts } = fingerprint(inputs)
      return { fp, voice: inputs.voice, model: inputs.model, parts, at: 'then' }
    }
    const lock = { ...trackedLock, n1: entry(inside) }
    expect(planPart(input({ lock, cues: { n1: inside } })).lines[0]!.status).toBe('ok')
    expect(
      planPart(input({ lock, cues: { n1: '[warm] Elior [high] wakes.' } })).lines[0]!.status,
    ).toBe('stale')
  })

  it('uses only the opening cue, and says so, when the words changed', () => {
    const state = planPart(input({ cues: { n1: '[warm] Elior [low] sleeps.' } }))
    expect(state.lines[0]).toMatchObject({
      cue: '[warm]',
      inside: [],
      insideStale: '[warm] Elior [low] sleeps.',
    })
  })

  it('shows the source line’s cues inside beside it, and records none of them', () => {
    const swedish: Line[] = [{ key: 'n1', speaker: 'narrator', text: 'Elior vaknar.' }]
    const state = planPart(
      input({
        lines: swedish,
        source: lines,
        cues: { n1: '[worried]' },
        ownCues: {},
        sourceCues: { n1: '[worried]' },
        sourceInside: { n1: [{ at: 1, cue: '[low]' }] },
      }),
    )
    expect(state.lines[0]).toMatchObject({ inside: [], sourceInside: [{ at: 1, cue: '[low]' }] })
    expect(planPart(input()).lines[0]!.sourceInside).toEqual([])
  })

  it('counts a line with cues inside and no opening cue as following its scene', () => {
    const scened: Line[] = [
      { key: 'n1', speaker: 'narrator', text: 'Light fades slowly.', scene: 'Cave' },
    ]
    const state = planPart(
      input({
        lines: scened,
        cues: { 'scene:Cave': '[dark]', n1: 'Light [hushed] fades slowly.' },
      }),
    )
    expect(state.lines[0]).toMatchObject({ cue: '[dark]', cueFrom: 'scene', followsScene: true })
    expect(state.scenes[0]).toMatchObject({ following: 1 })
  })

  it('takes a line with cues inside but no opening cue as the style’s', () => {
    const state = planPart(input({ cues: { n1: 'Elior [low] wakes.' } }))
    expect(state.lines[0]).toMatchObject({
      cue: '[warm]',
      cueFrom: 'style',
      inside: [{ at: 1, cue: '[low]' }],
    })
  })
})

describe('mergeCues', () => {
  const english: Line[] = [{ key: 'n1', speaker: 'narrator', text: 'Elior wakes.' }]
  const swedish: Line[] = [{ key: 'n1', speaker: 'narrator', text: 'Elior vaknar.' }]

  it('follows only the source’s opening cue, never its cues inside', () => {
    const merged = mergeCues(swedish, {}, { n1: '[worried] Elior [low] wakes.' }, english)
    expect(merged.sourceCues).toEqual({ n1: '[worried]' })
    expect(merged.cues).toEqual({ n1: '[worried]' })
  })

  it('lets the language’s own cues inside ride on the source’s opening cue', () => {
    const merged = mergeCues(swedish, { n1: 'Elior [low] vaknar.' }, { n1: '[worried]' }, english)
    expect(merged.cues).toEqual({ n1: '[worried] Elior [low] vaknar.' })
    expect(
      mergeCues(swedish, { n1: '[sad] Elior [low] vaknar.' }, { n1: '[worried]' }, english).cues,
    ).toEqual({
      n1: '[sad] Elior [low] vaknar.',
    })
  })

  it('keeps the source’s opening cue for an entry that no longer fits', () => {
    const merged = mergeCues(swedish, { n1: 'Elior [low] sover.' }, { n1: '[worried]' }, english)
    expect(merged.cues).toEqual({ n1: '[worried] Elior [low] sover.' })
  })
})

describe('a line with an ElevenLabs voice', () => {
  const elevenCast: Cast = {
    speakers: { ...cast.speakers, mira: { voice: 'eleven:abc', style: '[low, calm]', speed: 1.1 } },
    pronounce: {},
  }
  const m1 = lines[1]!

  it('is made with ElevenLabs’ model and its settings, not Fish’s temperature', () => {
    const inputs = clipInputs(m1, elevenCast.speakers.mira, {}, {}, narration)!
    expect(inputs.model).toBe('eleven_v3')
    expect(inputs.voice).toBe('eleven:abc')
    const { output, quality } = narration
    expect(JSON.parse(inputs.settings)).toEqual([
      0.5,
      0.75,
      0,
      1.1,
      quality.chunkLimit,
      output.codec,
      output.bitrate,
      output.channels,
    ])
  })

  it('is up to date as made, while Fish’s stages differ', () => {
    const withFinal = { ...narration, models: { ...narration.models, final: 's2-pro' } }
    const lock = { m1: entryFor(m1, elevenCast) }
    const state = planPart(input({ cast: elevenCast, lock, narration: withFinal }))
    expect(state.lines.find((l) => l.key === 'm1')).toMatchObject({ status: 'ok' })
  })

  it('goes stale for its voice when its character is recast from Fish', () => {
    const lock = { m1: entryFor(m1) }
    const state = planPart(input({ cast: elevenCast, lock }))
    expect(state.lines.find((l) => l.key === 'm1')).toMatchObject({ status: 'stale' })
    expect(state.lines.find((l) => l.key === 'm1')!.reasons).toContain('voice')
  })
})

describe('a line on an ElevenLabs model that reads no cues', () => {
  const voice = { voice: 'eleven:abc', style: '[low, calm]' }
  const line = { key: 'm1', speaker: 'mira', text: 'Welcome, child, come in.' }
  const cues = { m1: '[soft] Welcome, child, [whispers] come in.' }

  it('is made without its cues, and a cue edited leaves its fingerprint as it is', () => {
    const inputs = clipInputs(line, voice, cues, {}, narration, 'eleven_multilingual_v2')!
    expect([inputs.cue, inputs.inside]).toEqual(['', []])
    // Nor its scene's cue or its character's style.
    expect(clipInputs(line, voice, {}, {}, narration, 'eleven_multilingual_v2')!.cue).toBe('')
    const edited = clipInputs(
      line,
      voice,
      { m1: '[loud] Welcome' },
      {},
      narration,
      'eleven_flash_v2_5',
    )!
    expect(edited.cue).toBe('')
    expect(
      fingerprint(clipInputs(line, voice, {}, {}, narration, 'eleven_multilingual_v2')!).fp,
    ).toBe(fingerprint(inputs).fp)
  })

  it('still shows its cues, whatever model speaks it', () => {
    expect(cueInputs(line, voice, cues, narration)).toEqual({
      cue: '[soft]',
      inside: [{ at: 2, cue: '[whispers]' }],
    })
    expect(cueInputs(line, voice, {}, narration)).toEqual({ cue: '[low, calm]', inside: [] })
  })

  it('keeps its cues on Eleven v3, which reads them as directions, as Fish’s models do', () => {
    const inputs = clipInputs(line, voice, cues, {}, narration, 'eleven_v3')!
    expect(inputs.cue).toBe('[soft]')
    expect(inputs.inside).toHaveLength(1)
  })
})

describe('a final step on ElevenLabs’ side only', () => {
  const elevenCast: Cast = {
    speakers: { ...cast.speakers, mira: { voice: 'eleven:abc', style: '[low, calm]' } },
    pronounce: {},
  }
  const withElevenFinal = {
    ...narration,
    elevenlabs: {
      models: { audition: 'eleven_v3', draft: 'eleven_v3', final: 'eleven_multilingual_v2' },
    },
  }

  it('leaves a Fish line, whose stages are one, final when up to date', () => {
    const lock = { n1: entryFor(lines[0]!, elevenCast) }
    const state = planPart(input({ cast: elevenCast, lock, narration: withElevenFinal }))
    expect(state.lines.find((l) => l.key === 'n1')).toMatchObject({ status: 'ok', final: true })
  })

  it('counts an ElevenLabs line drafted with v3 as not final yet', () => {
    const lock = { m1: entryFor(lines[1]!, elevenCast) }
    const state = planPart(input({ cast: elevenCast, lock, narration: withElevenFinal }))
    expect(state.lines.find((l) => l.key === 'm1')).toMatchObject({ status: 'ok', final: false })
  })
})

describe('whether a line’s model reads its cues', () => {
  it('is false for a line drafted on an ElevenLabs model that would speak them', () => {
    const elevenCast: Cast = {
      speakers: { ...cast.speakers, mira: { voice: 'eleven:abc' } },
      pronounce: {},
    }
    const onV2 = {
      ...narration,
      elevenlabs: {
        models: {
          audition: 'eleven_v3',
          draft: 'eleven_multilingual_v2',
          final: 'eleven_multilingual_v2',
        },
      },
    }
    const state = planPart(input({ cast: elevenCast, narration: onV2 }))
    expect(state.lines.map((l) => [l.key, l.readsCues])).toEqual([
      ['n1', true],
      ['m1', false],
      ['t1', true],
    ])
  })
})

describe('a Fish voice’s fingerprint', () => {
  it('is what it was before ElevenLabs, so no consumer’s clip goes stale', () => {
    const inputs = clipInputs(
      { key: 'm1', speaker: 'mira', text: 'Welcome, child.' },
      { voice: 'v-mira', style: '[low, calm]', speed: 1.1 },
      {},
      {},
      narration,
    )!
    expect(fingerprint(inputs)).toEqual({
      fp: '94f2174f922de996',
      parts: { cue: '1e136cf1', text: '8cb63797', said: '8cb63797', settings: 'ab047dd6' },
    })
  })
})

describe('a final plan, with a line whose voice has no final step', () => {
  it('counts an up-to-date ElevenLabs line as final, so a final recording leaves it alone', () => {
    const elevenCast: Cast = {
      speakers: { ...cast.speakers, mira: { voice: 'eleven:abc', style: '[low, calm]' } },
      pronounce: {},
    }
    const withFinal = { ...narration, models: { ...narration.models, final: 's2-pro' } }
    const lock = { m1: entryFor(lines[1]!, elevenCast) }
    const state = planPart(input({ cast: elevenCast, lock, narration: withFinal }))
    expect(state.lines.find((l) => l.key === 'm1')).toMatchObject({ status: 'ok', final: true })
  })
})

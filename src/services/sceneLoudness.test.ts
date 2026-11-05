import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { SceneMeasure } from '../core/sceneLoudness'
import {
  summarizeScenes,
  type SceneAct,
  type SceneDeclaration,
  type SceneEffectChoice,
  type SceneMix,
} from '../core/scenes'
import { keepMeasure, LOUDNESS_FILE } from './sceneMeasures'
import {
  making,
  measureScenes,
  startMeasure,
  type RenderPart,
  type SceneAudio,
} from './sceneLoudness'
import { scaleMix } from '../core/sceneLoudness'
import { saveScene } from './scenes'

const choice = (id: string, over: Partial<SceneEffectChoice> = {}): SceneEffectChoice => ({
  id,
  name: id,
  loops: false,
  silent: false,
  playable: true,
  clip: 'take 1',
  ...over,
})

const declared = (id: string, states: string[] = []): SceneDeclaration => ({
  id,
  name: id,
  states,
  triggers: [],
})

/** An act of scenes read from the declarations and mix given, with every track playable. */
function actOf(
  scenes: SceneDeclaration[],
  mix: Record<string, SceneMix>,
  effects: SceneEffectChoice[] = [],
  badIds: string[] = [],
): { act: SceneAct; effects: SceneEffectChoice[] } {
  const summary = summarizeScenes({
    acts: [
      {
        id: 'act1',
        title: 'Act I',
        canRefresh: false,
        mixFile: 'mix.json',
        declarations: { status: 'ok', scenes, problems: [] },
        mix: { status: 'ok', scenes: mix, badIds: new Set(badIds) },
      },
    ],
    effects: {
      status: 'ok',
      unreadable: 0,
      rows: effects.map((c) => ({
        id: c.id,
        name: c.name,
        loops: c.loops,
        current: c.silent ? { kind: 'nothing' } : { kind: 'take', take: 1, exists: c.playable },
      })),
    } as never,
    music: [
      {
        id: 'act1',
        kind: 'act',
        title: 'Act I',
        state: 'ok',
        tracks: [{ id: 'theme', title: 'Theme', current: { kind: 'take', take: 2, exists: true } }],
      },
    ] as never,
  })
  return { act: summary.acts[0]!, effects: summary.effects }
}

/** Audio that plays every clip for 2 s and reports the sum of the levels as its loudness, in dB. */
function fakeAudio(over: Partial<SceneAudio> = {}) {
  const asked: RenderPart[][] = []
  const audio: SceneAudio = {
    seconds: async () => 2,
    loudness: async (parts) => {
      asked.push(parts)
      return parts.length === 0 ? null : -30 + parts.reduce((sum, p) => sum + p.level, 0)
    },
    ...over,
  }
  return { audio, asked }
}

const files = {
  effect: async (id: string) => `/clips/${id}.mp3`,
  music: async (id: string) => `/music/${id}.mp3`,
}

function run(
  built: ReturnType<typeof actOf>,
  extra: {
    open?: { scene: string; entry: SceneMix } | null
    audio?: SceneAudio
    kept?: [string, SceneMeasure, boolean][]
    progress?: [number, number][]
  } = {},
) {
  const kept = extra.kept ?? []
  const progress = extra.progress ?? []
  return measureScenes({
    ...built,
    open: extra.open ?? null,
    audio: extra.audio ?? fakeAudio().audio,
    files,
    now: () => new Date('2026-11-05T14:02:00.000Z'),
    keep: async (id, measure, draft) => void kept.push([id, measure, draft]),
    progress: (done, total) => void progress.push([done, total]),
  })
}

describe('measureScenes', () => {
  it('measures every scene, a row for each of its states, and keeps each as it goes', async () => {
    const built = actOf(
      [declared('a', ['dim', 'lit']), declared('b')],
      {
        a: {
          music: { track: 'theme', level: 1 },
          effects: [
            { id: 'wind', play: { mode: 'loop' }, state: 'lit', level: 0.5 },
            { id: 'hum', play: { mode: 'loop' }, level: 2 },
          ],
        },
      },
      [choice('wind', { loops: true }), choice('hum', { loops: true })],
    )
    const kept: [string, SceneMeasure, boolean][] = []
    const progress: [number, number][] = []
    await run(built, { kept, progress })
    expect(kept.map(([id, , draft]) => [id, draft])).toEqual([
      ['a', false],
      ['b', false],
    ])
    const a = kept[0]![1]
    expect(a.measuredAt).toBe('2026-11-05T14:02:00.000Z')
    expect(a.states).toEqual([
      { state: 'dim', lufs: -30 + 1 + 2 },
      { state: 'lit', lufs: -30 + 1 + 2 + 0.5 },
    ])
    expect(a.clips).toEqual({
      'music:theme': 'take 2',
      'effect:wind': 'take 1',
      'effect:hum': 'take 1',
    })
    expect(a.entry).toEqual(built.act.scenes[0]!.entry)
    // No music and no effects in scene b: its own track is not in the list either.
    expect(kept[1]![1].states).toEqual([{ state: null, lufs: null }])
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })

  it('measures the open scene as it is on the page, as a draft', async () => {
    const built = actOf([declared('a'), declared('b')], { a: { effects: [] } }, [
      choice('hum', { loops: true }),
    ])
    const entry: SceneMix = { effects: [{ id: 'hum', play: { mode: 'loop' }, level: 1 }] }
    const kept: [string, SceneMeasure, boolean][] = []
    await run(built, { open: { scene: 'a', entry }, kept })
    expect(kept.map(([id, , draft]) => [id, draft])).toEqual([
      ['a', true],
      ['b', false],
    ])
    expect(kept[0]![1].entry).toEqual(entry)
    expect(kept[0]![1].states[0]!.lufs).toBe(-29)
  })

  it('leaves out a silent or missing sound and names it', async () => {
    const built = actOf(
      [declared('a')],
      {
        a: {
          music: { track: 'theme', level: 1 },
          effects: [
            { id: 'glass-clink', play: { mode: 'loop' }, level: 1 },
            { id: 'lost', play: { mode: 'loop' }, level: 1 },
            { id: 'hum', play: { mode: 'loop' }, level: 1 },
          ],
        },
      },
      [
        choice('glass-clink', { silent: true, playable: false, clip: null }),
        choice('lost', { playable: false }),
        choice('hum'),
      ],
    )
    const { audio, asked } = fakeAudio()
    const kept: [string, SceneMeasure, boolean][] = []
    await run(built, { audio, kept })
    expect(kept[0]![1].without).toEqual([
      'glass-clink, which has no take chosen',
      'lost, whose file is not there',
    ])
    expect(asked[0]!.map((p) => p.file)).toEqual(['/music/theme.mp3', '/clips/hum.mp3'])
  })

  it('names only effects the measured minute would have played, and in which states', async () => {
    const built = actOf(
      [declared('a', ['calm', 'rainy', 'storm'])],
      {
        a: {
          music: { track: 'theme', level: 1 },
          effects: [
            { id: 'creak', play: { mode: 'trigger', trigger: 'open' }, level: 1 },
            { id: 'coins', play: { mode: 'loop' }, state: 'flooded', level: 1 },
            { id: 'late', play: { mode: 'once', afterSeconds: 90 }, level: 1 },
            { id: 'rain', play: { mode: 'loop' }, state: 'rainy', level: 1 },
            { id: 'fire', play: { mode: 'loop' }, level: 1 },
          ],
        },
      },
      ['creak', 'coins', 'late', 'rain', 'fire'].map((id) =>
        choice(id, { silent: true, playable: false, clip: null }),
      ),
    )
    const kept: [string, SceneMeasure, boolean][] = []
    await run(built, { kept })
    expect(kept[0]![1].without).toEqual([
      'rain in rainy, which has no take chosen',
      'fire, which has no take chosen',
    ])
  })

  it('names an effect once however many rows it has, with all its states', async () => {
    const mixOf = (effects: SceneMix['effects']) => ({ a: { effects } })
    const none = { silent: true, playable: false, clip: null }
    const loop = { mode: 'loop' } as const
    const states = ['calm', 'rainy', 'storm']
    const two = actOf(
      [declared('a', states)],
      mixOf([
        { id: 'rain', play: loop, state: 'rainy', level: 1 },
        { id: 'rain', play: loop, state: 'storm', level: 1 },
      ]),
      [choice('rain', none)],
    )
    const kept: [string, SceneMeasure, boolean][] = []
    await run(two, { kept })
    expect(kept[0]![1].without).toEqual(['rain in rainy and storm, which has no take chosen'])
    const mixed = actOf(
      [declared('a', states)],
      mixOf([
        { id: 'rain', play: loop, level: 1 },
        { id: 'rain', play: loop, state: 'rainy', level: 1 },
      ]),
      [choice('rain', none)],
    )
    const kept2: [string, SceneMeasure, boolean][] = []
    await run(mixed, { kept: kept2 })
    expect(kept2[0]![1].without).toEqual(['rain, which has no take chosen'])
  })

  it('applies the same rule to the open scene on the page', async () => {
    const built = actOf([declared('a', ['calm', 'rainy'])], { a: { effects: [] } }, [
      choice('creak', { silent: true, playable: false, clip: null }),
      choice('rain', { silent: true, playable: false, clip: null }),
    ])
    const entry: SceneMix = {
      effects: [
        { id: 'creak', play: { mode: 'trigger', trigger: 'open' }, level: 1 },
        { id: 'rain', play: { mode: 'loop' }, state: 'rainy', level: 1 },
      ],
    }
    const kept: [string, SceneMeasure, boolean][] = []
    await run(built, { open: { scene: 'a', entry }, kept })
    expect(kept[0]![2]).toBe(true)
    expect(kept[0]![1].without).toEqual(['rain in rainy, which has no take chosen'])
  })

  it('records why a scene could not be measured and goes on with the others', async () => {
    const built = actOf([declared('a', ['x', 'y']), declared('b')], {
      a: { music: { track: 'theme', level: 1 }, effects: [] },
      b: { music: { track: 'theme', level: 1 }, effects: [] },
    })
    let calls = 0
    const { audio } = fakeAudio({
      loudness: async () => {
        if (++calls === 1) throw new Error('ffmpeg fell over')
        return -20
      },
    })
    const kept: [string, SceneMeasure, boolean][] = []
    const outcome = await run(built, { audio, kept })
    expect(kept[0]![1].error).toBe('ffmpeg fell over')
    expect(kept[0]![1].states).toEqual([
      { state: 'x', lufs: null },
      { state: 'y', lufs: null },
    ])
    expect(kept[1]![1].error).toBeNull()
    expect(kept[1]![1].states).toEqual([{ state: null, lufs: -20 }])
    expect(outcome).toEqual({ measured: 1, failed: 1 })
  })

  it('skips a scene whose entry cannot be read', async () => {
    const built = actOf([declared('a'), declared('b')], {}, [], ['a'])
    const kept: [string, SceneMeasure, boolean][] = []
    const progress: [number, number][] = []
    await run(built, { kept, progress })
    expect(kept.map(([id]) => id)).toEqual(['b'])
    expect(progress[0]).toEqual([0, 1])
  })
})

const scenesSection = {
  paths: { declarations: 'tts/{part}/scenes.json', mix: 'game/{part}.mix.json' },
  loudness: { target: -20, tolerance: 2 },
}

function repo() {
  const root = tempRepo({
    'content-studio.json': projectJson({ scenes: scenesSection }),
    'tts/cast.json': { speakers: {} },
    'tts/act1/scenes.json': [
      { id: 'a', name: 'A', states: [], triggers: [] },
      { id: 'b', name: 'B', states: [], triggers: [] },
    ],
  })
  return { root, projectFile: join(root, 'content-studio.json') }
}

const measureOf = (entry: SceneMix | null): SceneMeasure => ({
  measuredAt: '2026-11-05T14:02:00.000Z',
  entry,
  clips: {},
  states: [{ state: null, lufs: -20 }],
  without: [],
  error: null,
})

const kept = (root: string) => JSON.parse(readFileSync(join(root, LOUDNESS_FILE), 'utf8'))

describe('startMeasure', () => {
  it('measures the act in the background, keeps the figures in the studio folder, and counts', async () => {
    const { root, projectFile } = repo()
    const started = await startMeasure(projectFile, 'act1', null, { audio: fakeAudio().audio })
    if (!started.ok) throw new Error(started.message)
    expect(making(projectFile)).toEqual({ act1: { done: 0, total: 2 } })
    await started.done
    expect(making(projectFile)).toEqual({})
    const file = kept(root)
    expect(Object.keys(file.act1)).toEqual(['a', 'b'])
    expect(file.act1.a.saved.states).toEqual([{ state: null, lufs: null }])
    expect(file.act1.a.draft).toBeNull()
  })

  it('refuses a second press while the act is being measured', async () => {
    const { projectFile } = repo()
    const first = await startMeasure(projectFile, 'act1', null, { audio: fakeAudio().audio })
    const second = await startMeasure(projectFile, 'act1', null, { audio: fakeAudio().audio })
    expect(second).toMatchObject({ ok: false, kind: 'running' })
    if (first.ok) await first.done
  })

  it('ignores an open scene that is not in the act', async () => {
    const { root, projectFile } = repo()
    const started = await startMeasure(
      projectFile,
      'act1',
      { scene: 'elsewhere', entry: { effects: [] } },
      { audio: fakeAudio().audio },
    )
    if (started.ok) await started.done
    expect(kept(root).act1.a.draft).toBeNull()
    expect(kept(root).act1.a.saved).not.toBeNull()
  })

  it('knows no act that is not in the project', async () => {
    const { projectFile } = repo()
    expect(await startMeasure(projectFile, 'act9', null)).toMatchObject({
      ok: false,
      kind: 'unknown',
    })
  })

  it('shows the kept figures with the project, and the target', async () => {
    const { root, projectFile } = repo()
    const started = await startMeasure(projectFile, 'act1', null, { audio: fakeAudio().audio })
    if (started.ok) await started.done
    const { loadProject } = await import('./workspace')
    const loaded = await loadProject(join(root, 'content-studio.json'))
    if (!loaded.ok) throw new Error('project')
    const scenes = loaded.summary.scenes!
    expect(scenes.loudnessTarget).toEqual({ target: -20, tolerance: 2 })
    expect(scenes.acts[0]!.scenes[0]!.loudness.saved?.states).toEqual([{ state: null, lufs: null }])
  })
})

describe('the kept figures', () => {
  it('keep a draft beside the saved figures, and a saved measure clears the draft', async () => {
    const { root, projectFile } = repo()
    await keepMeasure(projectFile, 'act1', 'a', measureOf(null), false)
    const draft = measureOf({ effects: [] })
    await keepMeasure(projectFile, 'act1', 'a', draft, true)
    expect(kept(root).act1.a.saved.entry).toBeNull()
    expect(kept(root).act1.a.draft.entry).toEqual({ effects: [] })
    await keepMeasure(projectFile, 'act1', 'a', measureOf(null), false)
    expect(kept(root).act1.a.draft).toBeNull()
  })

  it('make a saved draft the saved figures, and drop one that is not what was saved', async () => {
    const { root, projectFile } = repo()
    const entry: SceneMix = { music: { track: null, level: 1 }, effects: [] }
    await keepMeasure(projectFile, 'act1', 'a', measureOf(null), false)
    await keepMeasure(projectFile, 'act1', 'a', measureOf(entry), true)
    expect((await saveScene(projectFile, 'act1', 'a', entry, null)).ok).toBe(true)
    expect(kept(root).act1.a.saved.entry).toEqual(entry)
    expect(kept(root).act1.a.draft).toBeNull()

    const other: SceneMix = { music: { track: null, level: 2 }, effects: [] }
    await keepMeasure(projectFile, 'act1', 'a', measureOf({ effects: [] }), true)
    expect((await saveScene(projectFile, 'act1', 'a', other, entry)).ok).toBe(true)
    expect(kept(root).act1.a.draft).toBeNull()
    expect(kept(root).act1.a.saved.entry).toEqual(entry)
  })

  it('keep the expected figures when a scene is saved as the measured one moved', async () => {
    const { root, projectFile } = repo()
    const entry: SceneMix = {
      music: { track: null, level: 1 },
      effects: [{ id: 'bell', play: { mode: 'loop' }, level: 0.6 }],
    }
    const moved = scaleMix(entry, 4)
    await keepMeasure(projectFile, 'act1', 'a', measureOf(entry), false)
    const answer = await saveScene(
      projectFile,
      'act1',
      'a',
      { ...moved, music: entry.music },
      null,
      {
        db: 4,
        measuredAt: '2026-11-05T14:02:00.000Z',
      },
    )
    expect(answer.ok).toBe(true)
    expect(kept(root).act1.a.saved.moved).toEqual({ db: 4 })
    expect(kept(root).act1.a.saved.entry).toEqual(entry)
  })

  it('ignore a move that is not what was saved', async () => {
    const { root, projectFile } = repo()
    const entry: SceneMix = {
      music: { track: null, level: 1 },
      effects: [{ id: 'bell', play: { mode: 'loop' }, level: 0.6 }],
    }
    await keepMeasure(projectFile, 'act1', 'a', measureOf(entry), true)
    await saveScene(projectFile, 'act1', 'a', { ...scaleMix(entry, 2), music: entry.music }, null, {
      db: 4,
      measuredAt: '2026-11-05T14:02:00.000Z',
    })
    expect(kept(root).act1.a.saved ?? null).toBeNull()
  })

  it('write nothing when a scene is saved that has no kept figures', async () => {
    const { root, projectFile } = repo()
    await saveScene(projectFile, 'act1', 'a', { effects: [] }, null)
    expect(existsSync(join(root, LOUDNESS_FILE))).toBe(false)
  })

  it('never write over a file that cannot be read, and refuse to start a measure', async () => {
    const { root, projectFile } = repo()
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(join(root, 'content-studio/cache'), { recursive: true })
    writeFileSync(join(root, LOUDNESS_FILE), 'not json')
    await expect(keepMeasure(projectFile, 'act1', 'a', measureOf(null), false)).rejects.toThrow(
      'cannot be read',
    )
    expect(readFileSync(join(root, LOUDNESS_FILE), 'utf8')).toBe('not json')
    expect(await startMeasure(projectFile, 'act1', null)).toMatchObject({
      ok: false,
      kind: 'unreadable',
    })
  })
})

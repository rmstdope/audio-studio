import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { SceneMix } from '../core/scenes'
import { saveScene } from './scenes'
import { loadProject } from './workspace'

const scenes = {
  paths: { declarations: 'tts/{part}/scenes.json', mix: 'game/scenes/{part}.mix.json' },
}

/** The scenes of `act1` as a project reads them; `files` are the repository's other files. */
async function load(files: Record<string, unknown>, section: unknown = scenes) {
  const root = tempRepo({
    'content-studio.json': projectJson(section === null ? {} : { scenes: section }),
    'tts/cast.json': { speakers: {} },
    ...files,
  })
  const loaded = await loadProject(join(root, 'content-studio.json'))
  if (!loaded.ok) throw new Error('project')
  return loaded.summary
}

const store = { id: 'act1-store', name: 'General store', states: ['plain'], triggers: [] }

describe('the scenes of a project', () => {
  it('are null without a scenes section', async () => {
    expect((await load({}, null)).scenes).toBeNull()
  })

  it('list every act, the ones the game has not listed yet as missing', async () => {
    const summary = await load({ 'tts/act1/scenes.json': [store] })
    expect(summary.scenes!.acts.map((a) => [a.id, a.title, a.state, a.scenes.length])).toEqual([
      ['act1', 'Act I', 'ok', 1],
      ['act2', 'Act II', 'missing', 0],
    ])
    expect(summary.problems).toEqual([])
  })

  it('read a missing mix as an empty one, with no problem', async () => {
    const summary = await load({ 'tts/act1/scenes.json': [store] })
    expect(summary.scenes!.acts[0]!.scenes[0]!.effects).toEqual([])
    expect(summary.problems).toEqual([])
  })

  it('read the mix beside the declarations', async () => {
    const summary = await load({
      'tts/act1/scenes.json': [store],
      'game/scenes/act1.mix.json': {
        scenes: {
          'act1-store': {
            music: { track: null, level: 1 },
            effects: [{ id: 'bell', play: { mode: 'loop' }, level: 0.5 }],
          },
        },
      },
    })
    const scene = summary.scenes!.acts[0]!.scenes[0]!
    expect(scene.effects.map((e) => [e.id, e.level])).toEqual([['bell', 0.5]])
  })

  it('report a mix scene that cannot be read, and show the others', async () => {
    const summary = await load({
      'tts/act1/scenes.json': [store, { id: 'other', name: 'Other' }],
      'game/scenes/act1.mix.json': {
        scenes: { 'act1-store': { effects: [{ id: 'bell', play: { mode: 'loop' }, level: 9 }] } },
      },
    })
    expect(summary.scenes!.acts[0]!.scenes.map((s) => s.unreadable)).toEqual([true, false])
    expect(summary.problems).toEqual([
      {
        file: 'game/scenes/act1.mix.json',
        path: 'scenes.act1-store.effects[0].level',
        message: expect.any(String),
      },
    ])
  })

  it('report a mix that is not JSON, and a declarations file that is not a list', async () => {
    const summary = await load({
      'tts/act1/scenes.json': [store],
      'game/scenes/act1.mix.json': '{ broken',
      'tts/act2/scenes.json': { not: 'a list' },
    })
    const [one, two] = summary.scenes!.acts
    expect(one!.scenes[0]!.unreadable).toBe(true)
    expect(two!.state).toBe('invalid')
    expect(summary.problems.map((p) => p.file).sort()).toEqual([
      'game/scenes/act1.mix.json',
      'tts/act2/scenes.json',
    ])
  })

  it('report a declarations entry left out', async () => {
    const summary = await load({ 'tts/act1/scenes.json': [store, { id: 'Bad', name: 'x' }] })
    expect(summary.scenes!.acts[0]!.scenes.length).toBe(1)
    expect(summary.problems.map((p) => [p.file, p.path])).toEqual([
      ['tts/act1/scenes.json', '[1].id'],
    ])
  })

  it('knows whether the game can be asked to refresh', async () => {
    expect((await load({})).scenes!.acts[0]!.canRefresh).toBe(false)
  })
})

describe('saving a scene', () => {
  const MIX = 'game/scenes/act1.mix.json'
  const other = { id: 'act1-cottage', name: 'Cottage', states: [], triggers: [] }
  const entry = (level: number): SceneMix => ({
    music: { track: 'act1-store', level },
    effects: [{ id: 'bell', play: { mode: 'loop' }, level }],
  })

  /** A repository with two scenes declared, and `mix` (an object, or text) in the mix file. */
  async function repo(mix?: unknown) {
    const root = tempRepo({
      'content-studio.json': projectJson({ scenes }),
      'tts/cast.json': { speakers: {} },
      'tts/act1/scenes.json': [store, other],
      ...(mix === undefined ? {} : { [MIX]: mix }),
    })
    return { root, projectFile: join(root, 'content-studio.json') }
  }
  const text = (root: string) => readFileSync(join(root, MIX), 'utf8')

  it('replaces only that scene, keeps the others and the gone ones, in a stable order', async () => {
    const { root, projectFile } = await repo({
      scenes: {
        'old-room': { effects: [] },
        'act1-cottage': entry(2),
        broken: { effects: 'nope' },
        'act1-store': entry(1),
      },
    })
    const result = await saveScene(projectFile, 'act1', 'act1-store', entry(0.5), entry(1))
    expect(result).toEqual({ ok: true })
    const written = JSON.parse(text(root))
    expect(Object.keys(written.scenes)).toEqual([
      'act1-store',
      'act1-cottage',
      'old-room',
      'broken',
    ])
    expect(written.scenes['act1-store']).toEqual(entry(0.5))
    expect(written.scenes['act1-cottage']).toEqual(entry(2))
    expect(written.scenes.broken).toEqual({ effects: 'nope' })
    expect(text(root)).toBe(`{
  "scenes": {
    "act1-store": {
      "music": { "track": "act1-store", "level": 0.5 },
      "effects": [
        { "id": "bell", "play": { "mode": "loop" }, "level": 0.5 }
      ]
    },
    "act1-cottage": {
      "music": { "track": "act1-store", "level": 2 },
      "effects": [
        { "id": "bell", "play": { "mode": "loop" }, "level": 2 }
      ]
    },
    "old-room": { "effects": [] },
    "broken": { "effects": "nope" }
  }
}
`)
  })

  it('writes a file it can write again byte for byte, so a save changes only its own scene', async () => {
    const { root, projectFile } = await repo({
      scenes: { 'act1-cottage': entry(2), 'act1-store': entry(1) },
    })
    await saveScene(projectFile, 'act1', 'act1-store', entry(1), entry(1))
    const first = text(root)
    await saveScene(projectFile, 'act1', 'act1-cottage', entry(2), entry(2))
    expect(text(root)).toBe(first)
    await saveScene(projectFile, 'act1', 'act1-store', entry(0.5), entry(1))
    const changed = text(root).split('\n')
    const before = first.split('\n')
    expect(changed.length).toBe(before.length)
    expect(changed.filter((line, i) => line !== before[i]).length).toBe(2)
  })

  it('keeps a short scene on one line', async () => {
    const { root, projectFile } = await repo({ scenes: {} })
    await saveScene(projectFile, 'act1', 'act1-store', { effects: [] }, null)
    expect(text(root)).toBe('{\n  "scenes": {\n    "act1-store": { "effects": [] }\n  }\n}\n')
  })

  it('creates the file and its folder when the mix is not there yet', async () => {
    const { root, projectFile } = await repo()
    expect(await saveScene(projectFile, 'act1', 'act1-store', entry(1), null)).toEqual({
      ok: true,
    })
    expect(JSON.parse(text(root))).toEqual({ scenes: { 'act1-store': entry(1) } })
  })

  it('writes nothing when the scene was saved since the page read it, and says what is saved', async () => {
    const { root, projectFile } = await repo({ scenes: { 'act1-store': entry(2) } })
    const before = text(root)
    const result = await saveScene(projectFile, 'act1', 'act1-store', entry(0.5), entry(1))
    expect(result).toEqual({ ok: false, kind: 'stale', current: entry(2) })
    expect(text(root)).toBe(before)
  })

  it('takes a stale null as stale when the scene has an entry now', async () => {
    const { projectFile } = await repo({ scenes: { 'act1-store': entry(2) } })
    const result = await saveScene(projectFile, 'act1', 'act1-store', entry(1), null)
    expect(result).toMatchObject({ ok: false, kind: 'stale' })
  })

  it('never writes over a mix it cannot read, or a scene entry it cannot read', async () => {
    const bad = await repo('not json {')
    expect(await saveScene(bad.projectFile, 'act1', 'act1-store', entry(1), null)).toMatchObject({
      ok: false,
      kind: 'unreadable',
    })
    expect(text(bad.root)).toBe('not json {')
    const entryBad = await repo({ scenes: { 'act1-store': { effects: 3 } } })
    expect(
      await saveScene(entryBad.projectFile, 'act1', 'act1-store', entry(1), null),
    ).toMatchObject({ ok: false, kind: 'unreadable' })
  })

  it('refuses a scene the game does not declare, an unknown act, and an entry that cannot work', async () => {
    const { projectFile } = await repo()
    expect(await saveScene(projectFile, 'act1', 'nope', entry(1), null)).toMatchObject({
      ok: false,
      kind: 'unknown',
    })
    expect(await saveScene(projectFile, 'act9', 'act1-store', entry(1), null)).toMatchObject({
      ok: false,
      kind: 'unknown',
    })
    expect(await saveScene(projectFile, 'act1', 'act1-store', entry(4), null)).toMatchObject({
      ok: false,
      kind: 'invalid',
    })
  })
})

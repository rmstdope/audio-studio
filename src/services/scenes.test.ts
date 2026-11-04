import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
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

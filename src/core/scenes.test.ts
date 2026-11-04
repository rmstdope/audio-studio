import { describe, expect, it } from 'bun:test'
import type { EffectsSummary } from './effects'
import type { CurrentMusic, MusicListSummary, TrackRow } from './music'
import {
  readSceneDeclarations,
  readSceneMix,
  summarizeScenes,
  type DeclarationsState,
  type MixState,
  type SceneDeclaration,
  type SceneMix,
} from './scenes'

const slug = (id: string): SceneDeclaration => ({ id, name: id, states: [], triggers: [] })

describe('readSceneDeclarations', () => {
  it('reads the scenes in the game order, states and triggers defaulting to none', () => {
    const read = readSceneDeclarations(
      [
        {
          id: 'act1-store',
          name: 'General store',
          states: ['plain', 'cat-home'],
          triggers: ['door-opens'],
        },
        { id: 'act1-cottage', name: "Elior's cottage" },
      ],
      'tts/act1/scenes.json',
    )
    if (!read.ok) throw new Error('expected a list')
    expect(read.scenes.map((s) => s.id)).toEqual(['act1-store', 'act1-cottage'])
    expect(read.scenes[1]).toEqual({
      id: 'act1-cottage',
      name: "Elior's cottage",
      states: [],
      triggers: [],
    })
    expect(read.problems).toEqual([])
  })

  it('leaves out an entry with a problem and reports its place', () => {
    const read = readSceneDeclarations(
      [slug('a'), { id: 'b', name: 'B', states: ['Not A Slug'] }],
      'f.json',
    )
    if (!read.ok) throw new Error('expected a list')
    expect(read.scenes.map((s) => s.id)).toEqual(['a'])
    expect(read.problems.map((p) => [p.file, p.path])).toEqual([['f.json', '[1].states[0]']])
  })

  it('leaves out both entries of an id used twice, and a repeated state', () => {
    const read = readSceneDeclarations(
      [slug('a'), slug('a'), { id: 'c', name: 'C', states: ['x', 'x'] }],
      'f.json',
    )
    if (!read.ok) throw new Error('expected a list')
    expect(read.scenes).toEqual([])
    expect(read.problems.map((p) => p.path)).toEqual(['[0].id', '[1].id', '[2].states'])
  })

  it('is unreadable as a whole when it is not a list', () => {
    expect(readSceneDeclarations({}, 'f.json').ok).toBe(false)
  })
})

describe('readSceneMix', () => {
  it('reads each scene entry on its own', () => {
    const read = readSceneMix(
      {
        scenes: {
          good: {
            music: { track: 'good', level: 1 },
            effects: [
              { id: 'bell', play: { mode: 'once', afterSeconds: 0 }, level: 0.6 },
              { id: 'clink', play: { mode: 'random', everySeconds: [15, 30] }, level: 0.5 },
              { id: 'purr', play: { mode: 'loop' }, state: 'cat-home', level: 3 },
              { id: 'creak', play: { mode: 'trigger', trigger: 'door-opens' }, level: 1 },
            ],
          },
          bad: {
            effects: [{ id: 'bell', play: { mode: 'random', everySeconds: [30, 15] }, level: 1 }],
          },
          loud: { music: { track: null, level: 4 } },
        },
      },
      'mix.json',
    )
    if (!read.ok) throw new Error('expected a mix')
    expect(Object.keys(read.scenes)).toEqual(['good'])
    expect([...read.badIds].sort()).toEqual(['bad', 'loud'])
    expect(read.problems.map((p) => p.path)).toEqual([
      'scenes.bad.effects[0].play.everySeconds',
      'scenes.loud.music.level',
    ])
  })

  it('is unreadable when it has no scenes object', () => {
    expect(readSceneMix([], 'mix.json').ok).toBe(false)
    expect(readSceneMix({ scenes: [] }, 'mix.json').ok).toBe(false)
  })
})

const take = (exists = true): CurrentMusic => ({ kind: 'take', take: 1, exists })
const track = (id: string, current: CurrentMusic): TrackRow =>
  ({ id, title: `Track ${id}`, current }) as TrackRow
const musicList = (tracks: TrackRow[], state: 'ok' | 'missing' = 'ok'): MusicListSummary =>
  ({ id: 'act1', kind: 'act', title: 'Act 1', state, tracks }) as MusicListSummary
const effectRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  loops: false,
  chosen: true,
  current: { kind: 'take', take: 1, exists: true },
  ...over,
})
const effects = (rows: ReturnType<typeof effectRow>[], over: Partial<EffectsSummary> = {}) =>
  ({ status: 'ok', rows, unreadable: 0, ...over }) as unknown as EffectsSummary

const decl = (...scenes: SceneDeclaration[]): DeclarationsState => ({
  status: 'ok',
  scenes,
  problems: [],
})
const mixOf = (scenes: Record<string, SceneMix>, badIds: string[] = []): MixState => ({
  status: 'ok',
  scenes,
  badIds: new Set(badIds),
})

function summarize(over: {
  declarations?: DeclarationsState
  mix?: MixState
  effects?: EffectsSummary | null
  music?: MusicListSummary[]
}) {
  const act = {
    id: 'act1',
    title: 'Act 1',
    canRefresh: true,
    declarations: over.declarations ?? decl(),
    mix: over.mix ?? mixOf({}),
  }
  return summarizeScenes({
    acts: [act],
    effects: over.effects === undefined ? effects([]) : over.effects,
    music: over.music ?? [musicList([])],
  }).acts[0]!
}

describe('summarizeScenes', () => {
  const store = {
    id: 'store',
    name: 'General store',
    states: ['plain', 'cat-home'],
    triggers: ['door-opens'],
  }

  it('reads a scene as the mix says, in the declarations order', () => {
    const act = summarize({
      declarations: decl(store, slug('cottage')),
      mix: mixOf({
        store: {
          music: { track: 'store', level: 1 },
          effects: [
            { id: 'bell', play: { mode: 'once', afterSeconds: 1.5 }, level: 0.6 },
            { id: 'purr', play: { mode: 'loop' }, state: 'cat-home', level: 1 },
            { id: 'creak', play: { mode: 'trigger', trigger: 'door-opens' }, level: 1 },
          ],
        },
      }),
      effects: effects([effectRow('bell'), effectRow('purr', { loops: true }), effectRow('creak')]),
      music: [musicList([track('store', take())])],
    })
    expect(act.state).toBe('ok')
    expect(act.scenes.map((s) => s.id)).toEqual(['store', 'cottage'])
    const [scene, empty] = act.scenes
    expect(scene!.music).toEqual({
      track: 'store',
      name: 'Track store',
      level: 1,
      playable: true,
      gone: false,
    })
    expect(scene!.effects.map((e) => [e.id, e.state, e.level, e.playable, e.loops])).toEqual([
      ['bell', null, 0.6, true, false],
      ['purr', 'cat-home', 1, true, true],
      ['creak', null, 1, true, false],
    ])
    expect(scene!.gone).toBe(0)
    expect(scene!.silent).toBe(0)
    expect(empty!.effects).toEqual([])
    expect(empty!.unreadable).toBe(false)
  })

  it("plays the scene's own track at 100% when the mix has no music, and none when it says null", () => {
    const music = [musicList([track('store', take())])]
    const own = summarize({ declarations: decl(store), music }).scenes[0]!
    expect(own.music).toMatchObject({ track: 'store', level: 1, playable: true })
    const none = summarize({
      declarations: decl(store),
      mix: mixOf({ store: { music: { track: null, level: 1 }, effects: [] } }),
      music,
    }).scenes[0]!
    expect(none.music).toMatchObject({ track: null, name: null, playable: false })
    const noList = summarize({ declarations: decl(store), music: [musicList([])] }).scenes[0]!
    expect(noList.music.track).toBeNull()
  })

  it('names a track without a chosen take but does not play it', () => {
    const scene = summarize({
      declarations: decl(store),
      music: [musicList([track('store', { kind: 'none' })])],
    }).scenes[0]!
    expect(scene.music).toMatchObject({ track: 'store', playable: false, gone: false })
    const missing = summarize({
      declarations: decl(store),
      music: [musicList([track('store', take(false))])],
    }).scenes[0]!
    expect(missing.music.playable).toBe(false)
  })

  it('marks a track the readable music list no longer has as gone', () => {
    const mix = mixOf({ store: { music: { track: 'old', level: 1 }, effects: [] } })
    const scene = summarize({ declarations: decl(store), mix, music: [musicList([])] }).scenes[0]!
    expect(scene.music).toMatchObject({ track: 'old', name: 'old', playable: false, gone: true })
    expect(scene.gone).toBe(1)
    const unread = summarize({ declarations: decl(store), mix, music: [musicList([], 'missing')] })
      .scenes[0]!
    expect(unread.music.gone).toBe(false)
  })

  it('marks a state, a trigger or an effect the game no longer has, and counts each row once', () => {
    const scene = summarize({
      declarations: decl(store),
      mix: mixOf({
        store: {
          effects: [
            { id: 'bell', play: { mode: 'loop' }, state: 'old-state', level: 1 },
            { id: 'creak', play: { mode: 'trigger', trigger: 'old-trigger' }, level: 1 },
            { id: 'removed', play: { mode: 'loop' }, level: 1 },
            { id: 'removed', play: { mode: 'loop' }, state: 'old-state', level: 1 },
          ],
        },
      }),
      effects: effects([effectRow('bell'), effectRow('creak')]),
    }).scenes[0]!
    expect(
      scene.effects.map((e) => [e.goneState, e.goneTrigger, e.goneEffect, e.playable]),
    ).toEqual([
      [true, false, false, true],
      [false, true, false, true],
      [false, false, true, false],
      [true, false, true, false],
    ])
    expect(scene.gone).toBe(4)
  })

  it('counts a silent effect, and gone takes precedence over silent', () => {
    const silent = effectRow('bell', { chosen: false, current: { kind: 'nothing' } })
    const scene = summarize({
      declarations: decl(store),
      mix: mixOf({
        store: { effects: [{ id: 'bell', play: { mode: 'loop' }, level: 1 }] },
      }),
      effects: effects([silent]),
    }).scenes[0]!
    expect(scene.effects[0]).toMatchObject({ silent: true, playable: false })
    expect(scene.silent).toBe(1)
    expect(scene.gone).toBe(0)
  })

  it('does not play a chosen effect whose clip is missing, but does not call it silent', () => {
    const scene = summarize({
      declarations: decl(store),
      mix: mixOf({ store: { effects: [{ id: 'bell', play: { mode: 'loop' }, level: 1 }] } }),
      effects: effects([effectRow('bell', { current: { kind: 'take', take: 1, exists: false } })]),
    }).scenes[0]!
    expect(scene.effects[0]).toMatchObject({ silent: false, playable: false })
  })

  it('marks nothing gone or silent while the effects list cannot be read', () => {
    const mix = mixOf({ store: { effects: [{ id: 'bell', play: { mode: 'loop' }, level: 1 }] } })
    for (const list of [
      null,
      effects([], { status: 'invalid' }),
      effects([], { status: 'missing' }),
      effects([], { unreadable: 1 }),
    ]) {
      const scene = summarize({ declarations: decl(store), mix, effects: list }).scenes[0]!
      expect(scene.effects[0]).toMatchObject({ goneEffect: false, silent: false, playable: false })
      expect(scene.gone).toBe(0)
    }
  })

  it('does not show a scene the game no longer declares', () => {
    const act = summarize({
      declarations: decl(store),
      mix: mixOf({ ghost: { effects: [] } }),
    })
    expect(act.scenes.map((s) => s.id)).toEqual(['store'])
  })

  it('shows a scene whose mix entry cannot be read as unreadable, and all of them when the file cannot', () => {
    const one = summarize({ declarations: decl(store, slug('cottage')), mix: mixOf({}, ['store']) })
    expect(one.scenes.map((s) => s.unreadable)).toEqual([true, false])
    expect(one.scenes[0]!.effects).toEqual([])
    const all = summarize({
      declarations: decl(store, slug('cottage')),
      mix: { status: 'unreadable' },
    })
    expect(all.scenes.map((s) => s.unreadable)).toEqual([true, true])
  })

  it('passes on a declarations file that is missing or unreadable', () => {
    expect(summarize({ declarations: { status: 'missing' } })).toMatchObject({
      state: 'missing',
      scenes: [],
    })
    const problems = [{ file: 'f', path: '', message: 'x' }]
    expect(summarize({ declarations: { status: 'invalid', problems } })).toMatchObject({
      state: 'invalid',
      scenes: [],
    })
  })
})

import { describe, expect, test } from 'bun:test'
import { draftOf } from '../core/sceneEdit'
import type { SceneAct, SceneEffectChoice, SceneRow } from '../core/scenes'
import { dropKey, playSceneOf } from './sceneRun'

const scene = {
  id: 's',
  name: 'S',
  states: ['plain', 'cat'],
  triggers: [],
  music: { track: 'tr', name: 'Tr', level: 0.5, playable: true, gone: false },
  effects: [
    { id: 'a', name: 'A', play: { mode: 'loop' }, state: null, level: 1, loops: true },
    { id: 'b', name: 'B', play: { mode: 'loop' }, state: null, level: 1, loops: true },
  ],
  entry: null,
  unreadable: false,
  gone: 0,
  silent: 0,
} as unknown as SceneRow
const act = { tracks: [{ id: 'tr', title: 'Tr', playable: true }] } as unknown as SceneAct
const choice = (id: string, playable: boolean) =>
  ({ id, name: id, loops: true, silent: !playable, playable }) as SceneEffectChoice

describe('playSceneOf', () => {
  test('gives each playable clip its url and leaves silent, gone and red rows without one', () => {
    const draft = draftOf(scene)
    draft.effects.push({ ...draft.effects[0]!, id: 'c', mode: 'once', after: 'x' })
    const played = playSceneOf(act, draft, [choice('a', true), choice('b', false)], 'cat')
    expect(played.music).toEqual({ url: '/api/music/tracks/tr/current', level: 0.5 })
    expect(played.rows.map((r) => r.url)).toEqual(['/api/effects/a/current', null, null])
    expect(played.state).toBe('cat')
  })
})

describe('dropKey', () => {
  test('forgets the row removed and moves the keys of the rows after it up', () => {
    const keys = new Set(['music', 'row:0', 'row:2', 'row:3'])
    expect([...dropKey(keys, 2)].sort()).toEqual(['music', 'row:0', 'row:2'])
  })
})

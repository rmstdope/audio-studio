import { describe, expect, it } from 'bun:test'
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Problem } from '../core/project'
import { gameFilePath, readMusic } from './musicLists'
import { loadProject, musicCurrentFile, openProject } from './workspace'

describe('gameFilePath', () => {
  const outside = tempRepo({ 'secret.mp3': 'secret' })
  const root = tempRepo({ 'game/walk.mp3': 'walk', 'content-studio.json': projectJson() })
  mkdirSync(join(root, 'game/dir.mp3'))
  symlinkSync(join(root, 'game/walk.mp3'), join(root, 'game/link.mp3'))
  symlinkSync(outside, join(root, 'linked'))
  symlinkSync(join(outside, 'secret.mp3'), join(root, 'out.mp3'))

  it('is the path of a plain file inside the root', async () => {
    expect(await gameFilePath(root, 'game/walk.mp3')).toBe(join(root, 'game/walk.mp3'))
  })

  it('is null for a missing file, a folder, or a link as the last part', async () => {
    for (const file of ['game/nope.mp3', 'game/dir.mp3', 'game/link.mp3', 'out.mp3'])
      expect(await gameFilePath(root, file)).toBeNull()
  })

  it('is null for a file reached through a linked folder to outside the root', async () => {
    expect(await gameFilePath(root, 'linked/secret.mp3')).toBeNull()
  })

  it('is null for a path that leaves the root', async () => {
    expect(await gameFilePath(root, '../x.mp3')).toBeNull()
  })
})

describe('a music lock that cannot be read', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/stingers.json': [
      { id: 'victory', title: 'Victory', text: 'fanfare', seconds: 5, file: 'game/win.mp3' },
    ],
    'game/win.mp3': 'x',
    'audio/music/victory.mp3': 'x',
    'audio/music/manifest.json': { victory: { file: 'victory.mp3', duration: 5 } },
    'content-studio/music/lock.json': '{ broken',
  })

  it('makes what a track plays not known in the summary, not the game’s own file', async () => {
    const loaded = await loadProject(join(root, 'content-studio.json'))
    if (!loaded.ok) throw new Error('project')
    const stingers = loaded.summary.music!.lists.find((l) => l.kind === 'stingers')!
    expect(stingers.tracks[0]!.current).toEqual({ kind: 'unknown' })
  })

  it('serves no music for the track, not the game’s own file', async () => {
    expect(await musicCurrentFile(join(root, 'content-studio.json'), 'victory')).toBeNull()
  })
})

describe('a music section with one list', () => {
  const read = async (from: Record<string, string>) => {
    const root = tempRepo({
      'content-studio.json': projectJson({
        music: { from, clips: 'audio/music', manifest: 'audio/music/manifest.json' },
      }),
      'content-studio/narration/cast.json': { speakers: {} },
      'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'lute', seconds: 30 }],
      'tts/stingers.json': [{ id: 'victory', title: 'Victory', text: 'fanfare', seconds: 5 }],
    })
    const loaded = await loadProject(join(root, 'content-studio.json'))
    if (!loaded.ok) throw new Error('project')
    return loaded.summary.music!.lists.map((list) => list.id)
  }

  it('has a page per part and no Stingers page without the shared list', async () => {
    expect(await read({ part: 'tts/{part}/music.json' })).toEqual(['act1', 'act2'])
  })

  it('has only the Stingers page without the parts’ lists', async () => {
    expect(await read({ shared: 'tts/stingers.json' })).toEqual(['stingers'])
  })
})

describe('the sample project’s music', () => {
  it('reads every list without a problem', async () => {
    const root = join(import.meta.dir, '../../test/fixtures/sample')
    const opened = await openProject(join(root, 'content-studio.json'))
    if (!opened.ok) throw new Error('the sample did not open')
    const problems: Problem[] = []
    const music = await readMusic(root, opened.project, problems)
    expect(problems).toEqual([])
    expect(music!.lists.find((list) => list.id === 'stingers')!.tracks.length).toBeGreaterThan(0)
  })
})

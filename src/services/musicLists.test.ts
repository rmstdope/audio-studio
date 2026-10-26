import { describe, expect, it } from 'bun:test'
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { gameFilePath } from './musicLists'
import { loadProject } from './workspace'

describe('gameFilePath', () => {
  const outside = tempRepo({ 'secret.mp3': 'secret' })
  const root = tempRepo({ 'game/walk.mp3': 'walk', 'audio-studio.json': projectJson() })
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

describe('readMusic, with a music lock that cannot be read', () => {
  it('says what plays is not known, not that the game plays its own file', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson({
        music: {
          paths: {
            loops: 'tts/{part}/music.json',
            stingers: 'tts/stingers.json',
            briefs: 'music/briefs.json',
            lock: 'music/music.lock.json',
            clips: 'audio/music',
            manifest: 'audio/music/manifest.json',
          },
        },
      }),
      'tts/cast.json': { speakers: {} },
      'tts/stingers.json': [
        { id: 'victory', title: 'Victory', brief: 'fanfare', seconds: 5, file: 'game/win.mp3' },
      ],
      'game/win.mp3': 'x',
      'audio/music/victory.mp3': 'x',
      'audio/music/manifest.json': { victory: { file: 'victory.mp3', duration: 5 } },
      'music/music.lock.json': '{ broken',
    })
    const loaded = await loadProject(join(root, 'audio-studio.json'))
    if (!loaded.ok) throw new Error('project')
    const stingers = loaded.summary.music!.lists.find((l) => l.kind === 'stingers')!
    expect(stingers.tracks[0]!.current).toEqual({ kind: 'unknown' })
  })
})

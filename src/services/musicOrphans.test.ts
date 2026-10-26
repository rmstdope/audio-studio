import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { MUSIC_MODEL } from '../core/musicTake'
import { removeOrphan } from './musicOrphans'

const music = {
  paths: {
    loops: 'tts/{part}/music.json',
    stingers: 'tts/stingers.json',
    briefs: 'music/briefs.json',
    lock: 'music/music.lock.json',
    clips: 'audio/music',
    manifest: 'audio/music/manifest.json',
  },
}
const inputs = { brief: 'x', kind: 'loop', seconds: 30, bpm: null, key: null }
const entry = (list: string) => ({
  fp: '0123456789abcdef',
  model: MUSIC_MODEL,
  seed: 1,
  list,
  take: 1,
  inputs,
  at: '2026-11-02T10:00:00.000Z',
})

/** Act I lists only `hall`; `castle-gates` was chosen there and has been dropped by the game. */
function repo(over: Record<string, unknown> = {}) {
  const root = tempRepo({
    'audio-studio.json': projectJson({ music }),
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', brief: 'warm lute', seconds: 30 }],
    'tts/act2/music.json': [],
    'tts/stingers.json': [],
    'music/music.lock.json': { 'castle-gates': entry('act1'), hall: entry('act1') },
    'audio/music/manifest.json': {
      'castle-gates': { file: 'castle-gates.mp3', duration: 30 },
      hall: { file: 'hall.mp3', duration: 30 },
    },
    'audio/music/castle-gates.mp3': 'mp3',
    'audio/music/hall.mp3': 'mp3',
    'music/briefs.json': { 'castle-gates': { bpm: 70 }, hall: { bpm: 80 } },
    '.audio-studio/music/castle-gates.json': { next: 2, takes: [] },
    '.audio-studio/music/hall.json': { next: 2, takes: [] },
    '.audio-studio/music-takes/castle-gates/0123456789abcdef.1.wav': 'wav',
    '.audio-studio/music-takes/hall/0123456789abcdef.1.wav': 'wav',
    ...over,
  })
  return { root, file: join(root, 'audio-studio.json') }
}
const json = (root: string, path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))

describe('removeOrphan', () => {
  it('deletes the clip, its entries, board, takes and brief changes, and nothing of other tracks', async () => {
    const { root, file } = repo()
    expect(await removeOrphan(file, 'castle-gates')).toEqual({ ok: true })
    expect(existsSync(join(root, 'audio/music/castle-gates.mp3'))).toBe(false)
    expect(json(root, 'audio/music/manifest.json')).toEqual({
      hall: { file: 'hall.mp3', duration: 30 },
    })
    expect(Object.keys(json(root, 'music/music.lock.json'))).toEqual(['hall'])
    expect(json(root, 'music/briefs.json')).toEqual({ hall: { bpm: 80 } })
    expect(existsSync(join(root, '.audio-studio/music/castle-gates.json'))).toBe(false)
    expect(existsSync(join(root, '.audio-studio/music-takes/castle-gates'))).toBe(false)
    expect(existsSync(join(root, 'audio/music/hall.mp3'))).toBe(true)
    expect(existsSync(join(root, '.audio-studio/music/hall.json'))).toBe(true)
    expect(existsSync(join(root, '.audio-studio/music-takes/hall'))).toBe(true)
  })

  it('removes an orphan whose music file is already gone, and one with no briefs entry or board', async () => {
    const { root, file } = repo({
      'audio/music/castle-gates.mp3': undefined,
      'music/briefs.json': undefined,
      '.audio-studio/music/castle-gates.json': undefined,
      '.audio-studio/music-takes/castle-gates/0123456789abcdef.1.wav': undefined,
    })
    expect(await removeOrphan(file, 'castle-gates')).toEqual({ ok: true })
    expect(Object.keys(json(root, 'music/music.lock.json'))).toEqual(['hall'])
  })

  it('is null for a track that is listed, not chosen or unknown, and deletes nothing', async () => {
    const { root, file } = repo()
    expect(await removeOrphan(file, 'hall')).toBeNull()
    expect(await removeOrphan(file, 'nobody')).toBeNull()
    expect(await removeOrphan(file, '../x')).toBeNull()
    expect(existsSync(join(root, 'audio/music/hall.mp3'))).toBe(true)
  })

  it('is null while the list the track came from is missing', async () => {
    const { root, file } = repo({ 'tts/act1/music.json': undefined })
    expect(await removeOrphan(file, 'castle-gates')).toBeNull()
    expect(existsSync(join(root, 'audio/music/castle-gates.mp3'))).toBe(true)
  })

  it('writes and deletes nothing when the manifest cannot be read', async () => {
    const { root, file } = repo({ 'audio/music/manifest.json': '{ nope' })
    const result = await removeOrphan(file, 'castle-gates')
    expect(result).toMatchObject({ ok: false, file: 'audio/music/manifest.json' })
    expect(existsSync(join(root, 'audio/music/castle-gates.mp3'))).toBe(true)
    expect(Object.keys(json(root, 'music/music.lock.json'))).toContain('castle-gates')
    expect(json(root, 'music/briefs.json')).toHaveProperty('castle-gates')
  })

  it('reports the lock’s problems, and deletes nothing, when the lock cannot be read', async () => {
    const { root, file } = repo({ 'music/music.lock.json': '[1]' })
    const result = await removeOrphan(file, 'castle-gates')
    expect(result).toMatchObject({ ok: false, file: 'music/music.lock.json' })
    expect(existsSync(join(root, 'audio/music/castle-gates.mp3'))).toBe(true)
  })

  it('keeps the lock entry when a step fails, so the removal can be done again', async () => {
    const { root, file } = repo()
    // The board is a folder with something in it, which cannot be deleted as a file.
    const board = join(root, '.audio-studio/music/castle-gates.json')
    rmSync(board)
    mkdirSync(join(board, 'inner'), { recursive: true })
    expect(await removeOrphan(file, 'castle-gates')).toMatchObject({ ok: false })
    expect(Object.keys(json(root, 'music/music.lock.json'))).toContain('castle-gates')
    rmSync(board, { recursive: true })
    writeFileSync(board, '{ "next": 2, "takes": [] }')
    expect(await removeOrphan(file, 'castle-gates')).toEqual({ ok: true })
    expect(Object.keys(json(root, 'music/music.lock.json'))).toEqual(['hall'])
  })

  it('removes the orphan even when the briefs cannot be read, and says so', async () => {
    const { root, file } = repo({ 'music/briefs.json': '{ nope' })
    expect(await removeOrphan(file, 'castle-gates')).toMatchObject({
      ok: false,
      file: 'music/briefs.json',
    })
    expect(Object.keys(json(root, 'music/music.lock.json'))).toEqual(['hall'])
    expect(existsSync(join(root, 'audio/music/castle-gates.mp3'))).toBe(false)
  })

  it('removes the orphan of the stingers from their page too', async () => {
    const { root, file } = repo({
      'music/music.lock.json': { fanfare: entry('stingers') },
      'audio/music/manifest.json': { fanfare: { file: 'fanfare.mp3', duration: 5 } },
      'audio/music/fanfare.mp3': 'mp3',
    })
    expect(await removeOrphan(file, 'fanfare')).toEqual({ ok: true })
    expect(existsSync(join(root, 'audio/music/fanfare.mp3'))).toBe(false)
    expect(json(root, 'music/music.lock.json')).toEqual({})
  })
})

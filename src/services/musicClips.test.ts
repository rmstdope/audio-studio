import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { MUSIC_MODEL, type BoardTake } from '../core/musicTake'
import { ProjectSchema } from '../core/project'
import type { Encoder, EncodeOptions } from './audio'
import { commitChoice, readChosen, uncommitChoice } from './musicClips'

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
const config = ProjectSchema.parse(projectJson({ music })).music!

const inputs = { brief: 'warm lute', kind: 'loop' as const, seconds: 30, bpm: null, key: null }
const take = (n: number, over: Partial<BoardTake> = {}): BoardTake => ({
  n,
  hash: '0123456789abcdef',
  seed: 100 + n,
  seconds: 30,
  peaks: [],
  inputs,
  ...over,
})

/** An encoder that writes `mp3` and remembers what it was asked. */
function fakeEncoder(fail = false) {
  const calls: { file: string; options: EncodeOptions }[] = []
  const encode: Encoder = async (_wav, file, options) => {
    calls.push({ file, options })
    mkdirSync(dirname(file), { recursive: true })
    if (fail) throw new Error('ffmpeg could not encode the clip: boom')
    writeFileSync(file, 'mp3')
  }
  return { encode, calls }
}

const at = new Date('2026-11-02T10:00:00.000Z')

describe('commitChoice', () => {
  it('writes the clip, then the manifest and the lock, levelled and encoded as agreed', async () => {
    const root = tempRepo({})
    const { encode, calls } = fakeEncoder()
    const result = await commitChoice({
      root,
      music: config,
      id: 'hall',
      listId: 'act1',
      take: take(2),
      wav: new Uint8Array(4),
      encode,
      now: () => at,
    })
    expect(result).toEqual({ ok: true })
    expect(calls[0]!.options).toEqual({ bitrate: '160k', channels: 2, lufs: -20 })
    expect(readFileSync(join(root, 'audio/music/hall.mp3'), 'utf8')).toBe('mp3')
    expect(JSON.parse(readFileSync(join(root, 'audio/music/manifest.json'), 'utf8'))).toEqual({
      hall: { file: 'hall.mp3', duration: 30 },
    })
    const lock = readFileSync(join(root, 'music/music.lock.json'), 'utf8')
    expect(lock.split('\n')).toHaveLength(4) // { / one entry / } / trailing newline
    expect(JSON.parse(lock).hall).toEqual({
      fp: '0123456789abcdef',
      model: MUSIC_MODEL,
      seed: 102,
      list: 'act1',
      take: 2,
      inputs,
      at: at.toISOString(),
    })
    // The encoder wrote to a hidden file beside the clip, which is gone.
    expect(calls[0]!.file.includes('/.hall.')).toBe(true)
    expect(readdirSync(join(root, 'audio/music')).sort()).toEqual(['hall.mp3', 'manifest.json'])
  })

  it('replaces the entry when another take is chosen and keeps other tracks', async () => {
    const root = tempRepo({})
    const { encode } = fakeEncoder()
    const choose = (id: string, n: number) =>
      commitChoice({
        root,
        music: config,
        id,
        listId: 'act1',
        take: take(n),
        wav: new Uint8Array(4),
        encode,
        now: () => at,
      })
    await choose('hall', 1)
    await choose('cave', 1)
    await choose('hall', 3)
    const lock = JSON.parse(readFileSync(join(root, 'music/music.lock.json'), 'utf8'))
    expect(Object.keys(lock)).toEqual(['cave', 'hall'])
    expect(lock.hall.take).toBe(3)
  })

  it('records the model the take was made with', async () => {
    const root = tempRepo({})
    const { encode } = fakeEncoder()
    await commitChoice({
      root,
      music: config,
      id: 'hall',
      listId: 'act1',
      take: take(1, { model: 'older-model' }),
      wav: new Uint8Array(4),
      encode,
      now: () => at,
    })
    expect(JSON.parse(readFileSync(join(root, 'music/music.lock.json'), 'utf8')).hall.model).toBe(
      'older-model',
    )
  })

  it('writes nothing when the clip cannot be encoded', async () => {
    const root = tempRepo({})
    const { encode } = fakeEncoder(true)
    const result = await commitChoice({
      root,
      music: config,
      id: 'hall',
      listId: 'act1',
      take: take(1),
      wav: new Uint8Array(4),
      encode,
      now: () => at,
    })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('boom') })
    expect(existsSync(join(root, 'music/music.lock.json'))).toBe(false)
    expect(existsSync(join(root, 'audio/music/manifest.json'))).toBe(false)
    expect(readdirSync(join(root, 'audio/music'), { withFileTypes: true }).length).toBe(0)
  })

  it('refuses a broken lock or manifest, writing nothing and leaving no temporary file', async () => {
    const root = tempRepo({ 'music/music.lock.json': '{ nope' })
    const { encode } = fakeEncoder()
    const result = await commitChoice({
      root,
      music: config,
      id: 'hall',
      listId: 'act1',
      take: take(1),
      wav: new Uint8Array(4),
      encode,
      now: () => at,
    })
    expect(result).toMatchObject({ ok: false, file: 'music/music.lock.json' })
    expect(readFileSync(join(root, 'music/music.lock.json'), 'utf8')).toBe('{ nope')
    expect(readdirSync(join(root, 'audio/music'))).toEqual([])
  })
})

describe('readChosen', () => {
  it('reads the lock and whether each clip is a plain file on disk', async () => {
    const root = tempRepo({
      'music/music.lock.json': {
        hall: {
          fp: '0123456789abcdef',
          model: MUSIC_MODEL,
          seed: 1,
          list: 'act1',
          take: 1,
          inputs,
          at: at.toISOString(),
        },
        cave: {
          fp: '0123456789abcdef',
          model: MUSIC_MODEL,
          seed: 1,
          list: 'act1',
          take: 1,
          inputs,
          at: at.toISOString(),
        },
      },
    })
    mkdirSync(join(root, 'audio/music'), { recursive: true })
    writeFileSync(join(root, 'audio/music/hall.mp3'), 'x')
    const problems: never[] = []
    const chosen = await readChosen(root, config, problems)
    expect(chosen.hall?.fileExists).toBe(true)
    expect(chosen.cave?.fileExists).toBe(false)
    expect(problems).toEqual([])
  })

  it('is empty without a lock, and reports a broken one as a problem with its file', async () => {
    const root = tempRepo({})
    expect(await readChosen(root, config, [])).toEqual({})
    const broken = tempRepo({ 'music/music.lock.json': { hall: { fp: 1 } } })
    const problems: { file: string }[] = []
    expect(await readChosen(broken, config, problems as never)).toEqual({})
    expect(problems[0]?.file).toBe('music/music.lock.json')
  })
})

describe('uncommitChoice', () => {
  /** A project with `hall` and `cave` chosen. */
  async function chosen() {
    const root = tempRepo({})
    const { encode } = fakeEncoder()
    for (const id of ['hall', 'cave']) {
      await commitChoice({
        root,
        music: config,
        id,
        listId: 'act1',
        take: take(1),
        wav: new Uint8Array(4),
        encode,
        now: () => at,
      })
    }
    return root
  }
  const readJson = (root: string, file: string) =>
    JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>

  it('deletes the track’s clip, manifest entry and lock entry, and no other track’s', async () => {
    const root = await chosen()
    expect(await uncommitChoice({ root, music: config, id: 'hall' })).toEqual({ ok: true })
    expect(existsSync(join(root, 'audio/music/hall.mp3'))).toBe(false)
    expect(Object.keys(readJson(root, 'audio/music/manifest.json'))).toEqual(['cave'])
    expect(Object.keys(readJson(root, 'music/music.lock.json'))).toEqual(['cave'])
    expect(existsSync(join(root, 'audio/music/cave.mp3'))).toBe(true)
  })

  it('can be done again when the clip is already gone', async () => {
    const root = await chosen()
    rmSync(join(root, 'audio/music/hall.mp3'))
    expect(await uncommitChoice({ root, music: config, id: 'hall' })).toEqual({ ok: true })
    expect(Object.keys(readJson(root, 'music/music.lock.json'))).toEqual(['cave'])
  })

  it('refuses a track with no chosen take, changing nothing', async () => {
    const root = await chosen()
    const result = await uncommitChoice({ root, music: config, id: 'nobody' })
    expect(result).toEqual({ ok: false, message: 'No take is chosen for this track.' })
    expect(Object.keys(readJson(root, 'music/music.lock.json'))).toEqual(['cave', 'hall'])
  })

  it('deletes nothing when the lock cannot be read', async () => {
    const root = await chosen()
    writeFileSync(join(root, 'music/music.lock.json'), '{ nope')
    const result = await uncommitChoice({ root, music: config, id: 'hall' })
    expect(result.ok).toBe(false)
    expect('problems' in result).toBe(true)
    expect(existsSync(join(root, 'audio/music/hall.mp3'))).toBe(true)
  })

  it('deletes nothing when the manifest cannot be read', async () => {
    const root = await chosen()
    writeFileSync(join(root, 'audio/music/manifest.json'), '{ nope')
    const result = await uncommitChoice({ root, music: config, id: 'hall' })
    expect('problems' in result).toBe(true)
    expect(existsSync(join(root, 'audio/music/hall.mp3'))).toBe(true)
    expect(Object.keys(readJson(root, 'music/music.lock.json'))).toEqual(['cave', 'hall'])
  })
})

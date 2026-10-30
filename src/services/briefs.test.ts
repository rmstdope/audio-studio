import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { setTrackBrief } from './briefs'

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
const loops = [
  { id: 'hall', title: 'Hall', brief: 'warm lute', seconds: 80 },
  { id: 'lane', title: 'Lane', brief: 'recorder', seconds: 90, bpm: 84, key: 'D major' },
]
const stingers = [{ id: 'victory', title: 'Victory', brief: 'fanfare', seconds: 6 }]

function repo(extra: Record<string, unknown> = {}) {
  const root = tempRepo({
    'content-studio.json': projectJson({ music }),
    'tts/act1/music.json': loops,
    'tts/stingers.json': stingers,
    ...extra,
  })
  const file = join(root, 'content-studio.json')
  const briefs = () => readFileSync(join(root, 'music/briefs.json'), 'utf8')
  return { root, file, briefs }
}

describe('setTrackBrief', () => {
  it('writes the change to briefs.json, one track to a line', async () => {
    const { file, briefs } = repo()
    expect(await setTrackBrief(file, 'lane', { brief: '  a walk  ' })).toEqual({ ok: true })
    expect(await setTrackBrief(file, 'hall', { bpm: 70 })).toEqual({ ok: true })
    expect(briefs()).toBe('{\n "hall": {"bpm":70},\n "lane": {"brief":"a walk"}\n}\n')
  })

  it('takes a change back when the game’s value is typed again, leaving {} at the end', async () => {
    const { file, briefs } = repo({ 'music/briefs.json': { hall: { seconds: 60 } } })
    await setTrackBrief(file, 'hall', { seconds: 80 })
    expect(briefs()).toBe('{}\n')
  })

  it('means no tempo or key with null, and an empty key', async () => {
    const { file, briefs } = repo()
    await setTrackBrief(file, 'lane', { bpm: null })
    await setTrackBrief(file, 'lane', { key: '  ' })
    expect(JSON.parse(briefs())).toEqual({ lane: { bpm: null, key: null } })
  })

  it('writes briefs.json and nothing else', async () => {
    const { root, file } = repo()
    const files = () =>
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `${entry.parentPath}/${entry.name}`)
        .sort()
    const before = files()
    const lists = readFileSync(join(root, 'tts/act1/music.json'), 'utf8')
    await setTrackBrief(file, 'hall', { brief: 'ours' })
    expect(files()).toEqual([...before, join(root, 'music/briefs.json')].sort())
    expect(readFileSync(join(root, 'tts/act1/music.json'), 'utf8')).toBe(lists)
  })

  it('knows no track that is not listed, and writes nothing for it', async () => {
    const { root, file } = repo()
    expect(await setTrackBrief(file, 'nobody', { brief: 'x' })).toBeNull()
    expect(existsSync(join(root, 'music/briefs.json'))).toBe(false)
  })

  it('refuses an empty brief', async () => {
    const { root, file } = repo()
    const result = await setTrackBrief(file, 'hall', { brief: '   ' })
    expect(result).toMatchObject({ ok: false })
    expect(existsSync(join(root, 'music/briefs.json'))).toBe(false)
  })

  it('refuses a stinger longer than ten seconds, and allows a loop that long', async () => {
    const { file } = repo()
    expect(await setTrackBrief(file, 'victory', { seconds: 11 })).toMatchObject({ ok: false })
    expect(await setTrackBrief(file, 'victory', { seconds: 10 })).toEqual({ ok: true })
    expect(await setTrackBrief(file, 'hall', { seconds: 600 })).toEqual({ ok: true })
  })

  it('never writes over a briefs file it cannot read', async () => {
    const { root, file } = repo({ 'music/briefs.json': '{ not json' })
    const result = await setTrackBrief(file, 'hall', { brief: 'ours' })
    expect(result).toMatchObject({ ok: false, problems: [{ file: 'music/briefs.json' }] })
    expect(readFileSync(join(root, 'music/briefs.json'), 'utf8')).toBe('{ not json')
  })

  it('keeps both of two fields saved at once', async () => {
    const { file, briefs } = repo()
    await Promise.all([
      setTrackBrief(file, 'hall', { brief: 'ours' }),
      setTrackBrief(file, 'hall', { seconds: 60 }),
      setTrackBrief(file, 'lane', { key: 'E minor' }),
    ])
    expect(JSON.parse(briefs())).toEqual({
      hall: { brief: 'ours', seconds: 60 },
      lane: { key: 'E minor' },
    })
  })

  it('knows no track in a project without music', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    expect(
      await setTrackBrief(join(root, 'content-studio.json'), 'hall', { brief: 'x' }),
    ).toBeNull()
  })
})

describe('setTrackBrief and tracks the game dropped', () => {
  const stale = {
    'tts/act2/music.json': [],
    'music/briefs.json': { gone: { bpm: 70 }, kept: { bpm: 80 } },
    '.content-studio/music/gone.json': { next: 2, takes: [] },
    '.content-studio/music-takes/gone/0123456789abcdef.1.wav': 'wav',
    '.content-studio/music/lonely.json': { next: 2, takes: [] },
    'music/music.lock.json': {
      kept: {
        fp: 'f',
        model: 'm',
        seed: 1,
        list: 'act1',
        take: 1,
        inputs: { brief: 'x', kind: 'loop', seconds: 80, bpm: null, key: null },
        at: '2026-11-02T10:00:00.000Z',
      },
    },
    'audio/music/kept.mp3': 'mp3',
    '.content-studio/music/kept.json': { next: 2, takes: [] },
  }

  it('drops the briefs and boards of unlisted tracks never chosen, at the next save', async () => {
    const { root, file, briefs } = repo(stale)
    expect(await setTrackBrief(file, 'hall', { bpm: 70 })).toEqual({ ok: true })
    expect(JSON.parse(briefs())).toEqual({ hall: { bpm: 70 }, kept: { bpm: 80 } })
    expect(existsSync(join(root, '.content-studio/music/gone.json'))).toBe(false)
    expect(existsSync(join(root, '.content-studio/music-takes/gone'))).toBe(false)
    expect(existsSync(join(root, '.content-studio/music/lonely.json'))).toBe(false)
    expect(existsSync(join(root, '.content-studio/music/kept.json'))).toBe(true)
  })

  it('drops nothing while a list is missing', async () => {
    const { root, file, briefs } = repo({ ...stale, 'tts/stingers.json': undefined })
    expect(await setTrackBrief(file, 'hall', { bpm: 70 })).toEqual({ ok: true })
    expect(JSON.parse(briefs())).toHaveProperty('gone')
    expect(existsSync(join(root, '.content-studio/music/gone.json'))).toBe(true)
  })

  it('drops nothing when the lock cannot be read', async () => {
    const { root, file, briefs } = repo({ ...stale, 'music/music.lock.json': '{ nope' })
    expect(await setTrackBrief(file, 'hall', { bpm: 70 })).toEqual({ ok: true })
    expect(JSON.parse(briefs())).toHaveProperty('gone')
    expect(existsSync(join(root, '.content-studio/music/gone.json'))).toBe(true)
  })
})

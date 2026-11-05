import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { keepMyBrief, setTrackBrief } from './briefs'

const music = {
  from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
  clips: 'audio/music',
  manifest: 'audio/music/manifest.json',
}
const loops = [
  { id: 'hall', title: 'Hall', text: 'warm lute', seconds: 80 },
  { id: 'lane', title: 'Lane', text: 'recorder', seconds: 90, bpm: 84, key: 'D major' },
]
const stingers = [{ id: 'victory', title: 'Victory', text: 'fanfare', seconds: 6 }]

function repo(extra: Record<string, unknown> = {}) {
  const root = tempRepo({
    'content-studio.json': projectJson({ music }),
    'tts/act1/music.json': loops,
    'tts/stingers.json': stingers,
    ...extra,
  })
  const file = join(root, 'content-studio.json')
  const briefs = () => readFileSync(join(root, 'content-studio/music/edits.json'), 'utf8')
  return { root, file, briefs }
}

describe('setTrackBrief', () => {
  it('writes the change to the music edits, one track to a line, a brief as text over the game’s', async () => {
    const { file, briefs } = repo()
    expect(await setTrackBrief(file, 'lane', { brief: '  a walk  ' })).toEqual({ ok: true })
    expect(await setTrackBrief(file, 'hall', { bpm: 70 })).toEqual({ ok: true })
    expect(briefs()).toBe(
      '{\n "hall": {"bpm":70},\n "lane": {"text":"a walk","gameWas":"recorder"}\n}\n',
    )
  })

  it('takes a change back when the game’s value is typed again, leaving {} at the end', async () => {
    const { file, briefs } = repo({ 'content-studio/music/edits.json': { hall: { seconds: 60 } } })
    await setTrackBrief(file, 'hall', { seconds: 80 })
    expect(briefs()).toBe('{}\n')
  })

  it('means no tempo or key with null, and an empty key', async () => {
    const { file, briefs } = repo()
    await setTrackBrief(file, 'lane', { bpm: null })
    await setTrackBrief(file, 'lane', { key: '  ' })
    expect(JSON.parse(briefs())).toEqual({ lane: { bpm: null, key: null } })
  })

  it('writes the music edits and nothing else', async () => {
    const { root, file } = repo()
    const files = () =>
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `${entry.parentPath}/${entry.name}`)
        .sort()
    const before = files()
    const lists = readFileSync(join(root, 'tts/act1/music.json'), 'utf8')
    await setTrackBrief(file, 'hall', { brief: 'ours' })
    expect(files()).toEqual([...before, join(root, 'content-studio/music/edits.json')].sort())
    expect(readFileSync(join(root, 'tts/act1/music.json'), 'utf8')).toBe(lists)
  })

  it('knows no track that is not listed, and writes nothing for it', async () => {
    const { root, file } = repo()
    expect(await setTrackBrief(file, 'nobody', { brief: 'x' })).toBeNull()
    expect(existsSync(join(root, 'content-studio/music/edits.json'))).toBe(false)
  })

  it('refuses an empty brief', async () => {
    const { root, file } = repo()
    const result = await setTrackBrief(file, 'hall', { brief: '   ' })
    expect(result).toMatchObject({ ok: false })
    expect(existsSync(join(root, 'content-studio/music/edits.json'))).toBe(false)
  })

  it('refuses a stinger longer than ten seconds, and allows a loop that long', async () => {
    const { file } = repo()
    expect(await setTrackBrief(file, 'victory', { seconds: 11 })).toMatchObject({ ok: false })
    expect(await setTrackBrief(file, 'victory', { seconds: 10 })).toEqual({ ok: true })
    expect(await setTrackBrief(file, 'hall', { seconds: 600 })).toEqual({ ok: true })
  })

  it('never writes over an edits file it cannot read', async () => {
    const { root, file } = repo({ 'content-studio/music/edits.json': '{ not json' })
    const result = await setTrackBrief(file, 'hall', { brief: 'ours' })
    expect(result).toMatchObject({
      ok: false,
      problems: [{ file: 'content-studio/music/edits.json' }],
    })
    expect(readFileSync(join(root, 'content-studio/music/edits.json'), 'utf8')).toBe('{ not json')
  })

  it('keeps both of two fields saved at once', async () => {
    const { file, briefs } = repo()
    await Promise.all([
      setTrackBrief(file, 'hall', { brief: 'ours' }),
      setTrackBrief(file, 'hall', { seconds: 60 }),
      setTrackBrief(file, 'lane', { key: 'E minor' }),
    ])
    expect(JSON.parse(briefs())).toEqual({
      hall: { text: 'ours', gameWas: 'warm lute', seconds: 60 },
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

describe('keepMyBrief', () => {
  it('keeps the studio’s brief over the game’s brief as it is now', async () => {
    const { file, briefs } = repo({
      'content-studio/music/edits.json': { hall: { text: 'ours', gameWas: 'old lute', bpm: 70 } },
    })
    expect(await keepMyBrief(file, 'hall')).toEqual({ ok: true })
    expect(briefs()).toBe('{\n "hall": {"text":"ours","gameWas":"warm lute","bpm":70}\n}\n')
  })

  it('writes nothing for a track whose brief is the game’s, and knows no unlisted track', async () => {
    const { root, file } = repo()
    expect(await keepMyBrief(file, 'hall')).toEqual({ ok: true })
    expect(existsSync(join(root, 'content-studio/music/edits.json'))).toBe(false)
    expect(await keepMyBrief(file, 'nobody')).toBeNull()
  })

  it('never writes over an edits file it cannot read', async () => {
    const { file, briefs } = repo({ 'content-studio/music/edits.json': '{ not json' })
    expect(await keepMyBrief(file, 'hall')).toMatchObject({
      ok: false,
      problems: [{ file: 'content-studio/music/edits.json' }],
    })
    expect(briefs()).toBe('{ not json')
  })
})

describe('setTrackBrief and tracks the game dropped', () => {
  const stale = {
    'tts/act2/music.json': [],
    'content-studio/music/edits.json': { gone: { bpm: 70 }, kept: { bpm: 80 } },
    'content-studio/cache/music/gone.json': { next: 2, takes: [] },
    'content-studio/cache/music-takes/gone/0123456789abcdef.1.wav': 'wav',
    'content-studio/cache/music/lonely.json': { next: 2, takes: [] },
    'content-studio/music/lock.json': {
      kept: {
        fp: 'f',
        model: 'm',
        seed: 1,
        list: 'act1',
        take: 1,
        inputs: { text: 'x', kind: 'loop', seconds: 80, bpm: null, key: null },
        at: '2026-11-02T10:00:00.000Z',
      },
    },
    'audio/music/kept.mp3': 'mp3',
    'content-studio/cache/music/kept.json': { next: 2, takes: [] },
  }

  it('drops the briefs and boards of unlisted tracks never chosen, at the next save', async () => {
    const { root, file, briefs } = repo(stale)
    expect(await setTrackBrief(file, 'hall', { bpm: 70 })).toEqual({ ok: true })
    expect(JSON.parse(briefs())).toEqual({ hall: { bpm: 70 }, kept: { bpm: 80 } })
    expect(existsSync(join(root, 'content-studio/cache/music/gone.json'))).toBe(false)
    expect(existsSync(join(root, 'content-studio/cache/music-takes/gone'))).toBe(false)
    expect(existsSync(join(root, 'content-studio/cache/music/lonely.json'))).toBe(false)
    expect(existsSync(join(root, 'content-studio/cache/music/kept.json'))).toBe(true)
  })

  it('drops nothing while a list is missing', async () => {
    const { root, file, briefs } = repo({ ...stale, 'tts/stingers.json': undefined })
    expect(await setTrackBrief(file, 'hall', { bpm: 70 })).toEqual({ ok: true })
    expect(JSON.parse(briefs())).toHaveProperty('gone')
    expect(existsSync(join(root, 'content-studio/cache/music/gone.json'))).toBe(true)
  })

  it('drops nothing when the lock cannot be read', async () => {
    const { root, file, briefs } = repo({ ...stale, 'content-studio/music/lock.json': '{ nope' })
    expect(await setTrackBrief(file, 'hall', { bpm: 70 })).toEqual({ ok: true })
    expect(JSON.parse(briefs())).toHaveProperty('gone')
    expect(existsSync(join(root, 'content-studio/cache/music/gone.json'))).toBe(true)
  })
})

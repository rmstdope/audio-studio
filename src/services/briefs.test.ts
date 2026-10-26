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
    'audio-studio.json': projectJson({ music }),
    'tts/act1/music.json': loops,
    'tts/stingers.json': stingers,
    ...extra,
  })
  const file = join(root, 'audio-studio.json')
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
    const root = tempRepo({ 'audio-studio.json': projectJson() })
    expect(await setTrackBrief(join(root, 'audio-studio.json'), 'hall', { brief: 'x' })).toBeNull()
  })
})

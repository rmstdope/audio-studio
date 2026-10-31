import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Problem } from '../core/project'
import { loadProject } from './workspace'
import { readImages } from './imageLists'
import {
  markStyleSeen,
  resolveImageCompare,
  setImageActStyle,
  setImageWords,
  setStyleField,
} from './imageEdits'
import { openProject } from './workspace'

const images = {
  paths: {
    list: 'tts/{part}/images.json',
    style: 'images/style.json',
    prompts: 'images/prompts.json',
    lock: 'images/images.lock.json',
    clips: 'web/public/images/generated',
    manifest: 'web/public/images/generated/manifest.json',
  },
}
const inn = { id: 'inn', title: 'Inn', description: 'a low inn', width: 320, height: 200 }
const style = {
  look: 'pixel art',
  keepOut: 'text',
  palette: ['#000000'],
  acts: { act1: 'lantern' },
}

function repo(extra: Record<string, unknown> = {}) {
  const root = tempRepo({
    'content-studio.json': projectJson({ images }),
    'tts/act1/images.json': [inn],
    'images/style.json': style,
    ...extra,
  })
  const file = join(root, 'content-studio.json')
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  const summary = async () => {
    const opened = await openProject(file)
    if (!opened.ok) throw new Error('project')
    const problems: Problem[] = []
    return { images: await readImages(root, opened.project, problems), problems }
  }
  return { root, file, read, summary }
}

describe('readImages', () => {
  it('is null without an images section', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const opened = await openProject(join(root, 'content-studio.json'))
    if (!opened.ok) throw new Error('project')
    expect(await readImages(root, opened.project, [])).toBeNull()
  })

  it('reads the lists, the style and the studio’s words; a missing list is not a problem', async () => {
    const { summary } = repo({
      'images/prompts.json': {
        images: { inn: { words: 'cosy', gameWas: 'a low inn' } },
        style: {},
      },
    })
    const { images: read, problems } = await summary()
    expect(problems).toEqual([])
    expect(read!.acts.map((act) => act.state)).toEqual(['ok', 'missing'])
    expect(read!.acts[0]!.rows[0]).toMatchObject({
      words: 'cosy',
      changed: true,
      gameChanged: false,
    })
  })

  it('reports a broken list with its file and path, and leaves its images out', async () => {
    const { summary } = repo({ 'tts/act1/images.json': [{ ...inn, width: 0 }] })
    const { images: read, problems } = await summary()
    expect(problems[0]).toMatchObject({ file: 'tts/act1/images.json', path: '[0].width' })
    expect(read!.acts[0]!.state).toBe('invalid')
  })

  it('reads what a chosen take was made from from the lock', async () => {
    const first = (await repo().summary()).images!.acts[0]!.rows[0]!
    const { summary } = repo({
      'images/images.lock.json': { images: { inn: { chosen: first.madeFrom } } },
    })
    expect((await summary()).images!.acts[0]!.rows[0]!.status).toBe('chosen')
  })

  it('remembers the style it first saw in the studio’s own folder', async () => {
    const { summary, read } = repo()
    await summary()
    expect(JSON.parse(read('.content-studio/images-style-seen.json'))).toEqual(style)
  })

  it('moves the remembered style along when a change leaves nothing out of date', async () => {
    const { root, summary, read } = repo()
    await summary()
    writeFileSync(join(root, 'images/style.json'), JSON.stringify({ ...style, look: 'oil' }))
    await summary()
    expect(JSON.parse(read('.content-studio/images-style-seen.json')).look).toBe('oil')
  })

  it('tells a style the game could not be read from one it has not written yet', async () => {
    const { summary } = repo({ 'images/style.json': '{nope' })
    const { images: read, problems } = await summary()
    expect(read!.style).toMatchObject({ present: false, invalid: true })
    expect(problems[0]).toMatchObject({ file: 'images/style.json' })
    expect((await repo({ 'images/style.json': undefined }).summary()).images!.style.invalid).toBe(
      false,
    )
  })
})

describe('saving the studio’s own words', () => {
  it('keeps the words with the game’s words they were written over, and the game’s files as they were', async () => {
    const { root, file, read } = repo()
    const before = [read('tts/act1/images.json'), read('images/style.json')]
    expect(await setImageWords(file, 'inn', ' a cosy inn ')).toEqual({ ok: true })
    expect(JSON.parse(read('images/prompts.json'))).toEqual({
      images: { inn: { words: 'a cosy inn', gameWas: 'a low inn' } },
      style: {},
    })
    expect([read('tts/act1/images.json'), read('images/style.json')]).toEqual(before)
    expect(existsSync(join(root, 'tts/act1/images.json.tmp'))).toBe(false)
  })

  it('writes the style keys in a fixed order', async () => {
    const { file, read } = repo()
    await setStyleField(file, 'keepOut', 'nothing')
    await setStyleField(file, 'look', 'oil paint')
    expect(Object.keys(JSON.parse(read('images/prompts.json')).style)).toEqual(['look', 'keepOut'])
  })

  it('takes them back with null', async () => {
    const { file, read } = repo()
    await setImageWords(file, 'inn', 'cosy')
    await setImageWords(file, 'inn', null)
    expect(JSON.parse(read('images/prompts.json')).images).toEqual({})
  })

  it('is null for an image the game does not list, and refuses a broken prompts file', async () => {
    const { file } = repo({ 'images/prompts.json': '{nope' })
    expect(await setImageWords(file, 'ghost', 'x')).toBeNull()
    const refused = await setImageWords(file, 'inn', 'x')
    expect(refused).toMatchObject({ ok: false })
  })

  it('keeps an image’s leaving out of its act’s style, and takes it back, touching no game file', async () => {
    const { file, read } = repo()
    const before = [read('tts/act1/images.json'), read('images/style.json')]
    expect(await setImageActStyle(file, 'inn', false)).toEqual({ ok: true })
    expect(JSON.parse(read('images/prompts.json'))).toEqual({
      images: {},
      style: {},
      actStyleOff: ['inn'],
    })
    expect([read('tts/act1/images.json'), read('images/style.json')]).toEqual(before)
    await setImageWords(file, 'inn', 'cosy')
    expect(JSON.parse(read('images/prompts.json')).actStyleOff).toEqual(['inn'])
    expect(await setImageActStyle(file, 'inn', true)).toEqual({ ok: true })
    expect('actStyleOff' in JSON.parse(read('images/prompts.json'))).toBe(false)
    expect(await setImageActStyle(file, 'ghost', false)).toBeNull()
  })

  it('saves a style field over the game’s', async () => {
    const { file, read } = repo()
    expect(await setStyleField(file, 'look', 'oil paint')).toEqual({ ok: true })
    expect(JSON.parse(read('images/prompts.json')).style).toEqual({
      look: { words: 'oil paint', gameWas: 'pixel art' },
    })
  })
})

describe('the game’s words changed under the user’s', () => {
  it('Keep mine accepts the new words as the baseline; Use the game’s drops the user’s', async () => {
    const { file, read, summary } = repo({
      'images/prompts.json': { images: { inn: { words: 'cosy', gameWas: 'older' } }, style: {} },
    })
    expect((await summary()).images!.acts[0]!.rows[0]!.gameChanged).toBe(true)
    await resolveImageCompare(file, 'inn', 'keep')
    expect(JSON.parse(read('images/prompts.json')).images.inn).toEqual({
      words: 'cosy',
      gameWas: 'a low inn',
    })
    expect((await summary()).images!.acts[0]!.rows[0]!.gameChanged).toBe(false)
    await resolveImageCompare(file, 'inn', 'game')
    expect(JSON.parse(read('images/prompts.json')).images).toEqual({})
  })
})

describe('the game’s style changed', () => {
  it('shows one notice until Seen, remembered across reads, and back on the next change', async () => {
    const { root, file, summary } = repo()
    const first = (await summary()).images!.acts[0]!.rows[0]!
    writeFileSync(
      join(root, 'images/images.lock.json'),
      JSON.stringify({ images: { inn: { chosen: first.madeFrom } } }),
    )
    writeFileSync(join(root, 'images/style.json'), JSON.stringify({ ...style, look: 'oil' }))
    expect((await summary()).images!.styleNotice).toEqual({ count: 1, changed: ['the look'] })
    expect((await summary()).images!.styleNotice).not.toBeNull()
    expect(await markStyleSeen(file)).toEqual({ ok: true })
    const after = (await summary()).images!
    expect(after.styleNotice).toBeNull()
    expect(after.acts[0]!.rows[0]!.status).toBe('out of date')
    writeFileSync(
      join(root, 'images/style.json'),
      JSON.stringify({ ...style, look: 'oil', keepOut: 'x' }),
    )
    expect((await summary()).images!.styleNotice?.changed).toEqual(['what is kept out'])
  })
})

describe('through the project load', () => {
  it('puts the images in the summary', async () => {
    const { file } = repo()
    const loaded = await loadProject(file)
    expect(loaded.ok && loaded.summary.images?.acts[0]?.rows).toHaveLength(1)
  })
})

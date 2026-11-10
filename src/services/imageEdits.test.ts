import { describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Problem } from '../core/project'
import { loadProject } from './workspace'
import { readImages } from './imageLists'
import {
  resolveImageCompare,
  resolveImagePatchCompare,
  setImageActStyle,
  setImageActStylePick,
  setImageAreaBox,
  setImagePatchWords,
  setImageWords,
  setStyleField,
  type ImageEditResult,
} from './imageEdits'
import { openProject } from './workspace'

const images = {
  from: { part: 'tts/{part}/images.json' },
  clips: 'web/public/images/generated',
  manifest: 'web/public/images/generated/manifest.json',
}
const EDITS = 'content-studio/images/edits.json'
const inn = { id: 'inn', title: 'Inn', text: 'a low inn', width: 320, height: 200 }
const style = {
  look: 'pixel art',
  keepOut: 'text',
  palette: ['#000000'],
  parts: { act1: 'lantern' },
}

function repo(extra: Record<string, unknown> = {}) {
  const root = tempRepo({
    'content-studio.json': projectJson({ images }),
    'tts/act1/images.json': [inn],
    [EDITS]: { style, images: {} },
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
      [EDITS]: { style, images: { inn: { text: 'cosy', gameWas: 'a low inn' } } },
    })
    const { images: read, problems } = await summary()
    expect(problems).toEqual([])
    expect(read!.acts.map((act) => act.state)).toEqual(['ok', 'missing'])
    expect(read!.acts[0]!.rows[0]).toMatchObject({
      words: 'cosy',
      changed: true,
      gameChanged: false,
    })
    expect(read!.style).toMatchObject({ present: true, look: 'pixel art', keepOut: 'text' })
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
      'content-studio/images/lock.json': {
        inn: {
          inputs: {
            text: first.madeFrom.words,
            width: first.madeFrom.width,
            height: first.madeFrom.height,
            style: { look: 'pixel art', keepOut: 'text', part: 'lantern' },
          },
        },
      },
    })
    expect((await summary()).images!.acts[0]!.rows[0]!.status).toBe('chosen')
  })

  it('keeps no copy of the style in the cache', async () => {
    const { root, summary } = repo()
    await summary()
    expect(existsSync(join(root, 'content-studio/cache/images-style-seen.json'))).toBe(false)
  })

  it('leaves out only an image whose edit is bad, keeping the style and the others', async () => {
    const two = [inn, { ...inn, id: 'well', title: 'Well' }]
    const { summary } = repo({
      'tts/act1/images.json': two,
      [EDITS]: {
        style,
        images: { inn: { text: 'cosy', gameWas: 'a low inn' }, well: { text: 'deep' } },
      },
    })
    const { images: read, problems } = await summary()
    expect(problems.map((p) => [p.file, p.path])).toEqual([[EDITS, 'images.well']])
    expect(read!.style).toMatchObject({ present: true, invalid: false, look: 'pixel art' })
    const [cosy, well] = read!.acts[0]!.rows
    expect(cosy).toMatchObject({ words: 'cosy', changed: true })
    expect(well).toMatchObject({ words: 'a low inn', changed: false })
    expect(well!.prompt).toContain('pixel art')
  })

  it('keeps the rewordings when the style is bad', async () => {
    const { summary } = repo({
      [EDITS]: { style: { keepOut: 'x' }, images: { inn: { text: 'cosy', gameWas: 'a low inn' } } },
    })
    const { images: read, problems } = await summary()
    expect(problems.map((p) => p.path)).toEqual(['style.look'])
    expect(read!.style).toMatchObject({ present: false, invalid: true })
    expect(read!.acts[0]!.rows[0]).toMatchObject({ words: 'cosy', changed: true })
  })

  it('tells edits that cannot be read from a project with no style yet', async () => {
    const { summary } = repo({ [EDITS]: '{nope' })
    const { images: read, problems } = await summary()
    expect(read!.style).toMatchObject({ present: false, invalid: true })
    expect(problems[0]).toMatchObject({ file: EDITS })
    const none = (await repo({ [EDITS]: undefined }).summary()).images!.style
    expect(none).toMatchObject({ present: false, invalid: false })
  })
})

describe('saving the studio’s own words', () => {
  it('keeps the words with the game’s words they were written over, and the game’s files as they were', async () => {
    const { root, file, read } = repo()
    const before = read('tts/act1/images.json')
    expect(await setImageWords(file, 'inn', ' a cosy inn ')).toEqual({ ok: true })
    expect(JSON.parse(read(EDITS))).toEqual({
      style,
      images: { inn: { text: 'a cosy inn', gameWas: 'a low inn' } },
    })
    expect(read('tts/act1/images.json')).toEqual(before)
    expect(existsSync(join(root, 'tts/act1/images.json.tmp'))).toBe(false)
  })

  it('writes the style first, its keys in a fixed order, and the images by id', async () => {
    const { file, read } = repo({
      [EDITS]: { images: {}, style: { parts: { act1: 'lantern' }, keepOut: 'x', look: 'pixels' } },
      'tts/act1/images.json': [{ ...inn, id: 'well' }, inn],
    })
    await setImageWords(file, 'well', 'deep')
    await setImageWords(file, 'inn', 'cosy')
    const saved = JSON.parse(read(EDITS))
    expect(Object.keys(saved)).toEqual(['style', 'images'])
    expect(Object.keys(saved.style)).toEqual(['look', 'keepOut', 'parts'])
    expect(Object.keys(saved.images)).toEqual(['inn', 'well'])
  })

  it('takes them back with null', async () => {
    const { file, read } = repo()
    await setImageWords(file, 'inn', 'cosy')
    await setImageWords(file, 'inn', null)
    expect(JSON.parse(read(EDITS)).images).toEqual({})
  })

  it('refuses to save over edits with a bad part, leaving the file as it was', async () => {
    const { file, read } = repo({
      [EDITS]: { style, images: { well: { text: 'deep' } } },
    })
    const before = read(EDITS)
    const refused = await setImageWords(file, 'inn', 'cosy')
    expect(refused).toMatchObject({ ok: false, problems: [{ file: EDITS, path: 'images.well' }] })
    expect(read(EDITS)).toBe(before)
  })

  it('is null for an image the game does not list, and refuses broken edits', async () => {
    const { file } = repo({ [EDITS]: '{nope' })
    expect(await setImageWords(file, 'ghost', 'x')).toBeNull()
    const refused = await setImageWords(file, 'inn', 'x')
    expect(refused).toMatchObject({ ok: false })
  })

  it('keeps an image’s leaving out of its act’s style, and takes it back, touching no game file', async () => {
    const { file, read } = repo()
    const before = read('tts/act1/images.json')
    expect(await setImageActStyle(file, 'inn', false)).toEqual({ ok: true })
    expect(JSON.parse(read(EDITS))).toEqual({ style, images: { inn: { partStyle: null } } })
    expect(read('tts/act1/images.json')).toEqual(before)
    await setImageWords(file, 'inn', 'cosy')
    expect(JSON.parse(read(EDITS)).images.inn).toEqual({
      text: 'cosy',
      gameWas: 'a low inn',
      partStyle: null,
    })
    expect(await setImageActStyle(file, 'inn', true)).toEqual({ ok: true })
    expect(JSON.parse(read(EDITS)).images.inn).toEqual({ text: 'cosy', gameWas: 'a low inn' })
    expect(await setImageActStyle(file, 'ghost', false)).toBeNull()
  })

  it('keeps which act’s style a shared image uses, and None, in the studio’s own file', async () => {
    const two = {
      'tts/act2/images.json': [inn],
      [EDITS]: { style: { ...style, parts: { act1: 'lantern', act2: 'dawn' } }, images: {} },
    }
    const { file, read, summary } = repo(two)
    expect(await setImageActStylePick(file, 'inn', 'act2')).toEqual({ ok: true })
    expect(JSON.parse(read(EDITS)).images).toEqual({ inn: { partStyle: 'act2' } })
    expect(await setImageActStylePick(file, 'inn', null)).toEqual({ ok: true })
    expect(JSON.parse(read(EDITS)).images).toEqual({ inn: { partStyle: null } })
    expect(await setImageActStylePick(file, 'inn', 'act2')).toEqual({ ok: true })
    expect((await summary()).images!.acts[1]!.rows[0]!.actStyle?.pick).toBe('act2')
  })

  it('refuses a pick of an act that does not list the image or adds no style', async () => {
    const { file, read } = repo({ 'tts/act2/images.json': [inn] })
    const before = read(EDITS)
    expect(await setImageActStylePick(file, 'inn', 'act9')).toBeNull()
    expect(await setImageActStylePick(file, 'inn', 'act2')).toBeNull() // act2 adds no style
    expect(await setImageActStylePick(file, 'ghost', null)).toBeNull()
    expect(read(EDITS)).toBe(before)
  })

  it('sets the style’s look and what is kept out directly', async () => {
    const { file, read } = repo()
    expect(await setStyleField(file, 'look', ' oil paint ')).toEqual({ ok: true })
    expect(await setStyleField(file, 'keepOut', null)).toEqual({ ok: true })
    expect(JSON.parse(read(EDITS)).style).toEqual({
      look: 'oil paint',
      palette: ['#000000'],
      parts: { act1: 'lantern' },
    })
  })

  it('refuses an empty look, and is null without a style', async () => {
    const { file, read } = repo()
    const before = read(EDITS)
    expect(await setStyleField(file, 'look', ' ')).toEqual({
      ok: false,
      problems: [{ file: EDITS, path: 'style.look', message: 'the look cannot be empty' }],
    })
    expect(read(EDITS)).toBe(before)
    const bare = repo({ [EDITS]: undefined })
    expect(await setStyleField(bare.file, 'look', 'oil')).toBeNull()
    expect(existsSync(join(bare.root, EDITS))).toBe(false)
  })
})

describe('the game’s words changed under the user’s', () => {
  it('Keep mine accepts the new words as the baseline; Use the game’s drops the user’s', async () => {
    const { file, read, summary } = repo({
      [EDITS]: { style, images: { inn: { text: 'cosy', gameWas: 'older' } } },
    })
    expect((await summary()).images!.acts[0]!.rows[0]!.gameChanged).toBe(true)
    await resolveImageCompare(file, 'inn', 'keep')
    expect(JSON.parse(read(EDITS)).images.inn).toEqual({
      text: 'cosy',
      gameWas: 'a low inn',
    })
    expect((await summary()).images!.acts[0]!.rows[0]!.gameChanged).toBe(false)
    await resolveImageCompare(file, 'inn', 'game')
    expect(JSON.parse(read(EDITS)).images).toEqual({})
  })
})

describe('through the project load', () => {
  it('puts the images in the summary', async () => {
    const { file } = repo()
    const loaded = await loadProject(file)
    expect(loaded.ok && loaded.summary.images?.acts[0]?.rows).toHaveLength(1)
  })

  it('says why when the edits cannot be written, for the words, the act-style box and the style', async () => {
    const { root, file, read } = repo()
    const before = read(EDITS)
    chmodSync(join(root, 'content-studio/images'), 0o555)
    try {
      const failed: ImageEditResult = {
        ok: false,
        problems: [{ file: EDITS, path: '', message: 'permission denied' }],
      }
      expect(await setImageWords(file, 'inn', 'a cosy inn')).toEqual(failed)
      expect(await setImageActStyle(file, 'inn', false)).toEqual(failed)
      expect(await setStyleField(file, 'look', 'oil')).toEqual(failed)
    } finally {
      chmodSync(join(root, 'content-studio/images'), 0o755)
    }
    expect(read(EDITS)).toBe(before)
  })
})

describe('the words of a patch the game asks for', () => {
  const lamp = { id: 'lamp-lit', title: 'Lamp lit', text: 'Light the lamp' }
  const patched = () => repo({ 'tts/act1/images.json': [{ ...inn, patches: [lamp] }] })

  it('keeps them with the game’s words, in the image’s edit, and touches no game file', async () => {
    const { file, read } = patched()
    const before = read('tts/act1/images.json')
    expect(await setImagePatchWords(file, 'inn', 'lamp-lit', ' Dim the lamp ')).toEqual({
      ok: true,
    })
    expect(JSON.parse(read(EDITS))).toEqual({
      style,
      images: {
        inn: { patches: { 'lamp-lit': { text: 'Dim the lamp', gameWas: 'Light the lamp' } } },
      },
    })
    expect(read('tts/act1/images.json')).toEqual(before)
  })

  it('takes them back with null, leaving the image’s own words', async () => {
    const { file, read } = patched()
    await setImageWords(file, 'inn', 'cosy')
    await setImagePatchWords(file, 'inn', 'lamp-lit', 'Dim')
    await setImagePatchWords(file, 'inn', 'lamp-lit', null)
    expect(JSON.parse(read(EDITS)).images).toEqual({ inn: { text: 'cosy', gameWas: 'a low inn' } })
  })

  it('is null for an image or a patch the game does not list, and refuses broken edits', async () => {
    const { file } = patched()
    expect(await setImagePatchWords(file, 'ghost', 'lamp-lit', 'x')).toBeNull()
    expect(await setImagePatchWords(file, 'inn', 'ghost', 'x')).toBeNull()
    const broken = repo({
      'tts/act1/images.json': [{ ...inn, patches: [lamp] }],
      [EDITS]: '{nope',
    })
    expect(await setImagePatchWords(broken.file, 'inn', 'lamp-lit', 'x')).toMatchObject({
      ok: false,
    })
  })

  it('settles a changed patch: keep mine moves the baseline, the game’s drops mine', async () => {
    const { file, read } = repo({
      'tts/act1/images.json': [{ ...inn, patches: [lamp] }],
      [EDITS]: {
        style,
        images: { inn: { patches: { 'lamp-lit': { text: 'Dim', gameWas: 'Light it' } } } },
      },
    })
    expect(await resolveImagePatchCompare(file, 'inn', 'lamp-lit', 'keep')).toEqual({ ok: true })
    expect(JSON.parse(read(EDITS)).images.inn.patches['lamp-lit']).toEqual({
      text: 'Dim',
      gameWas: 'Light the lamp',
    })
    expect(await resolveImagePatchCompare(file, 'inn', 'lamp-lit', 'game')).toEqual({ ok: true })
    expect(JSON.parse(read(EDITS)).images).toEqual({})
  })
})

describe('the box of a named area', () => {
  const box = { x: 10, y: 20, width: 50, height: 40 }
  const MANIFEST = 'web/public/images/generated/manifest.json'
  const entry = { file: 'inn.png', width: 320, height: 200 }
  const withArea = () =>
    repo({
      'tts/act1/images.json': [{ ...inn, areas: [{ id: 'fountain', title: 'Fountain' }] }],
      [MANIFEST]: { inn: entry },
    })

  it('is kept in the image’s edit and touches no game file', async () => {
    const { file, read } = withArea()
    const before = read('tts/act1/images.json')
    expect(await setImageAreaBox(file, 'inn', 'fountain', box)).toEqual({ ok: true })
    expect(JSON.parse(read(EDITS))).toEqual({
      style,
      images: { inn: { areas: { fountain: box } } },
    })
    expect(read('tts/act1/images.json')).toEqual(before)
  })

  it('keeps a point in the file, leaves the game’s areas as they were, and refuses one outside the box', async () => {
    const { file, read } = withArea()
    const pointed = { ...box, point: { x: 20, y: 30 } }
    expect(await setImageAreaBox(file, 'inn', 'fountain', pointed)).toEqual({ ok: true })
    expect(JSON.parse(read(EDITS)).images.inn.areas.fountain).toEqual(pointed)
    expect(JSON.parse(read(MANIFEST)).inn.areas.fountain).toEqual({
      x: 0.03125,
      y: 0.1,
      width: 0.15625,
      height: 0.2,
    })
    const before = read(EDITS)
    const out = await setImageAreaBox(file, 'inn', 'fountain', { ...box, point: { x: 5, y: 30 } })
    expect(out).toMatchObject({ ok: false })
    expect(read(EDITS)).toBe(before)
  })

  it('is taken away with null', async () => {
    const { file, read } = withArea()
    await setImageAreaBox(file, 'inn', 'fountain', box)
    await setImageAreaBox(file, 'inn', 'fountain', null)
    expect(JSON.parse(read(EDITS)).images).toEqual({})
  })

  it('answers a problem for a box outside the picture, and null for an unlisted image or area', async () => {
    const { file, read } = withArea()
    const before = read(EDITS)
    const result = await setImageAreaBox(file, 'inn', 'fountain', { ...box, width: 400 })
    expect(result).toMatchObject({ ok: false })
    expect(read(EDITS)).toBe(before)
    expect(await setImageAreaBox(file, 'ghost', 'fountain', box)).toBeNull()
    expect(await setImageAreaBox(file, 'inn', 'ghost', box)).toBeNull()
  })

  it('reaches the game in the same save, and leaves with a clear', async () => {
    const { file, read } = withArea()
    await setImageAreaBox(file, 'inn', 'fountain', box)
    expect(JSON.parse(read(MANIFEST)).inn.areas).toEqual({
      fountain: { x: 0.03125, y: 0.1, width: 0.15625, height: 0.2 },
    })
    await setImageAreaBox(file, 'inn', 'fountain', null)
    expect(JSON.parse(read(MANIFEST))).toEqual({ inn: entry })
  })

  it('goes back when the manifest cannot be read, saving nothing', async () => {
    const r = repo({
      'tts/act1/images.json': [{ ...inn, areas: [{ id: 'fountain', title: 'Fountain' }] }],
      [MANIFEST]: '{nope',
    })
    const before = r.read(EDITS)
    const result = await setImageAreaBox(r.file, 'inn', 'fountain', box)
    expect(result).toMatchObject({
      ok: false,
      problems: [{ message: 'the images manifest could not be read' }],
    })
    expect(r.read(EDITS)).toBe(before)
  })

  it('goes back when the image has no entry, but a clear still works', async () => {
    const r = repo({
      'tts/act1/images.json': [{ ...inn, areas: [{ id: 'fountain', title: 'Fountain' }] }],
      [MANIFEST]: {},
    })
    const before = r.read(EDITS)
    expect(await setImageAreaBox(r.file, 'inn', 'fountain', box)).toMatchObject({
      ok: false,
      problems: [{ message: 'the image has no entry in the images manifest' }],
    })
    expect(r.read(EDITS)).toBe(before)
    expect(await setImageAreaBox(r.file, 'inn', 'fountain', null)).toEqual({ ok: true })
  })

  it('goes back when the manifest cannot be written', async () => {
    const r = withArea()
    const before = r.read(EDITS)
    const dir = join(r.root, 'web/public/images/generated')
    chmodSync(dir, 0o555)
    const result = await setImageAreaBox(r.file, 'inn', 'fountain', box)
    chmodSync(dir, 0o755)
    expect(result).toMatchObject({ ok: false, problems: [{ message: 'permission denied' }] })
    expect(r.read(EDITS)).toBe(before)
  })

  it('writes nothing over edits that cannot be read', async () => {
    const broken = repo({
      'tts/act1/images.json': [{ ...inn, areas: [{ id: 'fountain', title: 'Fountain' }] }],
      [EDITS]: '{nope',
    })
    expect(await setImageAreaBox(broken.file, 'inn', 'fountain', box)).toMatchObject({ ok: false })
    expect(broken.read(EDITS)).toBe('{nope')
  })
})

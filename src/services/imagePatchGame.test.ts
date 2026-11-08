import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { makeAgainOf, type ImagePatchesView } from '../core/imagePatches'
import { readImages } from './imageLists'
import { createImagePatches } from './imagePatches'
import { createImageTakes } from './imageTakes'
import type { ImageGenerator } from './images'
import { fakePng } from './imagesFake'
import { decodePng, encodePng } from './png'
import { createSerial } from './serial'
import { openProject } from './workspace'

const images = {
  from: { part: 'tts/{part}/images.json' },
  clips: 'web/images',
  manifest: 'web/images/manifest.json',
}
const inn = {
  id: 'inn',
  title: 'Inn',
  text: 'a low inn',
  width: 320,
  height: 200,
  patches: [{ id: 'door', title: 'The door', text: 'the door is gone' }],
}
const EDITS = 'content-studio/images/edits.json'
const MANIFEST = 'web/images/manifest.json'
const warm = ['#000000', '#ffffff', '#ff0000']
const area = { x: 200, y: 100, width: 400, height: 300 }
const FOLDER = 'content-studio/cache/image-patches/inn/door'

/** An image `inn` with a patch, two takes of it made and take 2 chosen, a patch take made on it and chosen. */
async function chosenPatch() {
  const root = tempRepo({
    'content-studio.json': projectJson({ images }),
    'tts/act1/images.json': [inn],
    [EDITS]: {
      style: { look: 'pixel art', keepOut: 'text', palette: warm, parts: {} },
      images: {},
    },
  })
  const file = join(root, 'content-studio.json')
  const generator: ImageGenerator = {
    ready: () => ({ ok: true }),
    installed: () => true,
    async generate(request) {
      if (!request.editing) {
        return { png: fakePng(request.width, request.height, request.seed), seed: request.seed }
      }
      // an edit paints the whole picture white, or red: the patch differs from the take
      const data = new Uint8Array(request.width * request.height * 4)
      for (let i = 0; i < data.length; i += 4) {
        data.set(request.seed % 2 ? [255, 255, 255, 255] : [255, 0, 0, 255], i)
      }
      return {
        png: encodePng({ width: request.width, height: request.height, data }),
        seed: request.seed,
      }
    },
  }
  let seed = 1
  const common = { generator, queue: createSerial(), free: () => {}, newSeed: () => seed++ }
  const takes = createImageTakes(common)
  const patches = createImagePatches(common)
  const wait = async () => {
    for (let i = 0; i < 400; i++) {
      const view = (await patches.view(file, 'inn')) as ImagePatchesView
      const mine = view.patches[0]!
      if (!mine.making.length && !mine.takes.some((t) => t.look === 'bringing')) return view
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('never finished')
  }
  await takes.make(file, 'inn', { count: 2 })
  for (let i = 0; i < 400; i++) {
    const view = await takes.view(file, 'inn')
    if (view && 'takes' in view && view.takes.length === 2 && !view.making.length) {
      if (view.takes.every((t) => t.look !== 'bringing')) break
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(await takes.choose(file, 'inn', 2)).toEqual({ ok: true })
  expect(await patches.make(file, 'inn', 'door', { count: 1, area })).toEqual({ ok: true })
  await wait()
  expect(await patches.choose(file, 'inn', 'door', 1)).toEqual({ ok: true })
  const read = (path: string) => readFileSync(join(root, path))
  const manifest = () => JSON.parse(read(MANIFEST).toString('utf8'))
  return { root, file, takes, patches, wait, read, manifest }
}

describe('a chosen patch across the image’s own choices', () => {
  it('leaves the list the game reads when another take of the image is chosen, and comes back with the original', async () => {
    const s = await chosenPatch()
    const picture = s.read('web/images/inn.door.png')
    expect(s.manifest().inn.patches.door).toEqual({
      file: 'inn.door.png',
      width: 320,
      height: 200,
    })
    expect(await s.takes.choose(s.file, 'inn', 1)).toEqual({ ok: true })
    expect(s.manifest().inn).toEqual({ file: 'inn.png', width: 320, height: 200 })
    // nothing was removed from the folder, and the patch still says it is chosen
    expect(existsSync(join(s.root, 'web/images/inn.door.png'))).toBe(true)
    expect(JSON.parse(s.read(`${FOLDER}/board.json`).toString())).toMatchObject({
      chosen: { '2': 1 },
      inGame: { '2': 1 },
    })
    expect(await s.takes.choose(s.file, 'inn', 2)).toEqual({ ok: true })
    expect(Object.keys(s.manifest().inn.patches)).toEqual(['door'])
    expect(s.read('web/images/inn.door.png')).toEqual(picture)
  })

  it('takes the patches out of the list with the image, leaving their pictures, and puts them back', async () => {
    const s = await chosenPatch()
    expect(await s.takes.unchoose(s.file, 'inn')).toEqual({ ok: true })
    expect(s.manifest()).toEqual({})
    expect(existsSync(join(s.root, 'web/images/inn.png'))).toBe(false)
    expect(existsSync(join(s.root, 'web/images/inn.door.png'))).toBe(true)
    expect(await s.takes.choose(s.file, 'inn', 2)).toEqual({ ok: true })
    expect(s.manifest().inn.patches.door.file).toBe('inn.door.png')
  })

  it('restores the picture of the take that was in the game on the take chosen again', async () => {
    const s = await chosenPatch()
    // a patch of the same name chosen on take 1 of the image: one file name, two pictures
    expect(await s.takes.choose(s.file, 'inn', 1)).toEqual({ ok: true })
    expect(
      await s.patches.make(s.file, 'inn', 'door', {
        count: 1,
        area: { x: 10, y: 10, width: 300, height: 300 },
      }),
    ).toEqual({ ok: true })
    await s.wait()
    const view = (await s.patches.view(s.file, 'inn')) as ImagePatchesView
    const second = view.patches[0]!.takes.at(-1)!.n
    expect(await s.patches.choose(s.file, 'inn', 'door', second)).toEqual({ ok: true })
    const forOne = s.read('web/images/inn.door.png')
    expect(await s.takes.choose(s.file, 'inn', 2)).toEqual({ ok: true })
    expect(s.read('web/images/inn.door.png')).not.toEqual(forOne)
    expect(await s.takes.choose(s.file, 'inn', 1)).toEqual({ ok: true })
    expect(s.read('web/images/inn.door.png')).toEqual(forOne)
  })
})

describe('patches set aside, as the rows say', () => {
  const rowOf = async (s: Awaited<ReturnType<typeof chosenPatch>>) => {
    const opened = await openProject(s.file)
    if (!opened.ok) throw new Error('project did not open')
    const images = await readImages(s.root, opened.project, [])
    return images!.acts[0]!.rows[0]!
  }
  it('notes the takes a patch is chosen on, so a patch left behind needs making again', async () => {
    const s = await chosenPatch()
    expect((await rowOf(s)).patches[0]).toMatchObject({ chosenOn: [2], chosenOnGone: false })
    expect(await s.takes.choose(s.file, 'inn', 1)).toEqual({ ok: true })
    const row = await rowOf(s)
    expect(row.chosenTake).toBe(1)
    expect(makeAgainOf(row).map((p) => p.id)).toEqual(['door'])
    expect(await s.takes.choose(s.file, 'inn', 2)).toEqual({ ok: true })
    expect(makeAgainOf(await rowOf(s))).toEqual([])
  })
  it('gives the area of the chosen patch take, only on the take in the game and while its picture is there', async () => {
    const s = await chosenPatch()
    expect((await rowOf(s)).patches[0]!.chosenArea).toEqual(area)
    expect(await s.takes.choose(s.file, 'inn', 1)).toEqual({ ok: true })
    expect((await rowOf(s)).patches[0]!.chosenArea).toBeNull()
    expect(await s.takes.choose(s.file, 'inn', 2)).toEqual({ ok: true })
    rmSync(join(s.root, 'content-studio/cache/image-takes/inn/2.png'))
    expect((await rowOf(s)).patches[0]!.chosenArea).toBeNull()
  })
  it('keeps the patch marked after the take it was chosen on is dropped, without touching the game', async () => {
    const s = await chosenPatch()
    expect(await s.takes.choose(s.file, 'inn', 1)).toEqual({ ok: true })
    const before = s.read(MANIFEST)
    expect(await s.takes.drop(s.file, 'inn', 2)).toEqual({ ok: true })
    expect(s.read(MANIFEST)).toEqual(before)
    expect((await rowOf(s)).patches[0]).toMatchObject({ chosenOn: [], chosenOnGone: true })
  })
})

describe('patches the image no longer matches', () => {
  it('keeps a patch the game stopped asking for in the list when the image is published again', async () => {
    const s = await chosenPatch()
    writeFileSync(join(s.root, 'tts/act1/images.json'), JSON.stringify([{ ...inn, patches: [] }]))
    expect(await s.takes.choose(s.file, 'inn', 1)).toEqual({ ok: true })
    expect(await s.takes.choose(s.file, 'inn', 2)).toEqual({ ok: true })
    expect(s.manifest().inn.patches.door.file).toBe('inn.door.png')
  })

  it('does not count or bring patch takes made on an image take that was dropped', async () => {
    const s = await chosenPatch()
    expect(await s.takes.choose(s.file, 'inn', 1)).toEqual({ ok: true })
    expect(await s.patches.make(s.file, 'inn', 'door', { count: 1, area })).toEqual({ ok: true })
    await s.wait()
    expect(await s.takes.choose(s.file, 'inn', 2)).toEqual({ ok: true })
    // patch take 2 was painted on image take 1; drop image take 1
    expect(await s.takes.drop(s.file, 'inn', 1)).toEqual({ ok: true })
    writeFileSync(
      join(s.root, EDITS),
      JSON.stringify({
        style: { look: 'pixel art', keepOut: 'text', palette: ['#00ff00', '#0000ff'], parts: {} },
        images: {},
      }),
    )
    const run = await (async () => {
      expect(await s.takes.bringAll(s.file)).toEqual({ ok: true })
      for (let i = 0; i < 400; i++) {
        const state = s.takes.lookRun(s.file)
        if (!state || !state.running) return state
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error('never ended')
    })()
    expect(run).toBeNull()
  })
})

describe('a chosen patch across a new look', () => {
  const newLook = ['#00ff00', '#0000ff', '#ffff00']
  const restyle = (root: string, palette: string[]) =>
    writeFileSync(
      join(root, EDITS),
      JSON.stringify({
        style: { look: 'pixel art', keepOut: 'text', palette, parts: {} },
        images: {},
      }),
    )
  const run = async (s: Awaited<ReturnType<typeof chosenPatch>>) => {
    expect(await s.takes.bringAll(s.file)).toEqual({ ok: true })
    for (let i = 0; i < 400; i++) {
      const state = s.takes.lookRun(s.file)
      if (!state || !state.running) return state
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('the run never ended')
  }
  const rowOf = async (s: Awaited<ReturnType<typeof chosenPatch>>) => {
    const opened = await openProject(s.file)
    if (!opened.ok) throw new Error('project')
    const summary = await readImages(s.root, opened.project, [])
    return { row: summary!.acts[0]!.rows[0]!, summary: summary! }
  }

  it('counts the image once, brings the patch’s takes and the picture the game has, and notes nothing is made again', async () => {
    const s = await chosenPatch()
    restyle(s.root, newLook)
    const before = await rowOf(s)
    expect(before.row.looksOld).toBe(true)
    expect(before.summary.lookNotice?.count).toBe(1)
    const view = (await s.patches.view(s.file, 'inn')) as ImagePatchesView
    expect(view.patches[0]).toMatchObject({ oldLook: true, takes: [{ look: 'old' }] })
    expect(await run(s)).toBeNull()
    const after = (await s.patches.view(s.file, 'inn')) as ImagePatchesView
    expect(after.patches[0]).toMatchObject({ oldLook: false, takes: [{ look: 'ready' }] })
    const clip = decodePng(new Uint8Array(s.read('web/images/inn.door.png')))
    let solid = 0
    for (let i = 0; i < clip.data.length; i += 4) {
      if (clip.data[i + 3] === 0) continue
      solid++
      expect(['0,255,0', '0,0,255', '255,255,0']).toContain(
        `${clip.data[i]},${clip.data[i + 1]},${clip.data[i + 2]}`,
      )
    }
    expect(solid).toBeGreaterThan(0)
    expect((await rowOf(s)).row.looksOld).toBe(false)
  })

  it('counts the image once and gives the image’s reason when it and its patch both fail', async () => {
    const s = await chosenPatch()
    rmSync(join(s.root, 'content-studio/cache/image-takes/inn/2.png'))
    rmSync(join(s.root, FOLDER, '1.png'))
    restyle(s.root, newLook)
    const done = await run(s)
    expect(done?.failed).toEqual([{ id: 'inn', reason: 'missing' }])
  })

  it('names the patch that could not be brought, and leaves it in the game in its old look', async () => {
    const s = await chosenPatch()
    const old = s.read('web/images/inn.door.png')
    rmSync(join(s.root, FOLDER, '1.png'))
    restyle(s.root, newLook)
    expect((await rowOf(s)).row.looksOld).toBe(true)
    const done = await run(s)
    expect(done?.failed).toEqual([
      { id: 'inn', reason: `the model's picture of its patch "The door" is missing` },
    ])
    expect(s.read('web/images/inn.door.png')).toEqual(old)
    const view = (await s.patches.view(s.file, 'inn')) as ImagePatchesView
    expect(view.patches[0]!.oldLook).toBe(true)
  })
})

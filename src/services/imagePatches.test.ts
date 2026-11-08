import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { matchToTake } from '../core/imagePatches'
import { createImagePatches } from './imagePatches'
import type { ImageGenerator, ImageReady, ImageRequest } from './images'
import { fakePng } from './imagesFake'
import { decodePng } from './png'
import { createSerial, type Serial } from './serial'

const images = {
  from: { part: 'tts/{part}/images.json' },
  clips: 'web/images',
  manifest: 'web/images/manifest.json',
}
const inn = { id: 'inn', title: 'Inn', text: 'a low inn', width: 320, height: 200 }
const area = { x: 64, y: 64, width: 128, height: 128 }
const LOCK = 'content-studio/images/lock.json'
const TAKE = 'content-studio/cache/image-takes/inn/3.png'
const BOARD = 'content-studio/cache/image-patches/inn/board.json'
const PATCH = 'content-studio/cache/image-patches/inn/1.png'

const lock = {
  inn: {
    model: 'flux2-klein-4b',
    seed: 7,
    take: 3,
    inputs: { text: 'a low inn', width: 320, height: 200 },
  },
}

/** Writes a take's picture, 256 pixels square, at `path` in the project at `root`. */
function writeTake(root: string, path: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), fakePng(256, 256, 9))
}

/** A studio project whose image `inn` has take 3 chosen and its picture there, unless told otherwise. */
function setup({
  chosen = true,
  picture = true,
  ready = { ok: true },
  installed = true,
  canEdit,
  makes = (request: ImageRequest) => fakePng(request.width, request.height, 1),
  queue = createSerial(),
}: {
  chosen?: boolean
  picture?: boolean
  ready?: ImageReady
  installed?: boolean
  canEdit?: boolean
  makes?: (request: ImageRequest) => Uint8Array
  queue?: Serial
} = {}) {
  const root = tempRepo({
    'content-studio.json': projectJson({ images }),
    'tts/act1/images.json': [inn],
    ...(chosen ? { [LOCK]: lock } : {}),
  })
  if (picture) writeTake(root, TAKE)
  const file = join(root, 'content-studio.json')
  const requests: ImageRequest[] = []
  const generator: ImageGenerator = {
    ready: () => ready,
    installed: () => installed,
    ...(canEdit === undefined ? {} : { canEdit: () => canEdit }),
    async generate(request) {
      requests.push(request)
      return { png: makes(request), seed: request.seed }
    },
  }
  const patches = createImagePatches({
    generator,
    queue,
    free: () => {},
    newSeed: () => 11,
  })
  async function settled() {
    for (let i = 0; i < 200; i++) {
      const view = await patches.view(file, 'inn')
      if (!view || 'ok' in view || !view.making) return view
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('the patch never finished')
  }
  return { root, file, patches, requests, settled }
}

describe('image patches', () => {
  it("edits the chosen take's whole picture with the instruction, at its size, with klein", async () => {
    const { root, file, patches, requests, settled } = setup()
    expect(await patches.make(file, 'inn', { area, instruction: 'the door is gone' })).toEqual({
      ok: true,
    })
    await settled()
    expect(requests).toEqual([
      {
        prompt: 'the door is gone',
        width: 256,
        height: 256,
        seed: 11,
        model: 'klein',
        editing: join(root, TAKE),
      },
    ])
  })

  it('saves only the marked area of the edit, with its instruction, for the chosen take', async () => {
    const { root, file, patches, settled } = setup()
    await patches.make(file, 'inn', { area, instruction: 'the door is gone' })
    expect(await settled()).toEqual({
      take: { n: 3, width: 256, height: 256 },
      pictureGone: false,
      patches: [{ n: 1, take: 3, seed: 11, instruction: 'the door is gone', area }],
      making: null,
      failed: null,
      folder: 'content-studio/cache/image-patches/inn',
    })
    expect(JSON.parse(readFileSync(join(root, BOARD), 'utf8'))).toMatchObject({ next: 2 })
    expect(await patches.patchFile(file, 'inn', '1')).toBe(join(root, PATCH))
    const png = new Uint8Array(readFileSync(join(root, PATCH)))
    expect(png[25]).toBe(6)
    expect([decodePng(png).width, decodePng(png).height]).toEqual([256, 256])
  })

  it('matches the colours of the kept area to the take around it before saving', async () => {
    const { root, file, patches, settled } = setup({
      makes: (request) => fakePng(request.width, request.height, 5),
    })
    await patches.make(file, 'inn', { area, instruction: 'the door is gone' })
    await settled()
    const take = decodePng(new Uint8Array(readFileSync(join(root, TAKE))))
    const edited = decodePng(fakePng(256, 256, 5))
    const saved = decodePng(new Uint8Array(readFileSync(join(root, PATCH))))
    const colourAt = (p: { width: number; data: Uint8Array }, x: number, y: number) => [
      ...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3),
    ]
    const [x, y] = [area.x + 2, area.y + 64] as const
    const gap = (a: number[], b: number[]) => a.reduce((sum, v, c) => sum + Math.abs(v - b[c]!), 0)
    // Next to the side the kept colours are closer to the take than the edit's own are.
    expect(gap(colourAt(saved, x, y), colourAt(take, x, y))).toBeLessThan(
      gap(colourAt(edited, x, y), colourAt(take, x, y)),
    )
    expect(colourAt(saved, x, y)).toEqual(colourAt(matchToTake(edited, take, area), x, y))
  })

  it('fails like any other patch when the take cannot be read back, saving nothing', async () => {
    const { root, file, patches, settled } = setup({
      makes: (request) => {
        writeFileSync(join(root, TAKE), new Uint8Array(40))
        return fakePng(request.width, request.height, 1)
      },
    })
    await patches.make(file, 'inn', { area, instruction: 'the door is gone' })
    expect(await settled()).toMatchObject({
      patches: [],
      failed: { instruction: 'the door is gone' },
    })
    expect(existsSync(join(root, PATCH))).toBe(false)
  })

  it('never says nothing is being made before the finished patch shows', async () => {
    const { file, patches } = setup()
    for (let tries = 1; tries <= 40; tries++) {
      await patches.make(file, 'inn', { area, instruction: `try ${tries}` })
      for (;;) {
        const view = await patches.view(file, 'inn')
        if (!view || 'ok' in view) throw new Error('no view')
        if (view.making) continue
        expect(view.patches.length).toBe(tries)
        break
      }
    }
  })

  it('numbers several tries and keeps them all', async () => {
    const { file, patches, settled } = setup()
    await patches.make(file, 'inn', { area, instruction: 'first' })
    await settled()
    await patches.make(file, 'inn', { area, instruction: 'second' })
    const view = await settled()
    expect(view && 'patches' in view && view.patches.map((p) => [p.n, p.instruction])).toEqual([
      [1, 'first'],
      [2, 'second'],
    ])
  })

  it('adds nothing to the image list, the lock or the manifest', async () => {
    const { root, file, patches, settled } = setup()
    const before = readFileSync(join(root, LOCK), 'utf8')
    await patches.make(file, 'inn', { area, instruction: 'the door is gone' })
    await settled()
    expect(readFileSync(join(root, LOCK), 'utf8')).toBe(before)
    expect(existsSync(join(root, 'web/images/manifest.json'))).toBe(false)
    expect(existsSync(join(root, 'web/images/inn.png'))).toBe(false)
  })

  it('shows only the patches of the take chosen now', async () => {
    const { root, file, patches, settled } = setup()
    await patches.make(file, 'inn', { area, instruction: 'first' })
    await settled()
    writeFileSync(join(root, LOCK), JSON.stringify({ inn: { ...lock.inn, take: 4 } }))
    writeTake(root, 'content-studio/cache/image-takes/inn/4.png')
    expect(await patches.view(file, 'inn')).toMatchObject({ take: { n: 4 }, patches: [] })
  })

  it('refuses a second patch while one is being made', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { file, patches, settled } = setup({ queue })
    expect(await patches.make(file, 'inn', { area, instruction: 'first' })).toEqual({ ok: true })
    expect(await patches.make(file, 'inn', { area, instruction: 'second' })).toEqual({
      ok: false,
      message: 'A patch of this image is being made. Wait for it, then try again.',
    })
    release()
    expect(await settled()).toMatchObject({ patches: [{ instruction: 'first' }] })
  })

  it('says why a patch could not be made and clears it on the next try', async () => {
    let fail = true
    const { file, patches, settled } = setup({
      makes: (r) => {
        if (fail) throw new Error('The image generator ran out of memory')
        return fakePng(r.width, r.height, 1)
      },
    })
    await patches.make(file, 'inn', { area, instruction: 'the door is gone' })
    expect(await settled()).toMatchObject({
      patches: [],
      failed: {
        instruction: 'the door is gone',
        message: 'The image generator ran out of memory.',
      },
    })
    fail = false
    await patches.make(file, 'inn', { area, instruction: 'again' })
    expect(await settled()).toMatchObject({ failed: null, patches: [{ instruction: 'again' }] })
  })

  it('fails an edit that comes back at another size, rather than patching the wrong place', async () => {
    const { file, patches, settled } = setup({ makes: () => fakePng(128, 128, 1) })
    await patches.make(file, 'inn', { area, instruction: 'the door is gone' })
    expect(await settled()).toMatchObject({
      patches: [],
      failed: { message: 'The edited picture came back at 128 × 128 instead of 256 × 256.' },
    })
  })

  it('refuses when no take is chosen', async () => {
    const { file, patches } = setup({ chosen: false })
    expect(await patches.make(file, 'inn', { area, instruction: 'x' })).toEqual({
      ok: false,
      message: 'Choose a take first: a patch is made from the chosen take.',
    })
    expect(await patches.view(file, 'inn')).toMatchObject({
      take: null,
      pictureGone: false,
      patches: [],
    })
  })

  it("refuses, and says so, when the chosen take's picture is gone", async () => {
    const { file, patches } = setup({ picture: false })
    expect(await patches.view(file, 'inn')).toMatchObject({ take: null, pictureGone: true })
    expect(await patches.make(file, 'inn', { area, instruction: 'x' })).toEqual({
      ok: false,
      message: "The chosen take's picture is missing or cannot be read, so it cannot be edited.",
    })
  })

  it("treats a chosen take's picture that cannot be read as gone", async () => {
    const { root, file, patches } = setup()
    writeFileSync(join(root, TAKE), 'not a picture')
    expect(await patches.view(file, 'inn')).toMatchObject({ take: null, pictureGone: true })
  })

  it('reports a patch board that cannot be read, and fails the patch rather than writing over it', async () => {
    const { root, file, patches } = setup()
    mkdirSync(dirname(join(root, BOARD)), { recursive: true })
    writeFileSync(join(root, BOARD), '{"next":"x"}')
    expect(await patches.view(file, 'inn')).toMatchObject({ ok: false, file: BOARD })
    await patches.make(file, 'inn', { area, instruction: 'x' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(readFileSync(join(root, BOARD), 'utf8')).toBe('{"next":"x"}')
    writeFileSync(join(root, BOARD), JSON.stringify({ next: 1, patches: [] }))
    expect(await patches.view(file, 'inn')).toMatchObject({
      failed: { message: `${BOARD} cannot be used.` },
    })
  })

  it('takes only one of two requests that arrive together', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { file, patches, settled, requests } = setup({ queue })
    const answers = await Promise.all([
      patches.make(file, 'inn', { area, instruction: 'first' }),
      patches.make(file, 'inn', { area, instruction: 'second' }),
    ])
    expect(answers.filter((a) => a?.ok)).toHaveLength(1)
    release()
    await settled()
    expect(requests).toHaveLength(1)
  })

  it('keeps the last failure when a request is refused', async () => {
    const { file, patches, settled } = setup({
      makes: () => {
        throw new Error('Out of memory')
      },
    })
    await patches.make(file, 'inn', { area, instruction: 'x' })
    await settled()
    await patches.make(file, 'inn', { area: { ...area, x: 200 }, instruction: 'x' })
    expect(await patches.view(file, 'inn')).toMatchObject({ failed: { message: 'Out of memory.' } })
  })

  it('does not show a patch being made, or failed, from another take under the one chosen now', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { root, file, patches } = setup({ queue })
    await patches.make(file, 'inn', { area, instruction: 'first' })
    writeFileSync(join(root, LOCK), JSON.stringify({ inn: { ...lock.inn, take: 4 } }))
    writeTake(root, 'content-studio/cache/image-takes/inn/4.png')
    expect(await patches.view(file, 'inn')).toMatchObject({ take: { n: 4 }, making: null })
    release()
  })

  it('refuses an area outside the picture', async () => {
    const { file, patches } = setup()
    expect(
      await patches.make(file, 'inn', {
        area: { ...area, x: 200 },
        instruction: 'x',
      }),
    ).toEqual({ ok: false, message: 'The marked area must be inside the picture.' })
  })

  it('refuses when the computer cannot edit', async () => {
    const message = 'mflux is not on the PATH.'
    const none = setup({ ready: { ok: false, reason: 'mflux', message, fix: 'install it' } })
    expect(await none.patches.make(none.file, 'inn', { area, instruction: 'x' })).toEqual({
      ok: false,
      message,
    })
    const old = setup({ canEdit: false })
    expect(await old.patches.make(old.file, 'inn', { area, instruction: 'x' })).toEqual({
      ok: false,
      message:
        'This mflux cannot edit pictures. Update it with uv tool install --upgrade mflux, then start the studio again.',
    })
    const absent = setup({ installed: false })
    expect(await absent.patches.make(absent.file, 'inn', { area, instruction: 'x' })).toEqual({
      ok: false,
      message: 'FLUX.2 klein 4B is not on this computer, and patches are made with it.',
    })
  })

  it('answers null for an image the project does not list, and for a name that is not a patch', async () => {
    const { file, patches } = setup()
    expect(await patches.view(file, 'nope')).toBeNull()
    expect(await patches.make(file, 'nope', { area, instruction: 'x' })).toBeNull()
    expect(await patches.patchFile(file, 'inn', '../board')).toBeNull()
    expect(await patches.patchFile(file, 'inn', '9')).toBeNull()
  })
})

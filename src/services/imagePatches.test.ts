import { describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, utimesSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { EditModelId } from '../core/imageModels'
import {
  keptBox,
  matchToTake,
  type ImagePatchesView,
  type PatchWorkView,
} from '../core/imagePatches'
import { createImagePatches } from './imagePatches'
import { changePatchBoard } from './imagePatchGame'
import type { ImageGenerator, ImageReady, ImageRequest } from './images'
import { fakePng } from './imagesFake'
import { cropPixels, editWindow } from '../core/imagePixels'
import { decodePng, encodePng, encodeTransparentPng } from './png'
import { createSerial, type Serial } from './serial'

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
  patches: [
    { id: 'door', title: 'The door', text: 'the door is gone' },
    { id: 'sign', title: 'The sign', text: 'the sign is new' },
  ],
}
const area = { x: 64, y: 64, width: 128, height: 128 }
const LOCK = 'content-studio/images/lock.json'
const TAKE = 'content-studio/cache/image-takes/inn/3.png'
const FOLDER = 'content-studio/cache/image-patches/inn/door'
const BOARD = `${FOLDER}/board.json`
const MANIFEST = 'web/images/manifest.json'
const gameManifest = { inn: { file: 'inn.png', width: 320, height: 200 } }

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
  here = {},
  canEdit,
  makes = (request: ImageRequest) => fakePng(request.width, request.height, 1),
  queue = createSerial(),
  seeds = [11, 12, 13, 14, 15, 16, 17, 18],
  manifest,
  now,
}: {
  chosen?: boolean
  picture?: boolean
  ready?: ImageReady
  installed?: boolean
  /** Which edit models are whole, for the ones that differ from `installed`. */
  here?: Partial<Record<EditModelId, boolean>>
  canEdit?: boolean
  makes?: (request: ImageRequest) => Uint8Array
  queue?: Serial
  seeds?: number[]
  /** The manifest as the game has it, in place of the one with the image alone. */
  manifest?: unknown
  now?: () => number
} = {}) {
  const root = tempRepo({
    'content-studio.json': projectJson({ images }),
    'tts/act1/images.json': [inn],
    ...(chosen ? { [LOCK]: lock, [MANIFEST]: gameManifest } : {}),
    ...(manifest === undefined ? {} : { [MANIFEST]: manifest }),
  })
  if (picture) writeTake(root, TAKE)
  const file = join(root, 'content-studio.json')
  const requests: ImageRequest[] = []
  const generator: ImageGenerator = {
    ready: () => ready,
    installed: (model) => here[model as EditModelId] ?? installed,
    ...(canEdit === undefined ? {} : { canEdit: () => canEdit }),
    async generate(request) {
      requests.push(request)
      return { png: makes(request), seed: request.seed }
    },
  }
  let seed = 0
  const patches = createImagePatches({
    generator,
    queue,
    free: () => {},
    newSeed: () => seeds[seed++ % seeds.length]!,
    ...(now ? { now } : {}),
  })
  /** The view, once nothing of the patch is waiting or being made. */
  async function settled(patch = 'door'): Promise<ImagePatchesView> {
    for (let i = 0; i < 400; i++) {
      const view = await patches.view(file, 'inn')
      if (!view || !('patches' in view)) throw new Error('no view')
      const mine = view.patches.find((p) => p.id === patch)
      if (!mine?.making.length && !mine?.takes.some((t) => t.look === 'bringing')) return view
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('the takes never finished')
  }
  const work = async (patch = 'door'): Promise<PatchWorkView> =>
    (await settled(patch)).patches.find((p) => p.id === patch)!
  return { root, file, patches, requests, settled, work }
}

describe('takes of a declared patch', () => {
  it("edits the chosen take with the patch's words, at its size when the area fills it, with klein", async () => {
    const { root, file, patches, requests, work } = setup()
    expect(await patches.make(file, 'inn', 'door', { count: 1, area })).toEqual({ ok: true })
    await work()
    expect(requests).toEqual([
      {
        prompt: 'the door is gone',
        width: 256,
        height: 256,
        seed: 11,
        model: 'klein',
        editing: join(root, FOLDER, 'editing-1.png'),
      },
    ])
  })

  it('gives the model only a window around the marked area of a big take, and keeps the take whole', async () => {
    const { root, file, patches, requests, work } = setup({
      picture: false,
      makes: (request) => {
        // The model paints the marked area, 96 pixels into its window, white.
        const sent = decodePng(new Uint8Array(readFileSync(request.editing!)))
        for (let y = 96; y < 196; y++) {
          for (let x = 96; x < 196; x++)
            sent.data.set([255, 255, 255, 255], (y * sent.width + x) * 4)
        }
        return encodePng(sent)
      },
    })
    mkdirSync(dirname(join(root, TAKE)), { recursive: true })
    writeFileSync(join(root, TAKE), fakePng(1024, 640, 9))
    const small = { x: 600, y: 300, width: 100, height: 100 }
    await patches.make(file, 'inn', 'door', { count: 1, area: small })
    await work()
    expect(requests).toHaveLength(1)
    expect([requests[0]!.width, requests[0]!.height]).toEqual([304, 304])
    expect(requests[0]!.editing).not.toBe(join(root, TAKE))
    expect(existsSync(requests[0]!.editing!)).toBe(false)
    const png = decodePng(new Uint8Array(readFileSync(join(root, FOLDER, '1.png'))))
    expect([png.width, png.height]).toEqual([1024, 640])
    const at = (x: number, y: number) => png.data[(y * 1024 + x) * 4 + 3]
    expect(at(650, 350)).toBe(255)
    expect(at(100, 100)).toBe(0)
  })

  it("hands the model the take's own pixels at the window, and keeps nothing of a colour drift of the whole window", async () => {
    const { root, file, patches, requests, work } = setup({
      picture: false,
      makes: (request) => {
        const sent = decodePng(new Uint8Array(readFileSync(request.editing!)))
        // The model shifts every colour of its window by 40, as a model can: more than the bar
        // for a change outside the mark.
        return encodePng({
          ...sent,
          data: sent.data.map((v, i) => (i % 4 === 3 ? v : Math.min(255, v + 40))),
        })
      },
    })
    mkdirSync(dirname(join(root, TAKE)), { recursive: true })
    writeFileSync(join(root, TAKE), fakePng(1024, 640, 9))
    const take = decodePng(new Uint8Array(readFileSync(join(root, TAKE))))
    const small = { x: 600, y: 300, width: 100, height: 100 }
    let sentPixels: Uint8Array | undefined
    const original = requests.push.bind(requests)
    requests.push = (...r) => {
      sentPixels = new Uint8Array(readFileSync(r[0]!.editing!))
      return original(...r)
    }
    await patches.make(file, 'inn', 'door', { count: 1, area: small })
    await work()
    const window = editWindow(small, take)
    expect(decodePng(sentPixels!).data).toEqual(cropPixels(take, window).data)
    // Matched to the take, the drift is no change at all: the take shows everywhere.
    const png = decodePng(new Uint8Array(readFileSync(join(root, FOLDER, '1.png'))))
    for (let i = 3; i < png.data.length; i += 4) expect(png.data[i]).toBe(0)
  })

  it('shows no step of colour where a kept object crosses the edge of the mark', async () => {
    const { root, file, patches, work } = setup({
      makes: (request) => {
        const sent = decodePng(new Uint8Array(readFileSync(request.editing!)))
        // The model drifts everything by 25, then paints an object from inside the mark to well outside it.
        const data = sent.data.map((v, i) => (i % 4 === 3 ? v : Math.min(255, v + 25)))
        for (let y = 106; y < 136; y++) {
          for (let x = 116; x < 186; x++) data.set([200, 100, 50, 255], (y * sent.width + x) * 4)
        }
        return encodePng({ ...sent, data })
      },
    })
    await patches.make(file, 'inn', 'door', {
      count: 1,
      area: { x: 100, y: 100, width: 40, height: 40 },
    })
    await work()
    const png = decodePng(new Uint8Array(readFileSync(join(root, FOLDER, '1.png'))))
    const rgb = (x: number, y: number) => [
      ...png.data.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 3),
    ]
    // The mark's right side is at x = 140: one pixel either side of it.
    const [inside, outside] = [rgb(139, 120), rgb(140, 120)]
    for (let c = 0; c < 3; c++) expect(Math.abs(inside[c]! - outside[c]!)).toBeLessThan(6)
  })

  it('keeps an object the edit painted past the mark whole, and the rest of the take as it was', async () => {
    const { root, file, patches, work } = setup({
      makes: (request) => {
        const sent = decodePng(new Uint8Array(readFileSync(request.editing!)))
        // The window starts 4 pixels in: the object runs from inside the mark to well outside it.
        for (let y = 106; y < 136; y++) {
          for (let x = 116; x < 186; x++)
            sent.data.set([250, 250, 250, 255], (y * sent.width + x) * 4)
        }
        return encodePng(sent)
      },
    })
    const small = { x: 100, y: 100, width: 40, height: 40 }
    await patches.make(file, 'inn', 'door', { count: 1, area: small })
    await work()
    const png = decodePng(new Uint8Array(readFileSync(join(root, FOLDER, '1.png'))))
    const alpha = (x: number, y: number) => png.data[(y * 256 + x) * 4 + 3]
    expect(alpha(125, 120)).toBe(255)
    expect(alpha(175, 120)).toBe(255)
    expect(alpha(60, 60)).toBe(0)
  })

  it('tells the box round what a take keeps, past the mark for an object grown beyond it', async () => {
    const { root, file, patches, work } = setup({
      makes: (request) => {
        const sent = decodePng(new Uint8Array(readFileSync(request.editing!)))
        for (let y = 106; y < 136; y++) {
          for (let x = 116; x < 186; x++)
            sent.data.set([250, 250, 250, 255], (y * sent.width + x) * 4)
        }
        return encodePng(sent)
      },
    })
    await patches.make(file, 'inn', 'door', {
      count: 1,
      area: { x: 100, y: 100, width: 40, height: 40 },
    })
    const kept = (await work()).takes[0]!.kept!
    const png = decodePng(new Uint8Array(readFileSync(join(root, FOLDER, '1.png'))))
    expect(kept).toEqual(keptBox(png)!)
    expect(kept.x + kept.width).toBeGreaterThan(180)
    expect(kept.x).toBeLessThan(120)
  })

  it('follows a take’s file when it changes, and falls back to none when it cannot be read', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    expect((await work()).takes[0]!.kept).toBeNull()
    const path = join(root, FOLDER, '1.png')
    const picture = (x: number, width: number) => {
      const data = new Uint8Array(256 * 256 * 4)
      for (let y = 10; y < 30; y++)
        for (let i = x; i < x + width; i++) data.set([9, 9, 9, 255], (y * 256 + i) * 4)
      return encodeTransparentPng({ width: 256, height: 256, data })
    }
    writeFileSync(path, picture(20, 40))
    expect((await work()).takes[0]!.kept).toEqual({ x: 20, y: 10, width: 40, height: 20 })
    writeFileSync(path, picture(100, 70))
    utimesSync(path, new Date(Date.now() + 5000), new Date(Date.now() + 5000))
    expect((await work()).takes[0]!.kept).toEqual({ x: 100, y: 10, width: 70, height: 20 })
    writeFileSync(path, 'not a picture')
    expect((await work()).takes[0]!.kept).toBeNull()
  })

  it('saves the take with its area and the words it was made from', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    expect(await work()).toEqual({
      id: 'door',
      takes: [
        {
          n: 1,
          area,
          earlier: false,
          chosen: false,
          isNew: true,
          look: 'ready',
          model: 'klein',
          kept: null,
        },
      ],
      making: [],
      failed: [],
      oldLook: false,
      failedModels: [],
    })
    expect(JSON.parse(readFileSync(join(root, BOARD), 'utf8'))).toEqual({
      next: 2,
      takes: [
        {
          n: 1,
          base: 3,
          seed: 11,
          words: 'the door is gone',
          area,
          seen: false,
          look: expect.any(String),
          model: 'klein',
        },
      ],
      chosen: {},
      inGame: {},
    })
    const file1 = await patches.takeFile(file, 'inn', 'door', '1')
    expect(file1).toBe(join(root, FOLDER, '1.png'))
    const png = new Uint8Array(readFileSync(file1!))
    expect(png[25]).toBe(6)
    expect([decodePng(png).width, decodePng(png).height]).toEqual([256, 256])
  })

  it('matches the colours of the kept area to the take around it before saving', async () => {
    // Another tone everywhere, and the marked area painted over: the model's own colours.
    const paintedOver = (width: number, height: number) => {
      const pixels = decodePng(fakePng(width, height, 5))
      for (let y = area.y; y < area.y + area.height; y++) {
        for (let x = area.x; x < area.x + area.width; x++) {
          pixels.data.set([240, 230, 220, 255], (y * width + x) * 4)
        }
      }
      return pixels
    }
    const { root, file, patches, work } = setup({
      makes: (request) => encodePng(paintedOver(request.width, request.height)),
    })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    const take = decodePng(new Uint8Array(readFileSync(join(root, TAKE))))
    const edited = paintedOver(256, 256)
    const saved = decodePng(new Uint8Array(readFileSync(join(root, FOLDER, '1.png'))))
    const at = (p: { width: number; data: Uint8Array }, x: number, y: number) => [
      ...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3),
    ]
    const [x, y] = [area.x + 2, area.y + 64] as const
    expect(at(saved, x, y)).toEqual(at(matchToTake(edited, take, area), x, y))
  })

  it('makes several takes at once, numbered and kept, each with its own seed', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 3, area })
    const made = await work()
    expect(made.takes.map((t) => t.n)).toEqual([1, 2, 3])
    expect(
      JSON.parse(readFileSync(join(root, BOARD), 'utf8')).takes.map(
        (t: { seed: number }) => t.seed,
      ),
    ).toEqual([11, 12, 13])
  })

  it('puts every take of one press in line in number order before it answers, so they are made in that order', async () => {
    const serial = createSerial()
    let turns = 0
    const queue: Serial = {
      run: (key, job) => {
        turns++
        return serial.run(key, job)
      },
    }
    const { root, file, patches, requests, work } = setup({ queue })
    await patches.make(file, 'inn', 'door', { count: 3, area })
    // In line already: no take waits on a read of its own first, which could finish out of order.
    expect(turns).toBe(3)
    await work()
    expect(requests.map((r) => r.editing)).toEqual(
      [1, 2, 3].map((n) => join(root, FOLDER, `editing-${n}.png`)),
    )
  })

  it("times a finished patch take under the model's own key, klein's patches apart from its takes", async () => {
    // The clock moves only while the model makes the take, never on a read of the view.
    let clock = 0
    const { root, file, patches, work } = setup({
      now: () => clock,
      makes: (request) => {
        clock += 3000
        return fakePng(request.width, request.height, 1)
      },
    })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    const times = JSON.parse(
      await Bun.file(join(root, 'content-studio/cache/take-times.json')).text(),
    )
    expect(Object.keys(times)).toEqual(['klein-edit'])
    expect(times['klein-edit']).toEqual([3])
  })

  it('shows takes waiting and being made, each with the area it will use', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { file, patches, work } = setup({ queue })
    await patches.make(file, 'inn', 'door', { count: 2, area })
    const view = (await patches.view(file, 'inn')) as ImagePatchesView
    const door = view.patches.find((p) => p.id === 'door')!
    expect(door.making).toEqual([
      { n: 1, state: 'waiting', elapsed: 0, expected: 20, area, model: 'klein' },
      { n: 2, state: 'waiting', elapsed: 0, expected: 20, area, model: 'klein' },
    ])
    release()
    expect((await work()).takes).toHaveLength(2)
  })

  it('puts a second patch of the image in line behind the first, and refuses neither', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { file, patches, requests, settled } = setup({ queue })
    expect(await patches.make(file, 'inn', 'door', { count: 1, area })).toEqual({ ok: true })
    expect(await patches.make(file, 'inn', 'sign', { count: 1, area })).toEqual({ ok: true })
    release()
    await settled('door')
    const view = await settled('sign')
    expect(view.patches.map((p) => p.takes.length)).toEqual([1, 1])
    expect(requests.map((r) => r.prompt)).toEqual(['the door is gone', 'the sign is new'])
  })

  it('refuses more takes of a patch while its own are waiting or being made', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { file, patches, requests, work } = setup({ queue })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    expect(await patches.make(file, 'inn', 'door', { count: 1, area })).toEqual({
      ok: false,
      message: 'Takes of this patch are being made. Wait for them, or stop them.',
    })
    release()
    await work()
    expect(requests).toHaveLength(1)
  })

  it('takes only one of two requests that arrive together', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { file, patches, work, requests } = setup({ queue })
    const answers = await Promise.all([
      patches.make(file, 'inn', 'door', { count: 1, area }),
      patches.make(file, 'inn', 'door', { count: 1, area }),
    ])
    expect(answers.filter((a) => a?.ok)).toHaveLength(1)
    release()
    await work()
    expect(requests).toHaveLength(1)
  })

  it('stops only the takes of this patch', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { file, patches, settled, requests } = setup({ queue })
    await patches.make(file, 'inn', 'door', { count: 2, area })
    await patches.make(file, 'inn', 'sign', { count: 1, area })
    expect(await patches.stop(file, 'inn', 'door')).toEqual({ ok: true, stopped: 2 })
    release()
    const view = await settled('sign')
    expect(view.patches.map((p) => p.takes.length)).toEqual([0, 1])
    expect(requests.map((r) => r.prompt)).toEqual(['the sign is new'])
  })

  it('says why a take could not be made, and makes it again with its own area and words', async () => {
    let fail = true
    const { file, patches, work, requests } = setup({
      makes: (r) => {
        if (fail) throw new Error('The image generator ran out of memory')
        return fakePng(r.width, r.height, 1)
      },
    })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    expect(await work()).toMatchObject({
      takes: [],
      failed: [{ n: 1, message: 'The image generator ran out of memory.', area }],
    })
    fail = false
    expect(await patches.make(file, 'inn', 'door', { retry: 1 })).toEqual({ ok: true })
    expect(await work()).toMatchObject({ failed: [], takes: [{ n: 1, area }] })
    expect(requests.at(-1)!.prompt).toBe('the door is gone')
  })

  it('refuses to make again a take that did not fail', async () => {
    const { file, patches } = setup()
    expect(await patches.make(file, 'inn', 'door', { retry: 4 })).toEqual({
      ok: false,
      message: 'Take 4 did not fail, so it is not made again.',
    })
  })

  it('fails an edit that comes back at another size, rather than patching the wrong place', async () => {
    const { file, patches, work } = setup({ makes: () => fakePng(128, 128, 1) })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    expect(await work()).toMatchObject({
      takes: [],
      failed: [{ message: 'The edited picture came back at 128 × 128 instead of 256 × 256.' }],
    })
  })

  it('does not time a patch take that came back wrong or was stopped', async () => {
    let clock = 0
    const wrong = setup({ makes: () => fakePng(128, 128, 1), now: () => (clock += 3000) })
    await wrong.patches.make(wrong.file, 'inn', 'door', { count: 1, area })
    await wrong.work()
    expect(existsSync(join(wrong.root, 'content-studio/cache/take-times.json'))).toBe(false)
  })

  it('reports a patch board that cannot be read, and fails the take rather than writing over it', async () => {
    const { root, file, patches } = setup()
    mkdirSync(dirname(join(root, BOARD)), { recursive: true })
    writeFileSync(join(root, BOARD), '{"next":"x"}')
    expect(await patches.view(file, 'inn')).toMatchObject({ ok: false, file: BOARD })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(readFileSync(join(root, BOARD), 'utf8')).toBe('{"next":"x"}')
  })

  it('refuses an area outside the picture', async () => {
    const { file, patches } = setup()
    expect(
      await patches.make(file, 'inn', 'door', { count: 1, area: { ...area, x: 200 } }),
    ).toEqual({ ok: false, message: 'The marked area must be inside the picture.' })
  })

  it('refuses when no take is chosen, and shows the patches without takes', async () => {
    const { file, patches } = setup({ chosen: false })
    expect(await patches.make(file, 'inn', 'door', { count: 1, area })).toEqual({
      ok: false,
      message:
        'Choose a take of the image first. Patches are painted onto the take the game shows.',
    })
    expect(await patches.view(file, 'inn')).toMatchObject({
      take: null,
      pictureGone: false,
      patches: [{ id: 'door', takes: [] }, { id: 'sign' }],
    })
  })

  it("refuses, and says so, when the chosen take's picture is gone or cannot be read", async () => {
    const gone = setup({ picture: false })
    expect(await gone.patches.view(gone.file, 'inn')).toMatchObject({
      take: null,
      pictureGone: true,
    })
    expect(await gone.patches.make(gone.file, 'inn', 'door', { count: 1, area })).toEqual({
      ok: false,
      message: "The chosen take's picture is missing or cannot be read, so it cannot be patched.",
    })
    const bad = setup()
    writeFileSync(join(bad.root, TAKE), 'not a picture')
    expect(await bad.patches.view(bad.file, 'inn')).toMatchObject({ take: null, pictureGone: true })
  })

  it('refuses, and queues nothing, when the chosen take reads as a picture but its pixels cannot be', async () => {
    const { root, file, patches, requests, work } = setup()
    // The size reads from the header; the body after it is cut off.
    writeFileSync(join(root, TAKE), fakePng(256, 256, 9).slice(0, 40))
    expect(await patches.make(file, 'inn', 'door', { count: 2, area })).toEqual({
      ok: false,
      message: "The chosen take's picture is missing or cannot be read, so it cannot be patched.",
    })
    expect((await work()).making).toEqual([])
    expect(requests).toEqual([])
  })

  it('says in the view why takes cannot be made on this computer', async () => {
    const message = 'mflux is not on the PATH.'
    const none = setup({ ready: { ok: false, reason: 'mflux', message, fix: 'install it' } })
    expect(await none.patches.view(none.file, 'inn')).toMatchObject({
      maker: { ok: false, message },
    })
    expect(await none.patches.make(none.file, 'inn', 'door', { count: 1, area })).toEqual({
      ok: false,
      message,
    })
    const old = setup({ canEdit: false })
    const cannot =
      'This mflux cannot edit pictures. Update it with uv tool install --upgrade mflux, then start the studio again.'
    expect(await old.patches.view(old.file, 'inn')).toMatchObject({
      maker: { ok: false, message: cannot },
    })
    expect(await old.patches.make(old.file, 'inn', 'door', { count: 1, area })).toEqual({
      ok: false,
      message: cannot,
    })
    const absent = setup({ installed: false })
    const missing = 'FLUX.2 klein 4B is not on this computer, and patches are made with it.'
    // The weights are the model's business, not the machine's: the view says so per model.
    expect(await absent.patches.view(absent.file, 'inn')).toMatchObject({
      maker: { ok: true },
      models: { klein: 'absent', 'qwen-edit': 'absent' },
    })
    expect(await absent.patches.make(absent.file, 'inn', 'door', { count: 1, area })).toEqual({
      ok: false,
      message: missing,
    })
    const fine = setup()
    expect(await fine.patches.view(fine.file, 'inn')).toMatchObject({ maker: { ok: true } })
  })

  it('answers null for an image or a patch the game does not list, and for a bad file name', async () => {
    const { file, patches } = setup()
    expect(await patches.view(file, 'nope')).toBeNull()
    expect(await patches.make(file, 'nope', 'door', { count: 1, area })).toBeNull()
    expect(await patches.make(file, 'inn', 'nope', { count: 1, area })).toBeNull()
    expect(await patches.takeFile(file, 'inn', 'door', '../board')).toBeNull()
    expect(await patches.takeFile(file, 'inn', 'door', '9')).toBeNull()
    expect(await patches.takeFile(file, 'inn', 'nope', '1')).toBeNull()
  })

  it('adds nothing to the image list, the lock or the manifest', async () => {
    const { root, file, patches, work } = setup()
    const before = readFileSync(join(root, LOCK), 'utf8')
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    expect(readFileSync(join(root, LOCK), 'utf8')).toBe(before)
    expect(JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'))).toEqual(gameManifest)
    expect(existsSync(join(root, 'web/images/inn.png'))).toBe(false)
  })

  it("does not read the free-form trial's board, and does not delete it", async () => {
    const { root, file, patches } = setup()
    const old = 'content-studio/cache/image-patches/inn/board.json'
    mkdirSync(dirname(join(root, old)), { recursive: true })
    writeFileSync(join(root, old), JSON.stringify({ next: 2, patches: [{ n: 1 }] }))
    expect(await patches.view(file, 'inn')).toMatchObject({
      patches: [{ takes: [] }, { takes: [] }],
    })
    expect(existsSync(join(root, old))).toBe(true)
  })
})

describe('the model of a take of a patch', () => {
  it('makes new takes with the model asked for, and keeps it with each take', async () => {
    const { root, file, patches, requests, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area, model: 'qwen-edit' })
    const view = await work()
    expect(requests[0]!.model).toBe('qwen-edit')
    expect(view.takes[0]!.model).toBe('qwen-edit')
    expect(JSON.parse(readFileSync(join(root, BOARD), 'utf8')).takes[0].model).toBe('qwen-edit')
  })

  it('reads a take made before the choice as klein, and makes klein takes when no model is named', async () => {
    const { file, patches, requests, work, root } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    expect(requests[0]!.model).toBe('klein')
    const board = JSON.parse(readFileSync(join(root, BOARD), 'utf8'))
    delete board.takes[0].model
    writeFileSync(join(root, BOARD), JSON.stringify(board))
    expect((await work()).takes[0]!.model).toBe('klein')
  })

  it('shows each take being made with its model and the time of that model', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { file, patches, work } = setup({ queue })
    await patches.make(file, 'inn', 'door', { count: 1, area, model: 'qwen-edit' })
    const view = (await patches.view(file, 'inn')) as ImagePatchesView
    expect(view.patches[0]!.making).toEqual([
      { n: 1, state: 'waiting', elapsed: 0, expected: 480, area, model: 'qwen-edit' },
    ])
    release()
    await work()
  })

  it('refuses a model that is not on this computer, naming it', async () => {
    const { file, patches } = setup({ here: { 'qwen-edit': false } })
    expect(await patches.make(file, 'inn', 'door', { count: 1, area, model: 'qwen-edit' })).toEqual(
      {
        ok: false,
        message: 'Qwen Image Edit is not on this computer, and patches are made with it.',
      },
    )
    expect(await patches.make(file, 'inn', 'door', { count: 1, area })).toEqual({ ok: true })
  })

  it('says how much of each model is on this computer', async () => {
    const { file, patches } = setup({ here: { 'qwen-edit': false } })
    expect(await patches.view(file, 'inn')).toMatchObject({
      models: { 'qwen-edit': 'absent', klein: 'whole' },
    })
  })

  it('makes a failed take again with the model that failed, whatever the body says', async () => {
    let fail = true
    const { file, patches, work, requests } = setup({
      makes: (r) => {
        if (fail) throw new Error('out of memory')
        return fakePng(r.width, r.height, 1)
      },
    })
    await patches.make(file, 'inn', 'door', { count: 1, area, model: 'qwen-edit' })
    expect(await work()).toMatchObject({
      failed: [{ n: 1, model: 'qwen-edit' }],
      failedModels: ['qwen-edit'],
    })
    fail = false
    await patches.make(file, 'inn', 'door', { retry: 1 })
    const view = await work()
    expect(requests.at(-1)!.model).toBe('qwen-edit')
    expect(view.takes[0]!.model).toBe('qwen-edit')
    expect(view.failedModels).toEqual([])
  })

  it('remembers a model that failed until a take of its own works, and not for the other', async () => {
    let fail = true
    const { file, patches, work } = setup({
      makes: (r) => {
        if (fail && r.model === 'qwen-edit') throw new Error('out of memory')
        return fakePng(r.width, r.height, 1)
      },
    })
    await patches.make(file, 'inn', 'door', { count: 1, area, model: 'qwen-edit' })
    expect((await work()).failedModels).toEqual(['qwen-edit'])
    const failedView = (await patches.view(file, 'inn')) as ImagePatchesView
    expect(failedView.remake.failedModels).toEqual(['qwen-edit'])
    await patches.make(file, 'inn', 'door', { count: 1, area, model: 'klein' })
    expect((await work()).failedModels).toEqual(['qwen-edit'])
    fail = false
    await patches.make(file, 'inn', 'door', { count: 1, area, model: 'qwen-edit' })
    expect((await work()).failedModels).toEqual([])
  })
})

describe('takes of a patch across takes of the image', () => {
  it('is not refused for takes still being made on another take of the image', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { root, file, patches } = setup({ queue })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    writeFileSync(join(root, LOCK), JSON.stringify({ inn: { ...lock.inn, take: 4 } }))
    writeTake(root, 'content-studio/cache/image-takes/inn/4.png')
    expect(await patches.make(file, 'inn', 'door', { count: 1, area })).toEqual({ ok: true })
    release()
  })

  it('does not make a failed take again on another take of the image', async () => {
    const { root, file, patches, work } = setup({
      makes: () => {
        throw new Error('Out of memory')
      },
    })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    writeFileSync(join(root, LOCK), JSON.stringify({ inn: { ...lock.inn, take: 4 } }))
    writeTake(root, 'content-studio/cache/image-takes/inn/4.png')
    expect(await patches.make(file, 'inn', 'door', { retry: 1 })).toEqual({
      ok: false,
      message: 'Take 1 was made on another take of the image, so it is not made again here.',
    })
  })

  it('makes a failed take again once when asked twice at once', async () => {
    let fail = true
    const { file, patches, work, requests } = setup({
      makes: (r) => {
        if (fail) throw new Error('Out of memory')
        return fakePng(r.width, r.height, 1)
      },
    })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    fail = false
    const answers = await Promise.all([
      patches.make(file, 'inn', 'door', { retry: 1 }),
      patches.make(file, 'inn', 'door', { retry: 1 }),
    ])
    expect(answers.filter((a) => a?.ok)).toHaveLength(1)
    await work()
    expect(requests).toHaveLength(2)
  })
})

describe('choosing, un-choosing and dropping a take of a patch', () => {
  it('chooses a take, in place of another chosen one, and marks it seen', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 2, area })
    await work()
    expect(await patches.choose(file, 'inn', 'door', 1)).toEqual({ ok: true })
    expect((await work()).takes.map((t) => [t.n, t.chosen, t.isNew])).toEqual([
      [1, true, false],
      [2, false, true],
    ])
    expect(await patches.choose(file, 'inn', 'door', 2)).toEqual({ ok: true })
    expect((await work()).takes.map((t) => t.chosen)).toEqual([false, true])
    expect(JSON.parse(readFileSync(join(root, BOARD), 'utf8')).chosen).toEqual({ '3': 2 })
  })

  it('refuses a take that is not on the board', async () => {
    const { file, patches } = setup()
    expect(await patches.choose(file, 'inn', 'door', 9)).toEqual({
      ok: false,
      message: 'That take is not on the board.',
    })
  })

  it('un-chooses, and the take stays among the takes', async () => {
    const { file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    await patches.choose(file, 'inn', 'door', 1)
    expect(await patches.unchoose(file, 'inn', 'door')).toEqual({ ok: true })
    expect((await work()).takes).toMatchObject([{ n: 1, chosen: false }])
  })

  it('drops a take that is not chosen and deletes its picture, but not the chosen one', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 2, area })
    await work()
    await patches.choose(file, 'inn', 'door', 1)
    expect(await patches.drop(file, 'inn', 'door', 1)).toEqual({
      ok: false,
      message: 'That take is chosen; un-choose it first.',
    })
    expect(await patches.drop(file, 'inn', 'door', 2)).toEqual({ ok: true })
    expect((await work()).takes.map((t) => t.n)).toEqual([1])
    expect(existsSync(join(root, FOLDER, '2.png'))).toBe(false)
    expect(existsSync(join(root, FOLDER, '1.png'))).toBe(true)
  })

  it('marks a take seen once it has been looked at', async () => {
    const { file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    expect(await patches.markSeen(file, 'inn', 'door', 1)).toEqual({ ok: true })
    expect((await work()).takes[0]!.isNew).toBe(false)
  })

  it("marks a take earlier when the patch's words changed after it was made", async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    writeFileSync(
      join(root, 'content-studio/images/edits.json'),
      JSON.stringify({
        images: {
          inn: { patches: { door: { text: 'a window instead', gameWas: 'the door is gone' } } },
        },
      }),
    )
    expect((await work()).takes[0]!.earlier).toBe(true)
  })

  it('shows only the takes made on the take chosen now, and brings the rest back with the original', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 2, area })
    await work()
    await patches.choose(file, 'inn', 'door', 2)
    writeFileSync(join(root, LOCK), JSON.stringify({ inn: { ...lock.inn, take: 4 } }))
    writeTake(root, 'content-studio/cache/image-takes/inn/4.png')
    expect(await patches.view(file, 'inn')).toMatchObject({
      take: { n: 4 },
      patches: [{ id: 'door', takes: [] }, { id: 'sign' }],
    })
    writeFileSync(join(root, LOCK), JSON.stringify(lock))
    expect((await work()).takes.map((t) => [t.n, t.chosen])).toEqual([
      [1, false],
      [2, true],
    ])
  })

  it('does not show a take being made on another take of the image', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { root, file, patches } = setup({ queue })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    writeFileSync(join(root, LOCK), JSON.stringify({ inn: { ...lock.inn, take: 4 } }))
    writeTake(root, 'content-studio/cache/image-takes/inn/4.png')
    const view = (await patches.view(file, 'inn')) as ImagePatchesView
    expect(view.patches[0]).toMatchObject({ making: [], failed: [] })
    release()
  })
})

const GAME_DIR = 'web/images'
const manifestOf = (root: string) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'))
const GAME_PATCH = `${GAME_DIR}/inn.door.png`

describe('the game version of a patch', () => {
  it('is made with the take: a transparent picture at the size of the game, beside the take', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    const png = new Uint8Array(readFileSync(join(root, FOLDER, '1.game.png')))
    expect(png[25]).toBe(6)
    expect([decodePng(png).width, decodePng(png).height]).toEqual([320, 200])
    expect(await patches.gameFile(file, 'inn', 'door', '1')).toBe(join(root, FOLDER, '1.game.png'))
    expect(await patches.gameFile(file, 'inn', 'door', '9')).toBeNull()
    expect(await patches.gameFile(file, 'inn', 'door', '../board')).toBeNull()
  })

  it('stays as the model made it when the style cannot be read, and says why', async () => {
    const { root, file, patches, work } = setup()
    mkdirSync(join(root, 'content-studio/images'), { recursive: true })
    writeFileSync(join(root, 'content-studio/images/edits.json'), '{ nope')
    await patches.make(file, 'inn', 'door', { count: 1, area })
    const view = await work()
    expect(view.takes[0]!.look).toBe('missing')
    expect(existsSync(join(root, FOLDER, '1.game.png'))).toBe(false)
    expect(((await patches.view(file, 'inn')) as ImagePatchesView).lookError).toContain(
      "Can't bring this take to the game's look",
    )
  })

  it('is removed with the take it belongs to', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 2, area })
    await work()
    await patches.drop(file, 'inn', 'door', 2)
    expect(existsSync(join(root, FOLDER, '2.game.png'))).toBe(false)
    expect(existsSync(join(root, FOLDER, '1.game.png'))).toBe(true)
  })
})

describe('a chosen take of a patch reaches the game', () => {
  it('puts a transparent picture beside the image and lists it under the image by patch id', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    expect(await patches.choose(file, 'inn', 'door', 1)).toEqual({ ok: true })
    expect(manifestOf(root)).toEqual({
      inn: {
        ...gameManifest.inn,
        patches: { door: { file: 'inn.door.png', width: 320, height: 200 } },
      },
    })
    expect(readFileSync(join(root, GAME_PATCH))).toEqual(
      readFileSync(join(root, FOLDER, '1.game.png')),
    )
    expect(JSON.parse(readFileSync(join(root, BOARD), 'utf8'))).toMatchObject({
      chosen: { '3': 1 },
      inGame: { '3': 1 },
    })
  })

  it('replaces the picture at once when another take is chosen', async () => {
    const { root, file, patches, work } = setup({
      makes: (request) => fakePng(request.width, request.height, request.seed),
    })
    await patches.make(file, 'inn', 'door', { count: 2, area })
    await work()
    await patches.choose(file, 'inn', 'door', 1)
    await patches.choose(file, 'inn', 'door', 2)
    expect(readFileSync(join(root, GAME_PATCH))).toEqual(
      readFileSync(join(root, FOLDER, '2.game.png')),
    )
    expect(Object.keys(manifestOf(root).inn.patches)).toEqual(['door'])
  })

  it('lists several patches of an image side by side, in patch id order', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'sign', { count: 1, area })
    await work('sign')
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    await patches.choose(file, 'inn', 'sign', 1)
    await patches.choose(file, 'inn', 'door', 1)
    expect(Object.keys(manifestOf(root).inn.patches)).toEqual(['door', 'sign'])
  })

  it('keeps the other fields of the image’s entry, and every other image', async () => {
    const { root, file, patches, work } = setup({
      manifest: {
        inn: { ...gameManifest.inn, extra: 1 },
        yard: { file: 'yard.png', width: 1, height: 1 },
      },
    })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    await patches.choose(file, 'inn', 'door', 1)
    const manifest = manifestOf(root)
    expect(manifest.inn.extra).toBe(1)
    expect(manifest.yard).toEqual({ file: 'yard.png', width: 1, height: 1 })
  })

  it('changes nothing and says so when the manifest cannot be read', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    writeFileSync(join(root, MANIFEST), '{ nope')
    expect(await patches.choose(file, 'inn', 'door', 1)).toMatchObject({ ok: false })
    expect(readFileSync(join(root, MANIFEST), 'utf8')).toBe('{ nope')
    expect(existsSync(join(root, GAME_PATCH))).toBe(false)
    expect(JSON.parse(readFileSync(join(root, BOARD), 'utf8')).chosen).toEqual({})
  })

  it('refuses a take whose game version cannot be made, and leaves the game as it was', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    mkdirSync(join(root, 'content-studio/images'), { recursive: true })
    writeFileSync(join(root, 'content-studio/images/edits.json'), '{ nope')
    const answer = await patches.choose(file, 'inn', 'door', 1)
    expect(answer).toMatchObject({ ok: false })
    expect(existsSync(join(root, GAME_PATCH))).toBe(false)
  })

  it('refuses when the image is not in the game', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    writeFileSync(join(root, MANIFEST), '{}')
    expect(await patches.choose(file, 'inn', 'door', 1)).toMatchObject({ ok: false })
  })

  it('takes the patch out of the game when it is un-chosen, and the take stays', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    await patches.choose(file, 'inn', 'door', 1)
    expect(await patches.unchoose(file, 'inn', 'door')).toEqual({ ok: true })
    expect(manifestOf(root)).toEqual(gameManifest)
    expect(existsSync(join(root, GAME_PATCH))).toBe(false)
    expect(JSON.parse(readFileSync(join(root, BOARD), 'utf8'))).toMatchObject({
      chosen: {},
      inGame: {},
    })
    expect((await work()).takes).toHaveLength(1)
  })

  it.skipIf(process.getuid?.() === 0)(
    'leaves the patch, manifest and board as they were when the board cannot be written',
    async () => {
      const { root, file, patches, work } = setup()
      await patches.make(file, 'inn', 'door', { count: 1, area })
      await work()
      await patches.choose(file, 'inn', 'door', 1)
      const manifest = readFileSync(join(root, MANIFEST), 'utf8')
      const board = readFileSync(join(root, BOARD), 'utf8')
      const folder = dirname(join(root, BOARD))
      chmodSync(folder, 0o555)
      try {
        expect(await patches.unchoose(file, 'inn', 'door')).toMatchObject({ ok: false })
      } finally {
        chmodSync(folder, 0o755)
      }
      expect(existsSync(join(root, GAME_PATCH))).toBe(true)
      expect(readFileSync(join(root, MANIFEST), 'utf8')).toBe(manifest)
      expect(readFileSync(join(root, BOARD), 'utf8')).toBe(board)
    },
  )

  it.skipIf(process.getuid?.() === 0)(
    'refuses, changing nothing, when the patch picture cannot be taken out of the clips folder',
    async () => {
      const { root, file, patches, work } = setup()
      await patches.make(file, 'inn', 'door', { count: 1, area })
      await work()
      await patches.choose(file, 'inn', 'door', 1)
      // The game's manifest has no patch entry, so the picture is the first thing taken out.
      writeFileSync(join(root, MANIFEST), JSON.stringify(gameManifest))
      const manifest = readFileSync(join(root, MANIFEST), 'utf8')
      const board = readFileSync(join(root, BOARD), 'utf8')
      const clips = dirname(join(root, GAME_PATCH))
      chmodSync(clips, 0o555)
      try {
        expect(await patches.unchoose(file, 'inn', 'door')).toMatchObject({
          ok: false,
          message: `${GAME_PATCH} could not be written.`,
        })
      } finally {
        chmodSync(clips, 0o755)
      }
      expect(existsSync(join(root, GAME_PATCH))).toBe(true)
      expect(readFileSync(join(root, MANIFEST), 'utf8')).toBe(manifest)
      expect(readFileSync(join(root, BOARD), 'utf8')).toBe(board)
    },
  )

  it('finishes un-choosing when pressed again after the board could not be saved', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    await patches.choose(file, 'inn', 'door', 1)
    // as if the game was cleared but the board was not: manifest entry gone already
    writeFileSync(join(root, MANIFEST), JSON.stringify(gameManifest))
    expect(await patches.unchoose(file, 'inn', 'door')).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(join(root, BOARD), 'utf8')).chosen).toEqual({})
  })

  it('does not put a choice made before the game got patches in the game', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    const board = JSON.parse(readFileSync(join(root, BOARD), 'utf8'))
    writeFileSync(
      join(root, BOARD),
      JSON.stringify({ ...board, chosen: { '3': 1 }, inGame: undefined }),
    )
    expect((await work()).takes[0]!.chosen).toBe(true)
    expect(manifestOf(root)).toEqual(gameManifest)
  })
})

const IMAGE_BOARD = 'content-studio/cache/images/inn.json'
const earlierArea = { x: 32, y: 32, width: 96, height: 96 }

/** Makes `patches` chosen on an earlier take 2 of the image, with the area they were chosen with. */
function chosenEarlier(root: string, patches: string[] = ['door', 'sign'], at = earlierArea) {
  writeTake(root, 'content-studio/cache/image-takes/inn/2.png')
  mkdirSync(dirname(join(root, IMAGE_BOARD)), { recursive: true })
  writeFileSync(
    join(root, IMAGE_BOARD),
    JSON.stringify({
      next: 4,
      takes: [2, 3].map((n) => ({
        n,
        seed: n,
        model: 'flux2-klein-4b',
        width: 256,
        height: 256,
        madeFrom: { words: 'a low inn', style: '', width: 320, height: 200 },
        seen: true,
      })),
    }),
  )
  for (const patch of patches) {
    const folder = `content-studio/cache/image-patches/inn/${patch}`
    mkdirSync(join(root, folder), { recursive: true })
    writeFileSync(
      join(root, `${folder}/board.json`),
      JSON.stringify({
        next: 2,
        takes: [{ n: 1, base: 2, seed: 1, words: 'old', area: at, seen: true }],
        chosen: { '2': 1 },
        inGame: { '2': 1 },
      }),
    )
  }
}

describe('remaking patches with a model', () => {
  it('makes every take of the press with the model, and the press names it', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { root, file, patches, requests, settled } = setup({ queue })
    chosenEarlier(root)
    await patches.remake(file, 'inn', { count: 1, marks: {}, model: 'qwen-edit' })
    const view = (await patches.view(file, 'inn')) as ImagePatchesView
    expect(view.remake.press).toMatchObject({ model: 'qwen-edit', total: 2 })
    // two takes on the model's time, not klein's
    expect(view.remake.press!.left).toBe(960)
    release()
    await settled('door')
    await settled('sign')
    expect(requests.map((r) => r.model)).toEqual(['qwen-edit', 'qwen-edit'])
  })

  it('refuses a model that is not on this computer', async () => {
    const { root, file, patches } = setup({ here: { 'qwen-edit': false } })
    chosenEarlier(root)
    expect(await patches.remake(file, 'inn', { count: 1, marks: {}, model: 'qwen-edit' })).toEqual({
      ok: false,
      message: 'Qwen Image Edit is not on this computer, and patches are made with it.',
    })
  })
})

describe('remaking patches on a new take', () => {
  it('makes the chosen number of takes for each covered patch, in the game order, from the area they were chosen with and their words now', async () => {
    const { root, file, patches, requests, settled } = setup()
    chosenEarlier(root)
    const view = (await patches.view(file, 'inn')) as ImagePatchesView
    expect(view.remake.earlier).toEqual({ door: earlierArea, sign: earlierArea })
    expect(await patches.remake(file, 'inn', { count: 2, marks: {} })).toEqual({
      ok: true,
      patches: ['door', 'sign'],
      takes: 4,
    })
    await settled('door')
    const after = await settled('sign')
    expect(after.patches.map((p) => p.takes.length)).toEqual([2, 2])
    expect(requests.map((r) => r.prompt)).toEqual([
      'the door is gone',
      'the door is gone',
      'the sign is new',
      'the sign is new',
    ])
    const board = JSON.parse(readFileSync(join(root, BOARD), 'utf8'))
    expect(
      board.takes
        .filter((t: { base: number }) => t.base === 3)
        .map((t: { area: unknown }) => t.area),
    ).toEqual([earlierArea, earlierArea])
    expect(board.chosen).toEqual({ '2': 1 })
  })

  it('uses the mark the person drew in place of the area it was chosen with', async () => {
    const { root, file, patches, requests, settled } = setup()
    chosenEarlier(root, ['door'])
    const marked = { x: 8, y: 8, width: 64, height: 64 }
    expect(await patches.remake(file, 'inn', { count: 1, marks: { door: marked } })).toEqual({
      ok: true,
      patches: ['door'],
      takes: 1,
    })
    await settled('door')
    expect(requests).toHaveLength(1)
    const board = JSON.parse(readFileSync(join(root, BOARD), 'utf8'))
    expect(board.takes.find((t: { base: number }) => t.base === 3).area).toEqual(marked)
  })

  it('does not cover a patch that already has takes on the take in the game', async () => {
    const { root, file, patches, settled } = setup()
    chosenEarlier(root)
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await settled('door')
    expect(await patches.remake(file, 'inn', { count: 1, marks: {} })).toMatchObject({
      patches: ['sign'],
    })
  })

  it('refuses when nothing is covered', async () => {
    const { file, patches } = setup()
    expect(await patches.remake(file, 'inn', { count: 1, marks: {} })).toEqual({
      ok: false,
      message: 'No patch needs making again on this take.',
    })
  })

  it('refuses for a model that is missing, with the reason a patch gives', async () => {
    const { root, file, patches } = setup({ installed: false })
    chosenEarlier(root)
    expect(await patches.remake(file, 'inn', { count: 1, marks: {} })).toEqual({
      ok: false,
      message: 'FLUX.2 klein 4B is not on this computer, and patches are made with it.',
    })
  })

  it('shows progress while it runs and a summary after, until Close', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { root, file, patches, settled } = setup({ queue })
    chosenEarlier(root)
    await patches.remake(file, 'inn', { count: 2, marks: {} })
    let view = (await patches.view(file, 'inn')) as ImagePatchesView
    expect(view.remake.press).toMatchObject({
      total: 4,
      ids: ['door', 'sign'],
      made: 0,
      stopped: 0,
      failed: [],
      running: true,
    })
    expect(view.remake.press!.left).toBeGreaterThan(0)
    release()
    await settled('door')
    view = await settled('sign')
    expect(view.remake.press).toMatchObject({ total: 4, made: 4, running: false, failed: [] })
    expect(await patches.closeRemake(file, 'inn')).toEqual({ ok: true })
    view = (await patches.view(file, 'inn')) as ImagePatchesView
    expect(view.remake.press).toBeNull()
  })

  it('keeps the takes already made when the press is stopped', async () => {
    const { root, file, patches, settled } = setup()
    chosenEarlier(root, ['door'])
    await patches.remake(file, 'inn', { count: 1, marks: {} })
    await settled('door')
    expect(await patches.stopRemake(file, 'inn')).toEqual({ ok: true, stopped: 0 })
    const view = (await patches.view(file, 'inn')) as ImagePatchesView
    expect(view.patches[0]!.takes).toHaveLength(1)
    expect(view.remake.press).toMatchObject({ total: 1, made: 1, stopped: 0 })
  })

  it('stops what waits and keeps what was made, and not the takes a patch’s own Make queued', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { root, file, patches, settled } = setup({ queue })
    chosenEarlier(root, ['door'])
    await patches.remake(file, 'inn', { count: 2, marks: {} })
    // The sign is not covered; its own Make is queued behind the press's takes.
    await patches.make(file, 'inn', 'sign', { count: 1, area })
    expect(await patches.stopRemake(file, 'inn')).toEqual({ ok: true, stopped: 2 })
    release()
    const view = await settled('sign')
    expect(view.patches.map((p) => p.takes.length)).toEqual([0, 1])
    expect(view.remake.press).toMatchObject({ total: 2, made: 0, stopped: 2, running: false })
  })

  it('does not show a finished press again to a page that has just loaded, until Close otherwise', async () => {
    const { root, file, patches, settled } = setup()
    chosenEarlier(root, ['door'])
    await patches.remake(file, 'inn', { count: 1, marks: {} })
    await settled('door')
    expect(((await patches.view(file, 'inn')) as ImagePatchesView).remake.press).toMatchObject({
      made: 1,
    })
    expect(((await patches.view(file, 'inn', true)) as ImagePatchesView).remake.press).toBeNull()
  })

  it('keeps a running press for a page that has just loaded', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { root, file, patches, settled } = setup({ queue })
    chosenEarlier(root, ['door'])
    await patches.remake(file, 'inn', { count: 1, marks: {} })
    expect(
      ((await patches.view(file, 'inn', true)) as ImagePatchesView).remake.press,
    ).toMatchObject({ running: true })
    release()
    await settled('door')
  })

  it('makes from the words as they stand now, and counts takes made on their own take of the image', async () => {
    const { root, file, patches, requests, settled } = setup()
    chosenEarlier(root, ['door'])
    writeFileSync(
      join(root, 'content-studio/images/edits.json'),
      JSON.stringify({
        images: { inn: { patches: { door: { text: 'a new door', gameWas: 'the door is gone' } } } },
      }),
    )
    await patches.remake(file, 'inn', { count: 1, marks: {} })
    await settled('door')
    expect(requests.map((r) => r.prompt)).toEqual(['a new door'])
    // Another take of the image is chosen: the press's take still counts as made on its own take.
    writeTake(root, 'content-studio/cache/image-takes/inn/4.png')
    writeFileSync(join(root, LOCK), JSON.stringify({ inn: { ...lock.inn, take: 4 } }))
    expect(((await patches.view(file, 'inn')) as ImagePatchesView).remake.press).toMatchObject({
      made: 1,
    })
  })

  it('falls back to an older earlier take when the newest one is gone from the board', async () => {
    const { root, file, patches } = setup()
    chosenEarlier(root, ['door'])
    const board = join(root, BOARD)
    const was = JSON.parse(readFileSync(board, 'utf8'))
    was.takes.push({ n: 2, base: 1, seed: 1, words: 'x', area: earlierArea, seen: true })
    was.chosen = { '1': 2, '2': 9 }
    writeFileSync(board, JSON.stringify(was))
    const view = (await patches.view(file, 'inn')) as ImagePatchesView
    expect(view.remake.earlier).toEqual({ door: earlierArea })
  })

  it('names a patch whose take failed in the summary', async () => {
    const { root, file, patches, settled } = setup({
      makes: (r) => {
        if (r.prompt === 'the sign is new') throw new Error('boom')
        return fakePng(r.width, r.height, 1)
      },
    })
    chosenEarlier(root)
    await patches.remake(file, 'inn', { count: 1, marks: {} })
    await settled('door')
    const view = await settled('sign')
    expect(view.remake.press).toMatchObject({
      total: 2,
      made: 1,
      failed: ['sign'],
      failedTakes: 1,
      running: false,
    })
  })

  it('starts nothing, and stops the takes already queued, when a later patch cannot be started', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { root, file, patches, requests } = setup({ queue })
    chosenEarlier(root)
    // The sign's board can be read but not written, so reserving its takes fails after the door's are queued.
    const folder = join(root, 'content-studio/cache/image-patches/inn/sign')
    chmodSync(folder, 0o500)
    const answer = await patches
      .remake(file, 'inn', { count: 1, marks: {} })
      .catch(() => 'threw' as const)
      .finally(() => chmodSync(folder, 0o700))
    expect(answer === 'threw' || (answer && 'ok' in answer && answer.ok === false)).toBe(true)
    const view = (await patches.view(file, 'inn')) as ImagePatchesView
    expect(view.remake.press).toBeNull()
    expect(view.patches.map((p) => p.making.length)).toEqual([0, 0])
    release()
    await new Promise((r) => setTimeout(r, 30))
    expect(requests).toHaveLength(0)
  })
})

describe('a patch board changed from two places', () => {
  it('loses neither a take finishing nor a change made by another module at the same time', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await changePatchBoard({ projectFile: file, root, image: 'inn', patch: 'door' }, (board) => {
      board.inGame['9'] = 9
    })
    await work()
    const board = JSON.parse(readFileSync(join(root, BOARD), 'utf8'))
    expect(board.takes.map((t: { n: number }) => t.n)).toEqual([1])
    expect(board.inGame).toEqual({ '9': 9 })
  })
})

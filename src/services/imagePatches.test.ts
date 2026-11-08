import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { matchToTake, type ImagePatchesView, type PatchWorkView } from '../core/imagePatches'
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
  canEdit,
  makes = (request: ImageRequest) => fakePng(request.width, request.height, 1),
  queue = createSerial(),
  seeds = [11, 12, 13, 14, 15, 16, 17, 18],
  manifest,
}: {
  chosen?: boolean
  picture?: boolean
  ready?: ImageReady
  installed?: boolean
  canEdit?: boolean
  makes?: (request: ImageRequest) => Uint8Array
  queue?: Serial
  seeds?: number[]
  /** The manifest as the game has it, in place of the one with the image alone. */
  manifest?: unknown
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
    installed: () => installed,
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
  it("edits the chosen take's whole picture with the patch's words, at its size, with klein", async () => {
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
        editing: join(root, TAKE),
      },
    ])
  })

  it('keeps only the marked area of the edit, with its area and the words it was made from', async () => {
    const { root, file, patches, work } = setup()
    await patches.make(file, 'inn', 'door', { count: 1, area })
    expect(await work()).toEqual({
      id: 'door',
      takes: [{ n: 1, area, earlier: false, chosen: false, isNew: true, look: 'ready' }],
      making: [],
      failed: [],
      oldLook: false,
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
    const { root, file, patches, work } = setup({
      makes: (request) => fakePng(request.width, request.height, 5),
    })
    await patches.make(file, 'inn', 'door', { count: 1, area })
    await work()
    const take = decodePng(new Uint8Array(readFileSync(join(root, TAKE))))
    const edited = decodePng(fakePng(256, 256, 5))
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

  it('shows takes waiting and being made, each with the area it will use', async () => {
    let release = () => {}
    const queue = createSerial()
    void queue.run('gpu', () => new Promise<void>((resolve) => (release = resolve)))
    const { file, patches, work } = setup({ queue })
    await patches.make(file, 'inn', 'door', { count: 2, area })
    const view = (await patches.view(file, 'inn')) as ImagePatchesView
    const door = view.patches.find((p) => p.id === 'door')!
    expect(door.making).toEqual([
      { n: 1, state: 'waiting', elapsed: 0, expected: expect.any(Number), area },
      { n: 2, state: 'waiting', elapsed: 0, expected: expect.any(Number), area },
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
    expect(await absent.patches.view(absent.file, 'inn')).toMatchObject({
      maker: { ok: false, message: missing },
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

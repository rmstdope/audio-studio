import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { EditModelId } from '../core/imageModels'
import type { FineTunesView } from '../core/imageFineTunes'
import { createImageFineTunes } from './imageFineTunes'
import { createImageTakes } from './imageTakes'
import type { ImageGenerator, ImageRequest } from './images'
import { fakePng } from './imagesFake'
import { decodePng, encodePng } from './png'
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
  file: 'web/images/inn-own.png',
  patches: [{ id: 'door', title: 'The door', text: 'the door is gone' }],
}
const EDITS = 'content-studio/images/edits.json'
const LOCK = 'content-studio/images/lock.json'
const MANIFEST = 'web/images/manifest.json'
const FOLDER = 'content-studio/cache/image-fine-tunes/inn'
const area = { x: 64, y: 64, width: 128, height: 128 }
/** A mark far from the picture's top left corner. */
const farArea = { x: 160, y: 160, width: 64, height: 64 }
const madeFrom = { words: 'a low inn', style: 'x', width: 320, height: 200 }
const board = {
  next: 4,
  takes: [
    {
      n: 3,
      seed: 7,
      model: 'black-forest-labs/FLUX.2-klein-4B',
      width: 256,
      height: 256,
      madeFrom,
    },
  ],
}
const lock = {
  inn: {
    model: 'flux2-klein-4b',
    seed: 7,
    take: 3,
    inputs: { text: 'a low inn', width: 320, height: 200 },
  },
}

/** A project whose image `inn` has take 3 chosen (256 pixels square), or none and the game's own file. */
function setup({
  chosen = true,
  here = {},
  queue = createSerial(),
  makes = (request: ImageRequest) => fakePng(request.width, request.height, 1),
  extra = {},
}: {
  chosen?: boolean
  here?: Partial<Record<EditModelId, boolean>>
  queue?: Serial
  makes?: (request: ImageRequest) => Uint8Array
  extra?: Record<string, unknown>
} = {}) {
  const root = tempRepo({
    'content-studio.json': projectJson({ images }),
    'tts/act1/images.json': [inn],
    [EDITS]: { style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] }, images: {} },
    [MANIFEST]: { inn: { file: 'inn.png', width: 320, height: 200 } },
    ...(chosen ? { [LOCK]: lock, 'content-studio/cache/images/inn.json': board } : {}),
    ...extra,
  })
  if (chosen) {
    mkdirSync(join(root, 'content-studio/cache/image-takes/inn'), { recursive: true })
    writeFileSync(join(root, 'content-studio/cache/image-takes/inn/3.png'), fakePng(256, 256, 9))
  } else {
    writeFileSync(join(root, 'web/images/inn-own.png'), fakePng(320, 200, 5))
  }
  const file = join(root, 'content-studio.json')
  const requests: ImageRequest[] = []
  const generator: ImageGenerator = {
    ready: () => ({ ok: true }),
    installed: (model) => here[model as EditModelId] ?? true,
    async generate(request) {
      requests.push(request)
      return { png: makes(request), seed: request.seed }
    },
  }
  let seed = 10
  const deps = { generator, queue, free: () => {}, newSeed: () => seed++ }
  const takes = createImageTakes(deps)
  const tunes = createImageFineTunes({ ...deps, takes })
  async function settled(): Promise<FineTunesView> {
    for (let i = 0; i < 400; i++) {
      const view = await tunes.view(file, 'inn')
      if (!view || !('picture' in view)) throw new Error('no view')
      if (!view.making.length) return view
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('never finished')
  }
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  return { root, file, tunes, takes, requests, settled, read }
}

describe('making fine-tunes', () => {
  it('edits the whole picture of the chosen take when nothing is marked, and keeps it whole', async () => {
    const { root, file, tunes, requests, settled } = setup()
    expect(await tunes.make(file, 'inn', { count: 2, words: 'Add a cat', area: null })).toEqual({
      ok: true,
    })
    const view = await settled()
    expect(view.picture).toEqual({ kind: 'take', n: 3, width: 256, height: 256 })
    expect(view.tunes).toMatchObject([
      { n: 1, words: 'Add a cat', area: null, model: 'klein', isNew: true },
      { n: 2 },
    ])
    // Each is queued with its own seed, in the order of the press.
    expect([...requests].sort((a, b) => a.seed - b.seed)).toMatchObject([
      { prompt: 'Add a cat', width: 256, height: 256, seed: 10, model: 'klein' },
      { seed: 11 },
    ])
    expect(decodePng(new Uint8Array(readFileSync(join(root, FOLDER, '1.png'))))).toEqual(
      decodePng(fakePng(256, 256, 1)),
    )
    expect(JSON.parse(readFileSync(join(root, FOLDER, 'board.json'), 'utf8'))).toMatchObject({
      next: 3,
      tunes: [
        { n: 1, base: 3 },
        { n: 2, base: 3 },
      ],
    })
  })

  it('gives the model a window round a marked area and keeps only what changed there', async () => {
    const { root, file, tunes, requests, settled } = setup({
      makes: (request) => {
        // The model paints the marked area, whatever its window, white.
        const sent = decodePng(new Uint8Array(readFileSync(request.editing!)))
        for (let i = 0; i < sent.data.length; i += 4) sent.data.set([255, 255, 255, 255], i)
        return encodePng(sent)
      },
    })
    await tunes.make(file, 'inn', { count: 1, words: 'Make it white', area: farArea })
    await settled()
    expect(requests[0]!.editing).toBe(join(root, FOLDER, 'editing-1.png'))
    const kept = decodePng(new Uint8Array(readFileSync(join(root, FOLDER, '1.png'))))
    expect(kept.width).toBe(256)
    // Far from the mark nothing is kept.
    expect(kept.data[3]).toBe(0)
  })

  it('fine-tunes the game’s own image when no take is chosen, at the take size', async () => {
    const { file, tunes, requests, settled } = setup({ chosen: false })
    await tunes.make(file, 'inn', { count: 1, words: 'Add a cat', area: null })
    const view = await settled()
    expect(view.picture).toEqual({ kind: 'game', width: 1024, height: 640 })
    expect(requests[0]).toMatchObject({ width: 1024, height: 640 })
    expect(view.tunes).toHaveLength(1)
  })

  it('has nothing to fine-tune with no take chosen and no game image', async () => {
    const { file, tunes, root } = setup({ chosen: false })
    rmGame(root)
    const view = await tunes.view(file, 'inn')
    expect(view).toMatchObject({ picture: { kind: 'none' } })
    expect(await tunes.make(file, 'inn', { count: 1, words: 'x', area: null })).toMatchObject({
      ok: false,
    })
  })

  it('refuses a mark outside the picture and a model that is not here', async () => {
    const { file, tunes } = setup({ here: { 'qwen-edit': false } })
    expect(
      await tunes.make(file, 'inn', {
        count: 1,
        words: 'x',
        area: { x: 250, y: 0, width: 50, height: 50 },
      }),
    ).toMatchObject({ ok: false })
    expect(
      await tunes.make(file, 'inn', { count: 1, words: 'x', area: null, model: 'qwen-edit' }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('not on this computer') })
  })

  it('refuses a second press while one is being made, and Stop clears them', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, tunes, settled } = setup({
      makes: (request) => fakePng(request.width, request.height, 1),
      queue: gatedQueue(gate),
    })
    await tunes.make(file, 'inn', { count: 2, words: 'x', area: null })
    expect(await tunes.make(file, 'inn', { count: 1, words: 'y', area: null })).toMatchObject({
      ok: false,
    })
    const view = await tunes.view(file, 'inn')
    if (!view || !('making' in view)) throw new Error('no view')
    expect(view.making.map((m) => m.state)).toEqual(['waiting', 'waiting'])
    expect(await tunes.stop(file, 'inn')).toEqual({ ok: true, stopped: 2 })
    release()
    expect((await settled()).tunes).toEqual([])
  })

  it('keeps a failed fine-tune for Try again with its words, mark and model', async () => {
    let fail = true
    const { file, tunes, settled } = setup({
      makes: (request) => {
        if (fail) throw new Error('out of memory')
        return fakePng(request.width, request.height, 1)
      },
    })
    await tunes.make(file, 'inn', { count: 1, words: 'Add a cat', area })
    const failed = await settled()
    expect(failed.failed).toMatchObject([{ n: 1, words: 'Add a cat', area, model: 'klein' }])
    expect(failed.failed[0]!.message).toContain('out of memory')
    fail = false
    expect(await tunes.make(file, 'inn', { retry: 1 })).toEqual({ ok: true })
    const made = await settled()
    expect(made.failed).toEqual([])
    expect(made.tunes).toMatchObject([{ n: 1, words: 'Add a cat', area }])
  })

  it('belongs to the picture it was made from', async () => {
    const { file, tunes, settled, root } = setup()
    await tunes.make(file, 'inn', { count: 1, words: 'x', area: null })
    await settled()
    // The game now shows another take: this one's fine-tunes are not shown, and come back with it.
    const lockPath = join(root, LOCK)
    const original = readFileSync(lockPath, 'utf8')
    writeFileSync(lockPath, original.replace('"take": 3', '"take": 4'))
    mkdirSync(join(root, 'content-studio/cache/image-takes/inn'), { recursive: true })
    writeFileSync(join(root, 'content-studio/cache/image-takes/inn/4.png'), fakePng(256, 256, 2))
    expect(((await tunes.view(file, 'inn')) as FineTunesView).tunes).toEqual([])
    writeFileSync(lockPath, original)
    expect(((await tunes.view(file, 'inn')) as FineTunesView).tunes).toHaveLength(1)
  })
})

describe('looking at and dropping fine-tunes', () => {
  it('marks one seen, serves its picture, and drops it with its file', async () => {
    const { file, tunes, settled, root } = setup()
    await tunes.make(file, 'inn', { count: 2, words: 'x', area: null })
    await settled()
    expect(await tunes.markSeen(file, 'inn', 1)).toEqual({ ok: true })
    expect((await settled()).tunes.map((t) => t.isNew)).toEqual([false, true])
    expect(await tunes.file(file, 'inn', '1')).toBe(join(root, FOLDER, '1.png'))
    expect(await tunes.file(file, 'inn', '../1')).toBeNull()
    expect(await tunes.drop(file, 'inn', 2)).toEqual({ ok: true })
    expect(existsSync(join(root, FOLDER, '2.png'))).toBe(false)
    expect((await settled()).tunes.map((t) => t.n)).toEqual([1])
    expect(await tunes.drop(file, 'inn', 2)).toMatchObject({ ok: false })
  })

  it('stays across a reload of the service', async () => {
    const one = setup()
    await one.tunes.make(one.file, 'inn', { count: 1, words: 'x', area: null })
    await one.settled()
    const again = createImageFineTunes({
      generator: {
        ready: () => ({ ok: true }),
        installed: () => true,
        generate: async () => {
          throw new Error('no')
        },
      },
      queue: createSerial(),
      free: () => {},
      takes: one.takes,
    })
    expect(((await again.view(one.file, 'inn')) as FineTunesView).tunes).toHaveLength(1)
  })
})

describe('using a fine-tune', () => {
  it('makes it a new chosen take, keeps the old one, drops the other fine-tunes, and carries what the old one had', async () => {
    const { file, tunes, takes, settled, read, root } = setup({
      extra: {
        [EDITS]: {
          style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] },
          images: {
            inn: { takeAreas: { '3': { fountain: { x: 1, y: 2, width: 30, height: 40 } } } },
          },
        },
        'content-studio/cache/image-patches/inn/door/board.json': {
          next: 2,
          takes: [{ n: 1, base: 3, seed: 1, words: 'the door is gone', area, seen: true }],
          chosen: { '3': 1 },
          inGame: { '3': 1 },
        },
      },
    })
    writeFileSync(
      join(root, 'content-studio/cache/image-patches/inn/door/1.game.png'),
      fakePng(320, 200, 4),
    )
    await tunes.make(file, 'inn', { count: 3, words: 'Add a cat', area: null })
    await settled()
    const answer = await tunes.use(file, 'inn', 2)
    expect(answer).toEqual({ ok: true, take: 4, from: 3, carried: { areas: 1, patches: 1 } })
    const taken = await takes.view(file, 'inn')
    if (!taken || !('takes' in taken)) throw new Error('no view')
    expect(taken.takes.find((t) => t.n === 4)).toMatchObject({
      chosen: true,
      fineTunedFrom: { take: 3, words: 'Add a cat' },
    })
    expect(taken.takes.find((t) => t.n === 3)).toMatchObject({ chosen: false })
    expect(JSON.parse(read(LOCK)).inn.take).toBe(4)
    expect(
      decodePng(
        new Uint8Array(readFileSync(join(root, 'content-studio/cache/image-takes/inn/4.png'))),
      ),
    ).toEqual(decodePng(fakePng(256, 256, 1)))
    expect(JSON.parse(read(EDITS)).images.inn.takeAreas['4']).toEqual({
      fountain: { x: 1, y: 2, width: 30, height: 40 },
    })
    const patchBoard = JSON.parse(read('content-studio/cache/image-patches/inn/door/board.json'))
    expect(patchBoard.chosen).toEqual({ '3': 1, '4': 1 })
    expect(patchBoard.inGame).toEqual({ '3': 1, '4': 1 })
    expect(JSON.parse(read(MANIFEST)).inn.patches.door).toBeDefined()
    // The others are gone, with their files.
    const after = (await tunes.view(file, 'inn')) as FineTunesView
    expect(after.picture).toMatchObject({ kind: 'take', n: 4 })
    expect(after.tunes).toEqual([])
    expect(existsSync(join(root, FOLDER, '1.png'))).toBe(false)
    expect(existsSync(join(root, FOLDER, '3.png'))).toBe(false)
  })

  it('stops what is still waiting or being made', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, tunes, settled } = setup({ queue: gatedQueue(gate) })
    await tunes.make(file, 'inn', { count: 2, words: 'x', area: null })
    // Nothing is made yet, so there is nothing to use.
    expect(await tunes.use(file, 'inn', 1)).toMatchObject({ ok: false })
    release()
    await settled()
    expect(await tunes.use(file, 'inn', 1)).toMatchObject({ ok: true })
    expect(((await tunes.view(file, 'inn')) as FineTunesView).making).toEqual([])
  })

  it('lays a marked fine-tune over the picture, so the new take is whole', async () => {
    const { file, tunes, settled, root } = setup({
      makes: (request) => {
        const sent = decodePng(new Uint8Array(readFileSync(request.editing!)))
        for (let i = 0; i < sent.data.length; i += 4) sent.data.set([255, 255, 255, 255], i)
        return encodePng(sent)
      },
    })
    await tunes.make(file, 'inn', { count: 1, words: 'white', area: farArea })
    await settled()
    expect(await tunes.use(file, 'inn', 1)).toMatchObject({ ok: true, take: 4 })
    const take = decodePng(
      new Uint8Array(readFileSync(join(root, 'content-studio/cache/image-takes/inn/4.png'))),
    )
    const old = decodePng(
      new Uint8Array(readFileSync(join(root, 'content-studio/cache/image-takes/inn/3.png'))),
    )
    expect(take.data[3]).toBe(255)
    // Outside the mark the old picture is as it was.
    expect(Array.from(take.data.slice(0, 4))).toEqual(Array.from(old.data.slice(0, 4)))
  })

  it('from the game’s own image makes Take 1, chosen, and never changes the game’s file', async () => {
    const { file, tunes, takes, settled, root } = setup({ chosen: false })
    const own = readFileSync(join(root, 'web/images/inn-own.png'))
    await tunes.make(file, 'inn', { count: 1, words: 'Add a cat', area: null })
    await settled()
    expect(await tunes.use(file, 'inn', 1)).toEqual({
      ok: true,
      take: 1,
      from: null,
      carried: { areas: 0, patches: 0 },
    })
    const view = await takes.view(file, 'inn')
    if (!view || !('takes' in view)) throw new Error('no view')
    expect(view.takes).toMatchObject([
      { n: 1, chosen: true, fineTunedFrom: { take: null, words: 'Add a cat' } },
    ])
    expect(readFileSync(join(root, 'web/images/inn-own.png'))).toEqual(own)
  })

  it('leaves the fine-tunes when the take cannot be chosen', async () => {
    const { file, tunes, settled, root } = setup({
      extra: { [MANIFEST]: '{ not json' },
    })
    await tunes.make(file, 'inn', { count: 2, words: 'x', area: null })
    await settled()
    expect(await tunes.use(file, 'inn', 1)).toMatchObject({ ok: false })
    expect(((await tunes.view(file, 'inn')) as FineTunesView).tunes).toHaveLength(2)
    // The take that was added is not left behind.
    expect(existsSync(join(root, 'content-studio/cache/image-takes/inn/4.png'))).toBe(false)
  })

  it('refuses a fine-tune that is not on the board', async () => {
    const { file, tunes } = setup()
    expect(await tunes.use(file, 'inn', 9)).toMatchObject({ ok: false })
    expect(await tunes.use(file, 'nowhere', 1)).toBeNull()
  })
})

/** A queue that holds every job back until `gate` opens, one at a time. */
function gatedQueue(gate: Promise<void>): Serial {
  const inner = createSerial()
  return { run: (key, job) => inner.run(key, async () => (await gate, job())) }
}

function rmGame(root: string) {
  rmSync(join(root, 'web/images/inn-own.png'))
}

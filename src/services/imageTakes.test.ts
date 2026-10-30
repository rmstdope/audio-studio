import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { setImageWords } from './imageEdits'
import { readImages } from './imageLists'
import { createImageTakes } from './imageTakes'
import type { ImageModelId } from '../core/imageModels'
import type { ImageGenerator, ImageReady, ImageRequest } from './images'
import { createSerial } from './serial'
import { openProject } from './workspace'

const images = {
  paths: {
    list: 'tts/{part}/images.json',
    style: 'images/style.json',
    prompts: 'images/prompts.json',
    lock: 'images/images.lock.json',
    clips: 'web/images',
    manifest: 'web/images/manifest.json',
  },
}
const inn = { id: 'inn', title: 'Inn', description: 'a low inn', width: 320, height: 200 }

/** A generator that makes `png-<seed>` and fails for a prompt saying "fail"; `gate` holds it back. */
function fakeGenerator(
  ready: ImageReady = { ok: true },
  gate?: Promise<void>,
  here: Partial<Record<ImageModelId, boolean>> = {},
) {
  const requests: ImageRequest[] = []
  const generator: ImageGenerator = {
    ready: () => ready,
    installed: (model) => here[model] ?? true,
    async generate(request, signal) {
      requests.push(request)
      await gate
      if (signal?.aborted) throw new Error('The image generator was stopped.')
      if (request.prompt.includes('fail')) throw new Error('The image generator: out of memory')
      return { png: new TextEncoder().encode(`png-${request.seed}`), seed: request.seed }
    },
  }
  return { generator, requests }
}

function setup(
  ready?: ImageReady,
  extra: Record<string, unknown> = {},
  gate?: Promise<void>,
  options: { here?: Partial<Record<ImageModelId, boolean>>; model?: ImageModelId } = {},
) {
  const root = tempRepo({
    'audio-studio.json': projectJson({
      images: options.model ? { ...images, model: options.model } : images,
    }),
    'tts/act1/images.json': [inn, { ...inn, id: 'hall', title: 'Hall' }],
    'images/style.json': { look: 'pixel art', keepOut: 'text', palette: ['#000000'], acts: {} },
    ...extra,
  })
  const file = join(root, 'audio-studio.json')
  const { generator, requests } = fakeGenerator(ready, gate, options.here)
  let seed = 100
  const takes = createImageTakes({
    generator,
    queue: createSerial(),
    free: () => {},
    now: () => 0,
    newSeed: () => seed++,
  })
  async function settled(id: string) {
    for (let i = 0; i < 200; i++) {
      const view = await takes.view(file, id)
      if (!view || !('ok' in view) || !view.ok) return view
      if (!view.making.length) return view
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('takes never finished')
  }
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  const row = async (id = 'inn') => {
    const opened = await openProject(file)
    if (!opened.ok) throw new Error('project')
    const project = opened.project
    const summary = await readImages(root, project, [])
    return summary!.acts.flatMap((a) => a.rows).find((r) => r.id === id)!
  }
  return { root, file, takes, requests, settled, read, row }
}

describe('making takes', () => {
  it('makes takes one after another from the whole prompt, at the take size, and lists them', async () => {
    const { takes, file, requests, settled, read, row } = setup()
    expect(await takes.make(file, 'inn', { count: 2 })).toEqual({ ok: true })
    const view = await settled('inn')
    expect(view).toMatchObject({ ok: true, generator: { ok: true }, lockUnread: false })
    if (!view || !('takes' in view)) throw new Error('no view')
    expect(view.takes).toMatchObject([
      { n: 1, width: 1024, height: 640, earlier: false, chosen: false, isNew: true },
      { n: 2, isNew: true },
    ])
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ width: 1024, height: 640, seed: 100, model: 'klein' })
    expect(requests[0]!.prompt).toBe((await row()).prompt)
    expect(read('.audio-studio/image-takes/inn/1.png')).toBe('png-100')
    expect(read('.audio-studio/image-takes/inn/2.png')).toBe('png-101')
    const board = JSON.parse(read('.audio-studio/images/inn.json'))
    expect(board.next).toBe(3)
    expect(board.takes[0].madeFrom).toEqual((await row()).madeFrom)
  })

  it('shows takes waiting and being made, and never reuses a number', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { takes, file, settled } = setup(undefined, {}, gate)
    await takes.make(file, 'inn', { count: 2 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const view = await takes.view(file, 'inn')
    if (!view || !('making' in view)) throw new Error('no view')
    expect(view.making.map((m) => [m.n, m.state])).toEqual([
      [1, 'making'],
      [2, 'waiting'],
    ])
    expect(view.making[0]!.expected).toBe(8)
    expect(await takes.making(file)).toEqual({ inn: { takes: 2, left: 16 } })
    release()
    await settled('inn')
    await takes.make(file, 'inn', { count: 1 })
    const again = await settled('inn')
    if (!again || !('takes' in again)) throw new Error('no view')
    expect(again.takes.map((t) => t.n)).toEqual([1, 2, 3])
    expect(await takes.making(file)).toEqual({})
  })

  it('keeps a take that failed with its reason, and Try again makes the same number', async () => {
    const { takes, file, settled } = setup(undefined, {
      'images/prompts.json': {
        images: { inn: { words: 'fail now', gameWas: 'a low inn' } },
        style: {},
      },
    })
    await takes.make(file, 'inn', { count: 1 })
    const failed = await settled('inn')
    if (!failed || !('failed' in failed)) throw new Error('no view')
    expect(failed.failed).toEqual([{ n: 1, message: expect.stringContaining('out of memory') }])
    expect(failed.takes).toEqual([])
    await setImageWords(file, 'inn', 'a low inn')
    expect(await takes.make(file, 'inn', { retry: 1 })).toEqual({ ok: true })
    const done = await settled('inn')
    if (!done || !('takes' in done)) throw new Error('no view')
    expect(done.takes.map((t) => t.n)).toEqual([1])
    expect(done.failed).toEqual([])
    expect(await takes.make(file, 'inn', { retry: 9 })).toMatchObject({ ok: false })
  })

  it('stops the take being made and the ones waiting, and writes nothing for them', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { takes, file, root, requests } = setup(undefined, {}, gate)
    await takes.make(file, 'inn', { count: 3 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(await takes.stop(file, 'inn')).toEqual({ ok: true, stopped: 3 })
    release()
    await new Promise((resolve) => setTimeout(resolve, 30))
    const view = await takes.view(file, 'inn')
    if (!view || !('takes' in view)) throw new Error('no view')
    expect(view.takes).toEqual([])
    expect(view.making).toEqual([])
    expect(requests).toHaveLength(1)
    expect(existsSync(join(root, '.audio-studio/image-takes/inn/1.png'))).toBe(false)
  })

  it('refuses when images cannot be made here, and says what the view shows', async () => {
    const ready = {
      ok: false as const,
      reason: 'mflux' as const,
      message: 'mflux is not on the PATH',
      fix: 'uv tool install mflux',
    }
    const { takes, file } = setup(ready)
    expect(await takes.make(file, 'inn', { count: 1 })).toEqual({
      ok: false,
      message: 'mflux is not on the PATH',
    })
    const view = await takes.view(file, 'inn')
    expect(view).toMatchObject({ ok: true, generator: ready })
  })

  it('knows no image the game does not list, and no unsafe id', async () => {
    const { takes, file } = setup()
    expect(await takes.view(file, 'nope')).toBeNull()
    expect(await takes.make(file, '../x', { count: 1 })).toBeNull()
    expect(await takes.takeFile(file, 'inn', '1')).toBeNull()
  })

  it('marks a take earlier when the words changed since, and not new once seen', async () => {
    const { takes, file, settled } = setup()
    await takes.make(file, 'inn', { count: 2 })
    await settled('inn')
    await setImageWords(file, 'inn', 'a high inn')
    expect(await takes.markSeen(file, 'inn', 2)).toEqual({ ok: true })
    const view = await takes.view(file, 'inn')
    if (!view || !('takes' in view)) throw new Error('no view')
    expect(view.takes.map((t) => [t.n, t.earlier, t.isNew])).toEqual([
      [1, true, true],
      [2, true, false],
    ])
    expect(await takes.markSeen(file, 'inn', 9)).toMatchObject({ ok: false })
  })

  it('serves a take’s picture by number only', async () => {
    const { takes, file, root, settled } = setup()
    await takes.make(file, 'inn', { count: 1 })
    await settled('inn')
    expect(await takes.takeFile(file, 'inn', '1')).toBe(
      join(root, '.audio-studio/image-takes/inn/1.png'),
    )
    expect(await takes.takeFile(file, 'inn', '2')).toBeNull()
    expect(await takes.takeFile(file, 'inn', '../1')).toBeNull()
  })
})

describe('choosing', () => {
  async function made(extra: Record<string, unknown> = {}) {
    const s = setup(undefined, extra)
    await s.takes.make(s.file, 'inn', { count: 2 })
    await s.settled('inn')
    return s
  }

  it('writes the picture, the manifest and the lock, and the image is then chosen', async () => {
    const { takes, file, root, read, row } = await made()
    expect(await takes.choose(file, 'inn', 2)).toEqual({ ok: true })
    expect(read('web/images/inn.png')).toBe('png-101')
    expect(JSON.parse(read('web/images/manifest.json'))).toEqual({
      inn: { file: 'inn.png', width: 1024, height: 640 },
    })
    expect(read('web/images/manifest.json')).toContain('"width": 1024,')
    const lock = JSON.parse(read('images/images.lock.json'))
    expect(lock.images.inn.chosen).toMatchObject({
      words: 'a low inn',
      width: 320,
      height: 200,
      take: 2,
      seed: 101,
      model: 'flux2-klein-4b',
    })
    expect(read('images/images.lock.json')).toContain('\n "images"')
    const r = await row()
    expect(r).toMatchObject({ status: 'chosen', chosenTake: 2 })
    const view = await takes.view(file, 'inn')
    if (!view || !('takes' in view)) throw new Error('no view')
    expect(view.takes.map((t) => [t.n, t.chosen, t.isNew])).toEqual([
      [1, false, true],
      [2, true, false],
    ])
    expect(await takes.currentFile(file, 'inn')).toBe(join(root, 'web/images/inn.png'))
  })

  it('choosing the take that is already chosen changes nothing', async () => {
    const { takes, file, read } = await made()
    await takes.choose(file, 'inn', 1)
    const before = read('images/images.lock.json')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await takes.choose(file, 'inn', 1)).toEqual({ ok: true })
    expect(read('images/images.lock.json')).toBe(before)
  })

  it('goes out of date when the words change, and choosing another replaces the picture', async () => {
    const { takes, file, read, row } = await made()
    await takes.choose(file, 'inn', 1)
    await setImageWords(file, 'inn', 'a high inn')
    expect((await row()).status).toBe('out of date')
    expect(await takes.choose(file, 'inn', 2)).toEqual({ ok: true })
    expect(read('web/images/inn.png')).toBe('png-101')
    expect((await row()).status).toBe('out of date')
    expect(JSON.parse(read('images/images.lock.json')).images.inn.chosen.take).toBe(2)
  })

  it('keeps the other images, the other manifest entries and the lock’s other keys', async () => {
    const { takes, file, read } = await made({
      'images/images.lock.json': {
        zeta: 1,
        images: { hall: { chosen: { words: 'w', style: 's', width: 1, height: 2, take: 4 } } },
        other: [1],
      },
      'web/images/manifest.json': { hall: { file: 'hall.png', width: 8, height: 8 } },
    })
    await takes.choose(file, 'inn', 1)
    const lock = JSON.parse(read('images/images.lock.json'))
    expect(Object.keys(lock.images)).toEqual(['hall', 'inn'])
    expect(lock.other).toEqual([1])
    // The top-level keys are sorted, whatever order the file had them in.
    expect(Object.keys(lock)).toEqual(['images', 'other', 'zeta'])
    expect(Object.keys(JSON.parse(read('web/images/manifest.json')))).toEqual(['hall', 'inn'])
  })

  it('changes nothing when the lock or the manifest cannot be read', async () => {
    const lockBroken = await made({ 'images/images.lock.json': '{ nope' })
    expect(await lockBroken.takes.choose(lockBroken.file, 'inn', 1)).toMatchObject({ ok: false })
    expect(existsSync(join(lockBroken.root, 'web/images/inn.png'))).toBe(false)
    const view = await lockBroken.takes.view(lockBroken.file, 'inn')
    expect(view).toMatchObject({ ok: true, lockUnread: true })
    const manifestBroken = await made({ 'web/images/manifest.json': '[1' })
    const result = await manifestBroken.takes.choose(manifestBroken.file, 'inn', 1)
    expect(result).toMatchObject({ ok: false })
    expect(existsSync(join(manifestBroken.root, 'images/images.lock.json'))).toBe(false)
    expect(await manifestBroken.takes.choose(manifestBroken.file, 'inn', 9)).toMatchObject({
      ok: false,
    })
  })

  it('un-chooses: the manifest entry, the picture and the lock entry go, the take stays', async () => {
    const { takes, file, root, read, row } = await made()
    expect(await takes.unchoose(file, 'inn')).toMatchObject({ ok: false })
    await takes.choose(file, 'inn', 1)
    expect(await takes.unchoose(file, 'inn')).toEqual({ ok: true })
    expect(existsSync(join(root, 'web/images/inn.png'))).toBe(false)
    expect(JSON.parse(read('web/images/manifest.json'))).toEqual({})
    expect(JSON.parse(read('images/images.lock.json')).images).toEqual({})
    expect((await row()).status).toBe('none yet')
    expect(existsSync(join(root, '.audio-studio/image-takes/inn/1.png'))).toBe(true)
    expect(await takes.currentFile(file, 'inn')).toBeNull()
  })

  it('drops a take that is not chosen, and refuses the chosen one', async () => {
    const { takes, file, root } = await made()
    await takes.choose(file, 'inn', 2)
    expect(await takes.drop(file, 'inn', 2)).toMatchObject({ ok: false })
    expect(await takes.drop(file, 'inn', 1)).toEqual({ ok: true })
    expect(existsSync(join(root, '.audio-studio/image-takes/inn/1.png'))).toBe(false)
    const view = await takes.view(file, 'inn')
    if (!view || !('takes' in view)) throw new Error('no view')
    expect(view.takes.map((t) => t.n)).toEqual([2])
    expect(await takes.drop(file, 'inn', 1)).toMatchObject({ ok: false })
  })

  it('refuses a drop while the lock cannot be read', async () => {
    const { takes, file } = await made({ 'images/images.lock.json': '{ nope' })
    expect(await takes.drop(file, 'inn', 1)).toMatchObject({ ok: false })
  })

  it('plays the game’s own image when none is chosen', async () => {
    const own = setup(undefined, {
      'tts/act1/images.json': [{ ...inn, file: 'web/own.png' }],
    })
    expect(await own.takes.currentFile(own.file, 'inn')).toBeNull()
    mkdirSync(join(own.root, 'web'), { recursive: true })
    writeFileSync(join(own.root, 'web/own.png'), 'own')
    expect(await own.takes.currentFile(own.file, 'inn')).toBe(join(own.root, 'web/own.png'))
  })
})

describe('image models', () => {
  const viewOf = async (s: ReturnType<typeof setup>) => {
    const view = await s.takes.view(s.file, 'inn')
    if (!view || !('takes' in view)) throw new Error('no view')
    return view
  }

  it('reports the project’s model and which models are here', async () => {
    const s = setup(undefined, {}, undefined, { model: 'z-image-turbo', here: { klein: false } })
    expect(await viewOf(s)).toMatchObject({
      projectModel: 'z-image-turbo',
      models: [
        { id: 'klein', installed: false },
        { id: 'z-image-turbo', installed: true },
      ],
      generator: { ok: true },
    })
  })

  it('cannot make images only when neither model can run', async () => {
    const none = setup(undefined, {}, undefined, {
      here: { klein: false, 'z-image-turbo': false },
    })
    expect(await viewOf(none)).toMatchObject({ generator: { ok: false } })
    const noMflux = setup({
      ok: false,
      reason: 'mflux',
      message: 'mflux is not on the PATH',
      fix: 'x',
    })
    expect(await viewOf(noMflux)).toMatchObject({ generator: { ok: false } })
  })

  it('makes a take with the model asked for, and records it', async () => {
    const s = setup()
    expect(await s.takes.make(s.file, 'inn', { count: 1, model: 'z-image-turbo' })).toEqual({
      ok: true,
    })
    const view = (await s.settled('inn')) as Awaited<ReturnType<typeof viewOf>>
    expect(s.requests[0]!.model).toBe('z-image-turbo')
    expect(view.takes[0]!.model).toBe('z-image-turbo')
    expect(JSON.parse(s.read('.audio-studio/images/inn.json')).takes[0].model).toBe('z-image-turbo')
  })

  it('without a model asked for, uses the project’s, else the other one that is here', async () => {
    const main = setup(undefined, {}, undefined, { model: 'z-image-turbo' })
    await main.takes.make(main.file, 'inn', { count: 1 })
    await main.settled('inn')
    expect(main.requests[0]!.model).toBe('z-image-turbo')
    const missing = setup(undefined, {}, undefined, { here: { klein: false } })
    await missing.takes.make(missing.file, 'inn', { count: 1 })
    await missing.settled('inn')
    expect(missing.requests[0]!.model).toBe('z-image-turbo')
  })

  it('refuses a model that is not on this computer, making nothing', async () => {
    const s = setup(undefined, {}, undefined, { here: { 'z-image-turbo': false } })
    expect(await s.takes.make(s.file, 'inn', { count: 1, model: 'z-image-turbo' })).toEqual({
      ok: false,
      message: 'Z-Image-Turbo is not on this computer. Setup says how to download it.',
    })
    expect(s.requests).toEqual([])
  })

  it('remakes a failed take with the model it was asked with', async () => {
    const s = setup(undefined, {
      'images/prompts.json': {
        images: { inn: { words: 'fail now', gameWas: 'a low inn' } },
        style: {},
      },
    })
    await s.takes.make(s.file, 'inn', { count: 1, model: 'z-image-turbo' })
    await s.settled('inn')
    await setImageWords(s.file, 'inn', 'a low inn')
    await s.takes.make(s.file, 'inn', { retry: 1 })
    await s.settled('inn')
    expect(s.requests.map((r) => r.model)).toEqual(['z-image-turbo', 'z-image-turbo'])
  })

  it('expects a take as long as its model takes', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const s = setup(undefined, {}, gate)
    await s.takes.make(s.file, 'inn', { count: 1, model: 'z-image-turbo' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await viewOf(s)).making[0]!.expected).toBe(60)
    expect(await s.takes.making(s.file)).toEqual({ inn: { takes: 1, left: 60 } })
    release()
    await s.settled('inn')
  })
})

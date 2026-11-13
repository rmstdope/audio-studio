import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fakePng } from '../services/imagesFake'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { startServer } from './index'
import { encode, fish } from './test-support'

describe('the images routes', () => {
  const imagesRoot = tempRepo({
    'content-studio.json': projectJson({
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/public/images/generated',
        manifest: 'web/public/images/generated/manifest.json',
      },
    }),
    'tts/act1/images.json': [
      {
        id: 'inn',
        title: 'Inn',
        text: 'a low inn',
        width: 320,
        height: 200,
        patches: [{ id: 'lamp-lit', title: 'Lamp lit', text: 'Light the lamp' }],
        areas: [
          { id: 'sign', title: 'Sign' },
          { id: 'door', title: 'Door' },
        ],
      },
    ],
    'content-studio/images/edits.json': {
      style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] },
      images: {},
    },
  })
  const studio = startServer({
    projectFile: join(imagesRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => studio.stop(true))
  const send = (method: string, path: string, body: unknown, origin = studio.url.origin) =>
    fetch(new URL(path, studio.url), {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const summary = async () =>
    (await (await fetch(new URL('/api/project', studio.url))).json()).summary.images

  it('shows the named areas the game lists, read again each time, without making the image out of date', async () => {
    const areas = async () => (await summary()).acts[0].rows[0].areas
    expect(await areas()).toEqual([
      {
        id: 'sign',
        title: 'Sign',
        placed: false,
        box: null,
        boxes: {},
        elsewhere: [],
        elsewhereGone: false,
      },
      {
        id: 'door',
        title: 'Door',
        placed: false,
        box: null,
        boxes: {},
        elsewhere: [],
        elsewhereGone: false,
      },
    ])
    const file = join(imagesRoot, 'tts/act1/images.json')
    const listed = JSON.parse(await Bun.file(file).text())
    try {
      await Bun.write(
        file,
        JSON.stringify([
          {
            ...listed[0],
            areas: [
              { id: 'sign', title: 'Old sign' },
              { id: 'well', title: 'Well' },
            ],
          },
        ]),
      )
      expect(await areas()).toEqual([
        {
          id: 'sign',
          title: 'Old sign',
          placed: false,
          box: null,
          boxes: {},
          elsewhere: [],
          elsewhereGone: false,
        },
        {
          id: 'well',
          title: 'Well',
          placed: false,
          box: null,
          boxes: {},
          elsewhere: [],
          elsewhereGone: false,
        },
      ])
      expect((await summary()).acts[0].rows[0].status).toBe('none yet')
    } finally {
      await Bun.write(file, JSON.stringify(listed))
    }
  })

  it('shows the images in the project summary', async () => {
    expect((await summary()).acts[0].rows[0]).toMatchObject({ id: 'inn', status: 'none yet' })
  })

  it('takes changes from the studio’s own page only', async () => {
    for (const [method, path, body] of [
      ['PATCH', '/api/images/inn', { words: 'x' }],
      ['PATCH', '/api/image-style', { look: 'x' }],
      ['POST', '/api/images/inn/compare', { choice: 'keep' }],
      ['PATCH', '/api/images/inn/act-style', { on: false }],
      ['PATCH', '/api/images/inn/game-patches/lamp-lit', { words: 'x' }],
      ['POST', '/api/images/inn/game-patches/lamp-lit/compare', { choice: 'keep' }],
      ['PUT', '/api/images/inn/areas/sign', { box: null }],
    ] as const) {
      expect((await send(method, path, body, 'https://evil.example')).status).toBe(403)
    }
  })

  it('saves the user’s words, and the summary shows them', async () => {
    expect(await (await send('PATCH', '/api/images/inn', { words: 'a cosy inn' })).json()).toEqual({
      ok: true,
    })
    expect((await summary()).acts[0].rows[0]).toMatchObject({ words: 'a cosy inn', changed: true })
  })

  it('refuses a body that is not words, and answers 404 for an unknown image', async () => {
    expect((await send('PATCH', '/api/images/inn', { words: 3 })).status).toBe(400)
    expect((await send('PATCH', '/api/images/ghost', { words: 'x' })).status).toBe(404)
    expect((await send('POST', '/api/images/inn/compare', { choice: 'maybe' })).status).toBe(400)
  })

  it('saves the words of a patch the game asks for, and settles it', async () => {
    const path = '/api/images/inn/game-patches/lamp-lit'
    expect((await summary()).acts[0].rows[0].patches[0]).toMatchObject({ changed: false })
    expect(await (await send('PATCH', path, { words: 'Dim the lamp' })).json()).toEqual({
      ok: true,
    })
    expect((await summary()).acts[0].rows[0].patches[0]).toMatchObject({
      words: 'Dim the lamp',
      changed: true,
    })
    expect((await send('PATCH', path, { words: 3 })).status).toBe(400)
    expect((await send('POST', `${path}/compare`, { choice: 'maybe' })).status).toBe(400)
    expect((await send('PATCH', '/api/images/inn/game-patches/ghost', { words: 'x' })).status).toBe(
      404,
    )
    expect(
      (await send('PATCH', '/api/images/ghost/game-patches/lamp-lit', { words: 'x' })).status,
    ).toBe(404)
    expect((await send('POST', `${path}/compare`, { choice: 'game' })).status).toBe(200)
    expect((await summary()).acts[0].rows[0].patches[0].changed).toBe(false)
  })

  it('marks a named area and clears it, refusing what cannot be kept', async () => {
    const path = '/api/images/inn/areas/sign'
    const box = { x: 10, y: 20, width: 50, height: 40 }
    const placed = async () => (await summary()).acts[0].rows[0].areas[0]
    const manifestFile = join(imagesRoot, 'web/public/images/generated/manifest.json')
    // No take is chosen yet: the game has no entry for the image, so nothing is saved.
    const refused = await send('PUT', path, { box })
    expect(refused.status).toBe(409)
    expect(JSON.stringify(await refused.json())).toContain('no entry in the images manifest')
    expect(await placed()).toMatchObject({ placed: false })
    mkdirSync(dirname(manifestFile), { recursive: true })
    writeFileSync(
      manifestFile,
      JSON.stringify({ inn: { file: 'inn.png', width: 320, height: 200 } }),
    )
    expect(await (await send('PUT', path, { box })).json()).toEqual({ ok: true })
    expect(await placed()).toMatchObject({ placed: true, box })
    expect(JSON.parse(readFileSync(manifestFile, 'utf8')).inn.areas.sign).toEqual({
      x: 0.03125,
      y: 0.1,
      width: 0.15625,
      height: 0.2,
    })
    const pointed = { ...box, point: { x: 30, y: 25 } }
    expect(await (await send('PUT', path, { box: pointed })).json()).toEqual({ ok: true })
    expect(await placed()).toMatchObject({ box: pointed })
    expect((await send('PUT', path, { box: { ...box, point: { x: 0, y: 0 } } })).status).toBe(409)
    expect(await (await send('PUT', path, { box: null })).json()).toEqual({ ok: true })
    expect(await placed()).toMatchObject({ placed: false, box: null })
    expect(JSON.parse(readFileSync(manifestFile, 'utf8')).inn.areas).toBeUndefined()
    expect((await send('PUT', path, { box: { ...box, x: 300 } })).status).toBe(409)
    expect((await send('PUT', path, { box: 3 })).status).toBe(400)
    expect((await send('PUT', path, {})).status).toBe(400)
    expect((await send('PUT', '/api/images/inn/areas/ghost', { box })).status).toBe(404)
    expect((await send('PUT', '/api/images/ghost/areas/sign', { box })).status).toBe(404)
  })

  it('saves an image leaving its act’s style out, refuses a bad body and an unknown image', async () => {
    expect(await (await send('PATCH', '/api/images/inn/act-style', { on: false })).json()).toEqual({
      ok: true,
    })
    expect((await send('PATCH', '/api/images/inn/act-style', { on: 'no' })).status).toBe(400)
    expect((await send('PATCH', '/api/images/ghost/act-style', { on: false })).status).toBe(404)
  })

  it('saves which act’s style a shared image uses, and refuses an act that cannot give one', async () => {
    expect(await (await send('PATCH', '/api/images/inn/act-style', { from: null })).json()).toEqual(
      { ok: true },
    )
    expect((await send('PATCH', '/api/images/inn/act-style', { from: 'act9' })).status).toBe(404)
    expect((await send('PATCH', '/api/images/inn/act-style', { from: 3 })).status).toBe(400)
  })

  it('saves a style field, refuses an empty look, and settles a compare', async () => {
    expect((await send('PATCH', '/api/image-style', { look: 'oil' })).status).toBe(200)
    expect((await summary()).style.look).toBe('oil')
    expect((await send('PATCH', '/api/image-style', { look: '' })).status).toBe(409)
    expect((await send('POST', '/api/images/inn/compare', { choice: 'game' })).status).toBe(200)
    expect((await summary()).acts[0].rows[0].changed).toBe(false)
    expect((await send('POST', '/api/image-style/seen', {})).status).toBe(404)
  })
})

describe('the image takes routes', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/images',
        manifest: 'web/images/manifest.json',
      },
    }),
    'tts/act1/images.json': [
      { id: 'inn', title: 'Inn', text: 'a low inn', width: 320, height: 200 },
    ],
    'content-studio/images/edits.json': {
      style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] },
      images: {},
    },
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    transcriber: null,
    images: {
      ready: () => ({ ok: true }),
      installed: () => true,
      generate: async (request) => ({
        png: fakePng(request.width, request.height, request.seed),
        seed: request.seed,
      }),
    },
  })
  afterAll(() => studio.stop(true))
  const send = (method: string, path: string, body?: unknown, origin = studio.url.origin) =>
    fetch(new URL(path, studio.url), {
      method,
      headers: { origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const view = async () => (await fetch(new URL('/api/images/inn/takes', studio.url))).json()
  async function settled() {
    for (let i = 0; i < 200; i++) {
      const v = await view()
      if (!v.making.length && !v.takes.some((t: { look: string }) => t.look === 'bringing'))
        return v
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('never finished')
  }

  it('takes changes from the studio’s own page only', async () => {
    for (const [method, path, body] of [
      ['POST', '/api/images/inn/takes', { count: 1 }],
      ['DELETE', '/api/images/inn/takes/1', undefined],
      ['POST', '/api/images/inn/choose', { n: 1 }],
      ['POST', '/api/images/inn/unchoose', undefined],
      ['POST', '/api/images/inn/accept', undefined],
      ['POST', '/api/images/inn/stop', undefined],
      ['POST', '/api/images/inn/takes/1/seen', undefined],
      ['POST', '/api/images/bring-all', undefined],
      ['POST', '/api/image-acts/act1/make-all', undefined],
      ['POST', '/api/image-acts/act1/stop', undefined],
      ['POST', '/api/image-acts/act1/batch/close', undefined],
      ['POST', '/api/images/inn/patches/door/takes', { count: 1, area: {} }],
      ['DELETE', '/api/images/inn/patches/door/takes/1', undefined],
      ['POST', '/api/images/inn/patches/door/takes/1/seen', undefined],
      ['POST', '/api/images/inn/patches/door/choose', { n: 1 }],
      ['POST', '/api/images/inn/patches/door/unchoose', undefined],
      ['POST', '/api/images/inn/patches/door/stop', undefined],
      ['POST', '/api/images/inn/patches/remake', { count: 1, marks: {} }],
      ['POST', '/api/images/inn/patches/remake/stop', undefined],
      ['POST', '/api/images/inn/patches/remake/close', undefined],
    ] as const) {
      expect((await send(method, path, body, 'https://evil.example')).status).toBe(403)
    }
  })

  it('answers 400 to a remake body that is not { count, marks }, and 409 when nothing needs remaking', async () => {
    expect(
      (await send('POST', '/api/images/inn/patches/remake', { count: 9, marks: {} })).status,
    ).toBe(400)
    expect(
      (await send('POST', '/api/images/inn/patches/remake', { count: 1, marks: {} })).status,
    ).toBe(409)
    expect((await send('POST', '/api/images/inn/patches/remake/close')).status).toBe(200)
  })

  it('answers 400 to a model that is not an edit model, in a make or a remake', async () => {
    const area = { x: 0, y: 0, width: 64, height: 64 }
    for (const [path, body] of [
      ['/api/images/inn/patches/door/takes', { count: 1, area, model: 'z-image-turbo' }],
      ['/api/images/inn/patches/remake', { count: 1, marks: {}, model: 'nope' }],
    ] as const) {
      expect((await send('POST', path, body)).status).toBe(400)
    }
    // A known model passes the body check; the remake then finds nothing to make again.
    expect(
      (
        await send('POST', '/api/images/inn/patches/remake', {
          count: 1,
          marks: {},
          model: 'qwen-edit',
        })
      ).status,
    ).toBe(409)
  })

  it('makes takes, serves their pictures, chooses one and shows it as the current image', async () => {
    expect((await send('POST', '/api/images/inn/takes', { count: 2 })).status).toBe(200)
    const made = await settled()
    expect(made.takes.map((t: { n: number }) => t.n)).toEqual([1, 2])
    const picture = await fetch(new URL('/api/images/inn/takes/2', studio.url))
    expect(picture.status).toBe(200)
    expect((await picture.arrayBuffer()).byteLength).toBeGreaterThan(100)
    const game = await fetch(new URL('/api/images/inn/takes/2/game', studio.url))
    expect(game.status).toBe(200)
    expect((await game.arrayBuffer()).byteLength).toBeGreaterThan(50)
    expect((await fetch(new URL('/api/images/inn/takes/9/game', studio.url))).status).toBe(404)
    expect((await fetch(new URL('/api/images/inn/takes/9', studio.url))).status).toBe(404)
    expect((await fetch(new URL('/api/images/inn/current', studio.url))).status).toBe(404)
    expect(await (await send('POST', '/api/images/inn/choose', { n: 2 })).json()).toEqual({
      ok: true,
    })
    expect((await fetch(new URL('/api/images/inn/current', studio.url))).status).toBe(200)
    expect(existsSync(join(root, 'web/images/inn.png'))).toBe(true)
    expect((await view()).takes.find((t: { n: number }) => t.n === 2).chosen).toBe(true)
    const project = await (await fetch(new URL('/api/project', studio.url))).json()
    expect(project.summary.images.acts[0].rows[0]).toMatchObject({
      status: 'chosen',
      chosenTake: 2,
    })
  })

  it('marks a take seen, drops one, refuses to drop the chosen one, and un-chooses', async () => {
    expect((await send('POST', '/api/images/inn/takes/1/seen')).status).toBe(200)
    expect((await view()).takes[0].isNew).toBe(false)
    expect((await send('DELETE', '/api/images/inn/takes/2')).status).toBe(409)
    expect((await send('DELETE', '/api/images/inn/takes/1')).status).toBe(200)
    // Nothing has changed since the take was chosen, so there is nothing to accept.
    expect((await send('POST', '/api/images/inn/accept')).status).toBe(409)
    expect((await send('POST', '/api/images/inn/unchoose')).status).toBe(200)
    expect((await send('POST', '/api/images/inn/unchoose')).status).toBe(409)
    expect((await send('POST', '/api/images/inn/stop')).status).toBe(200)
    expect(await (await fetch(new URL('/api/images/making', studio.url))).json()).toEqual({})
  })

  it('tells every image time figure as a guess until a take has been timed here', async () => {
    const figures = await (await fetch(new URL('/api/images/take-times', studio.url))).json()
    expect(figures.klein).toEqual({ seconds: 20, guess: true })
    expect(figures['z-image-turbo']).toEqual({ seconds: 60, guess: true })
    expect(figures['qwen-edit']).toEqual({ seconds: 480, guess: true })
    expect(figures['klein-edit']).toEqual({ seconds: 20, guess: true })
    expect((await send('POST', '/api/images/take-times')).status).not.toBe(200)
  })

  it('has nothing to bring to a new look while every picture is up to date', async () => {
    expect(await (await fetch(new URL('/api/images/bring-all', studio.url))).json()).toBeNull()
    expect(await (await send('POST', '/api/images/bring-all')).json()).toEqual({ ok: true })
  })

  it('makes four takes for every image of an act with no chosen take, and stops them', async () => {
    const state = await (await fetch(new URL('/api/images/model-state', studio.url))).json()
    expect(state).toMatchObject({ ok: true, main: 'klein', ready: true })
    expect((await send('POST', '/api/image-acts/ghost/make-all')).status).toBe(404)
    expect((await send('POST', '/api/image-acts/ghost/stop')).status).toBe(404)
    const before = (await view()).takes.length
    expect(await (await send('POST', '/api/image-acts/act1/make-all')).json()).toMatchObject({
      ok: true,
      images: ['inn'],
      takes: 4,
    })
    const made = await settled()
    expect(made.takes).toHaveLength(before + 4)
    const stopped = await (await send('POST', '/api/image-acts/act1/stop')).json()
    expect(stopped).toEqual({ ok: true, stopped: 0 })
    const batchUrl = new URL('/api/image-acts/act1/batch', studio.url)
    expect(await (await fetch(batchUrl)).json()).toMatchObject({
      total: 4,
      images: ['inn'],
      running: false,
    })
    expect(await (await send('POST', '/api/image-acts/act1/batch/close')).json()).toEqual({
      ok: true,
    })
    expect(await (await fetch(batchUrl)).json()).toBeNull()
  })

  it('answers 409 when images cannot be made at all', async () => {
    const none = startServer({
      projectFile: join(root, 'content-studio.json'),
      port: 0,
      transcriber: null,
      images: {
        ready: () => ({
          ok: false,
          reason: 'mflux',
          message: 'mflux is not on the PATH',
          fix: 'x',
        }),
        installed: () => true,
        generate: async () => {
          throw new Error('unused')
        },
      },
    })
    try {
      const answer = await fetch(new URL('/api/image-acts/act1/make-all', none.url), {
        method: 'POST',
        headers: { origin: none.url.origin },
      })
      expect(answer.status).toBe(409)
      expect(await answer.json()).toEqual({
        ok: false,
        message: "Images can't be made yet. Setup says what is missing.",
      })
    } finally {
      none.stop(true)
    }
  })

  it('refuses a bad body and answers 404 for an image the game does not list', async () => {
    expect((await send('POST', '/api/images/inn/takes', { count: 11 })).status).toBe(400)
    expect((await send('POST', '/api/images/inn/takes', { count: 0 })).status).toBe(400)
    expect((await send('POST', '/api/images/inn/choose', { n: 'x' })).status).toBe(400)
    expect((await send('POST', '/api/images/ghost/takes', { count: 1 })).status).toBe(404)
    expect((await fetch(new URL('/api/images/ghost/takes', studio.url))).status).toBe(404)
  })
})

describe('the image fine-tune routes', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/images',
        manifest: 'web/images/manifest.json',
      },
    }),
    'tts/act1/images.json': [
      { id: 'inn', title: 'Inn', text: 'a low inn', width: 320, height: 200 },
    ],
    'content-studio/images/edits.json': {
      style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] },
      images: {},
    },
    'content-studio/images/lock.json': {
      inn: { take: 3, inputs: { text: 'a low inn', width: 320, height: 200 } },
    },
    'content-studio/cache/images/inn.json': {
      next: 4,
      takes: [
        {
          n: 3,
          seed: 1,
          model: 'black-forest-labs/FLUX.2-klein-4B',
          width: 256,
          height: 256,
          madeFrom: { words: 'a low inn', style: 'x', width: 320, height: 200 },
        },
      ],
    },
    'web/images/manifest.json': { inn: { file: 'inn.png', width: 320, height: 200 } },
  })
  mkdirSync(join(root, 'content-studio/cache/image-takes/inn'), { recursive: true })
  writeFileSync(join(root, 'content-studio/cache/image-takes/inn/3.png'), fakePng(256, 256, 1))
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    transcriber: null,
    images: {
      ready: () => ({ ok: true }),
      installed: () => true,
      generate: async (request) => ({
        png: fakePng(request.width, request.height, request.seed),
        seed: request.seed,
      }),
    },
  })
  afterAll(() => studio.stop(true))
  const send = (method: string, path: string, body?: unknown, origin = studio.url.origin) =>
    fetch(new URL(`/api/images/inn/fine-tunes${path}`, studio.url), {
      method,
      headers: { origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  it('takes changes from the studio’s own page only', async () => {
    for (const [method, path, body] of [
      ['POST', '', { count: 1, words: 'x', area: null }],
      ['POST', '/stop', undefined],
      ['POST', '/use', { n: 1 }],
      ['DELETE', '/1', undefined],
      ['POST', '/1/seen', undefined],
    ] as const) {
      expect((await send(method, path, body, 'https://evil.example')).status).toBe(403)
    }
  })

  it('refuses a bad body, and answers 404 for an image the game does not list', async () => {
    expect((await send('POST', '', { count: 11, words: 'x', area: null })).status).toBe(400)
    expect((await send('POST', '', { count: 1, words: ' ', area: null })).status).toBe(400)
    expect((await send('POST', '/use', { n: 'x' })).status).toBe(400)
    expect((await fetch(new URL('/api/images/ghost/fine-tunes', studio.url))).status).toBe(404)
    expect((await send('POST', '/use', { n: 1 })).status).toBe(409)
  })

  it('makes fine-tunes, serves their pictures, drops one, and uses another as a new take', async () => {
    expect((await send('POST', '', { count: 2, words: 'Add a cat', area: null })).status).toBe(200)
    let view = { making: [{}], tunes: [] as { n: number }[] }
    for (let i = 0; i < 200 && view.making.length; i++) {
      view = await (await send('GET', '')).json()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(view.tunes.map((t) => t.n)).toEqual([1, 2])
    const picture = await send('GET', '/1')
    expect(picture.status).toBe(200)
    expect((await picture.arrayBuffer()).byteLength).toBeGreaterThan(100)
    expect((await send('GET', '/9')).status).toBe(404)
    expect((await send('POST', '/1/seen')).status).toBe(200)
    expect((await send('DELETE', '/2')).status).toBe(200)
    expect((await send('DELETE', '/2')).status).toBe(409)
    const used = await send('POST', '/use', { n: 1 })
    expect(used.status).toBe(200)
    expect(await used.json()).toEqual({
      ok: true,
      take: 4,
      from: 3,
      carried: { areas: 0, patches: 0 },
    })
    expect(((await (await send('GET', '')).json()) as { tunes: unknown[] }).tunes).toEqual([])
    expect((await send('POST', '/stop')).status).toBe(200)
  })
})

describe('the image patch routes', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/images',
        manifest: 'web/images/manifest.json',
      },
    }),
    'tts/act1/images.json': [
      {
        id: 'inn',
        title: 'Inn',
        text: 'a low inn',
        width: 320,
        height: 200,
        patches: [{ id: 'door', title: 'The door', text: 'the door is gone' }],
      },
    ],
    'content-studio/images/lock.json': {
      inn: { take: 3, inputs: { text: 'a low inn', width: 320, height: 200 } },
    },
    'web/images/manifest.json': { inn: { file: 'inn.png', width: 320, height: 200 } },
  })
  mkdirSync(join(root, 'content-studio/cache/image-takes/inn'), { recursive: true })
  writeFileSync(join(root, 'content-studio/cache/image-takes/inn/3.png'), fakePng(256, 256, 1))
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    transcriber: null,
    images: {
      ready: () => ({ ok: true }),
      installed: () => true,
      generate: async (request) => ({
        png: fakePng(request.width, request.height, request.seed),
        seed: request.seed,
      }),
    },
  })
  afterAll(() => studio.stop(true))
  const send = (method: string, path: string, body?: unknown) =>
    fetch(new URL(`/api/images/inn/patches${path}`, studio.url), {
      method,
      headers: { origin: studio.url.origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const area = { x: 16, y: 16, width: 64, height: 64 }

  it('makes takes of a declared patch, serves their pictures, chooses one, drops another', async () => {
    expect((await send('POST', '/door/takes', { count: 2, area })).status).toBe(200)
    let view = { patches: [{ making: [{}], takes: [] as { n: number }[] }] }
    for (let i = 0; i < 200 && view.patches[0]!.making.length; i++) {
      view = await (await fetch(new URL('/api/images/inn/patches', studio.url))).json()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(view.patches[0]!.takes.map((t) => t.n)).toEqual([1, 2])
    const picture = await fetch(new URL('/api/images/inn/patches/door/takes/1', studio.url))
    expect(picture.status).toBe(200)
    expect((await picture.arrayBuffer()).byteLength).toBeGreaterThan(100)
    expect((await fetch(new URL('/api/images/inn/patches/door/takes/9', studio.url))).status).toBe(
      404,
    )
    const game = await fetch(new URL('/api/images/inn/patches/door/takes/1/game', studio.url))
    expect(game.status).toBe(200)
    expect((await game.arrayBuffer()).byteLength).toBeGreaterThan(50)
    expect(
      (await fetch(new URL('/api/images/inn/patches/door/takes/9/game', studio.url))).status,
    ).toBe(404)
    expect((await send('POST', '/door/takes/1/seen')).status).toBe(200)
    expect((await send('POST', '/door/choose', { n: 1 })).status).toBe(200)
    const refused = await send('DELETE', '/door/takes/1')
    expect(refused.status).toBe(409)
    expect((await send('DELETE', '/door/takes/2')).status).toBe(200)
    expect((await send('POST', '/door/unchoose')).status).toBe(200)
    expect((await send('POST', '/door/stop')).status).toBe(200)
  })

  it('refuses a bad body, and answers 404 for an image or patch the game does not list', async () => {
    expect((await send('POST', '/door/takes', { count: 9, area })).status).toBe(400)
    expect((await send('POST', '/door/choose', { n: 'x' })).status).toBe(400)
    expect((await send('POST', '/ghost/takes', { count: 1, area })).status).toBe(404)
    expect((await fetch(new URL('/api/images/nope/patches', studio.url))).status).toBe(404)
  })
})

describe('the image model routes', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/images',
        manifest: 'web/images/manifest.json',
      },
    }),
    'tts/act1/images.json': [
      { id: 'inn', title: 'Inn', text: 'a low inn', width: 320, height: 200 },
    ],
    'content-studio/images/edits.json': {
      style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] },
      images: {},
    },
  })
  const asked: string[] = []
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    transcriber: null,
    images: {
      ready: () => ({ ok: true }),
      installed: (model) => model !== 'klein',
      generate: async (request) => {
        asked.push(request.model)
        return { png: new TextEncoder().encode('png'), seed: request.seed }
      },
    },
  })
  afterAll(() => studio.stop(true))
  const at = (path: string) => new URL(path, studio.url)
  const send = (method: string, path: string, body: unknown, origin = studio.url.origin) =>
    fetch(at(path), {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('shows the main image model, which models are here, and what Setup says', async () => {
    const view = await (await fetch(at('/api/models'))).json()
    expect(view.images).toEqual({
      model: 'klein',
      states: {
        klein: { download: 'absent', failed: false },
        'z-image-turbo': { download: 'whole', failed: false },
        'qwen-image': { download: 'whole', failed: false },
      },
    })
    const setup = await (await fetch(at('/api/setup'))).json()
    expect(setup.checks.find((c: { id: string }) => c.id === 'imageModels')).toMatchObject({
      state: 'problem',
    })
  })

  it('makes takes with the model asked for, and starts an image on the one that is here', async () => {
    expect((await send('POST', '/api/images/inn/takes', { count: 1, model: 'klein' })).status).toBe(
      409,
    )
    expect((await send('POST', '/api/images/inn/takes', { count: 1, model: 'huge' })).status).toBe(
      400,
    )
    expect((await send('POST', '/api/images/inn/takes', { count: 1 })).status).toBe(200)
    for (let i = 0; i < 200 && !asked.length; i++) await new Promise((r) => setTimeout(r, 5))
    expect(asked).toEqual(['z-image-turbo'])
    const takes = await (await fetch(at('/api/images/inn/takes'))).json()
    expect(takes).toMatchObject({ projectModel: 'klein' })
  })

  it('saves the main model from its own page only, and the page then shows it', async () => {
    const body = { model: 'z-image-turbo', was: 'klein' }
    expect((await send('PUT', '/api/image-model', body, 'http://evil.test')).status).toBe(403)
    expect((await send('PUT', '/api/image-model', { model: 'klein' })).status).toBe(400)
    const saved = await send('PUT', '/api/image-model', body)
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect((await send('PUT', '/api/image-model', body)).status).toBe(409)
    const view = await (await fetch(at('/api/models'))).json()
    expect(view.images.model).toBe('z-image-turbo')
  })
})

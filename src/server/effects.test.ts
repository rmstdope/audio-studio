import { createFakeEffects } from '../services/effectsFake'
import { afterAll, describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { readWav, writeWav } from '../core/wav'
import { projectJson, tempRepo } from '../../test/helpers'
import { startServer } from './index'
import { encode, fish } from './test-support'

describe('server, the sound effects', () => {
  const list = JSON.stringify([{ id: 'coins', text: 'Coins spill', seconds: 0.5 }])
  const effectsRoot = tempRepo({
    'content-studio.json': projectJson({
      refresh: { shared: `printf '%s' '${list}' > tts/effects.json` },
      effects: {
        from: { shared: 'tts/effects.json' },
        clips: 'audio/effects',
        manifest: 'audio/effects/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/effects.json': [{ id: 'coins', text: 'Coins spill', seconds: 0.5 }],
  })
  const studio = startServer({
    projectFile: join(effectsRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => studio.stop(true))
  const send = (method: string, path: string, body?: unknown, origin = studio.url.origin) =>
    fetch(new URL(path, studio.url), {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('saves the main sound-effects model from its own page only, and the models page then shows it', async () => {
    const body = { model: 'open-1', was: 'small-sfx' }
    expect((await send('PUT', '/api/effect-model', body, 'https://evil.example')).status).toBe(403)
    expect((await send('PUT', '/api/effect-model', { model: 'open-1' })).status).toBe(400)
    const saved = await send('PUT', '/api/effect-model', body)
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect((await send('PUT', '/api/effect-model', body)).status).toBe(409)
    const view = await (await fetch(new URL('/api/models', studio.url))).json()
    expect(view.effects.model).toBe('open-1')
    expect(Object.keys(view.effects.states)).toEqual(['small-sfx', 'open-1'])
    await send('PUT', '/api/effect-model', { model: 'small-sfx', was: 'open-1' })
  })

  it('shows the effects in the project summary', async () => {
    const body = await (await fetch(new URL('/api/project', studio.url))).json()
    expect(body.summary.effects.rows.map((r: { id: string }) => r.id)).toEqual(['coins'])
  })

  it('refuses every change that does not come from the studio’s page', async () => {
    for (const [method, path, body] of [
      ['POST', '/api/effects/refresh', undefined],
      ['PATCH', '/api/effects/coins', { description: 'x' }],
      ['POST', '/api/effects/coins/keep-mine', undefined],
      ['POST', '/api/effects/coins/forget', undefined],
    ] as const) {
      expect((await send(method, path, body, 'https://evil.example')).status).toBe(403)
    }
  })

  it('saves a description, and answers 404 for an effect the game does not list', async () => {
    const saved = await send('PATCH', '/api/effects/coins', { description: 'Coins on glass' })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ ok: true })
    const body = await (await fetch(new URL('/api/project', studio.url))).json()
    expect(body.summary.effects.rows[0]).toMatchObject({
      description: 'Coins on glass',
      changedHere: true,
    })
    expect((await send('PATCH', '/api/effects/nope', { description: 'x' })).status).toBe(404)
    expect((await send('PATCH', '/api/effects/coins', { nonsense: 1 })).status).toBe(400)
  })

  it('keeps mine and forgets', async () => {
    expect((await send('POST', '/api/effects/coins/keep-mine')).status).toBe(200)
    expect((await send('POST', '/api/effects/coins/forget')).status).toBe(404)
    expect((await send('POST', '/api/effects/nope/keep-mine')).status).toBe(404)
  })

  it('refreshes the list from the studio’s own page', async () => {
    const answer = await send('POST', '/api/effects/refresh')
    expect(answer.status).toBe(200)
    expect(await answer.json()).toMatchObject({ ok: true, effects: 1 })
  })
})

describe('server, sound effect takes', () => {
  const effectsPaths = {
    from: { shared: 'tts/effects.json' },
    clips: 'audio/effects',
    manifest: 'audio/effects/manifest.json',
  }
  const effectsRoot = tempRepo({
    'content-studio.json': projectJson({ effects: effectsPaths }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/effects.json': [
      { id: 'coins', text: 'Coins spill on stone', seconds: 0.5 },
      { id: 'door-creak', text: 'A door creaks', seconds: 3 },
      { id: 'wind', text: 'Wind howls', seconds: 6, loops: true },
    ],
  })
  const studio = startServer({
    projectFile: join(effectsRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    effects: createFakeEffects(5),
  })
  afterAll(() => studio.stop(true))
  const send = (method: string, path: string, body?: unknown, origin = studio.url.origin) =>
    fetch(new URL(path, studio.url), {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const view = async (id: string) =>
    (await fetch(new URL(`/api/effects/${id}/takes`, studio.url))).json()
  const settled = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const v = await view(id)
      if (!v.making.length) return v
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('never finished')
  }

  it('refuses every change that does not come from the studio’s page', async () => {
    for (const [method, path, body] of [
      ['POST', '/api/effects/coins/takes', { count: 1 }],
      ['DELETE', '/api/effects/coins/takes/0123456789abcdef.1.wav', undefined],
      ['POST', '/api/effects/coins/choose', { file: 'x' }],
      ['POST', '/api/effects/coins/unchoose', undefined],
      ['POST', '/api/effects/coins/accept', undefined],
      ['POST', '/api/effects/coins/stop', undefined],
    ] as const) {
      expect((await send(method, path, body, 'https://evil.example')).status).toBe(403)
    }
  })

  it('rejects a request that is not { count } or { retry }, and answers 404 for an unknown effect', async () => {
    expect((await send('POST', '/api/effects/coins/takes', { count: 9 })).status).toBe(400)
    expect((await send('POST', '/api/effects/coins/takes', { count: 1, model: 'x' })).status).toBe(
      400,
    )
    expect((await send('POST', '/api/effects/coins/choose', {})).status).toBe(400)
    expect((await send('POST', '/api/effects/nope/takes', { count: 1 })).status).toBe(404)
    expect((await fetch(new URL('/api/effects/nope/takes', studio.url))).status).toBe(404)
  })

  it('makes takes, plays them, chooses one and serves its clip; the summary says chosen', async () => {
    expect((await send('POST', '/api/effects/coins/takes', { count: 2 })).status).toBe(200)
    expect(
      Object.keys(await (await fetch(new URL('/api/effects/making', studio.url))).json()),
    ).toEqual(['coins'])
    const made = await settled('coins')
    expect(made.takes.map((t: { n: number }) => t.n)).toEqual([1, 2])
    const wav = await fetch(new URL(`/api/effects/coins/takes/${made.takes[0].file}`, studio.url))
    expect(wav.status).toBe(200)
    expect(
      (await send('POST', '/api/effects/coins/choose', { file: made.takes[0].file })).status,
    ).toBe(200)
    const project = await (await fetch(new URL('/api/project', studio.url))).json()
    expect(project.summary.effects.rows[0]).toMatchObject({ id: 'coins', status: 'chosen' })
    expect((await fetch(new URL('/api/effects/clips/coins.mp3', studio.url))).status).toBe(200)
    expect((await fetch(new URL('/api/effects/coins/current', studio.url))).status).toBe(200)
    expect((await fetch(new URL('/api/effects/door-creak/current', studio.url))).status).toBe(404)
    // Only plain clips are served: not the manifest, not hidden or nested names.
    expect((await fetch(new URL('/api/effects/clips/manifest.json', studio.url))).status).toBe(404)
    expect((await fetch(new URL('/api/effects/clips/.coins.mp3', studio.url))).status).toBe(404)
  })

  it('saves and removes the fades of a one-shot take from the studio’s own page only, and shows them on the take', async () => {
    await send('POST', '/api/effects/door-creak/takes', { count: 1 })
    const made = await settled('door-creak')
    const file = made.takes[0].file as string
    const path = `/api/effects/door-creak/takes/${file}/fades`
    const fades = { in: 0.1, out: 0.2, shape: 'straight' }
    expect((await send('PUT', path, fades, 'https://evil.example')).status).toBe(403)
    expect((await send('DELETE', path, undefined, 'https://evil.example')).status).toBe(403)
    expect((await send('PUT', path, { in: -1, out: 0, shape: 'smooth' })).status).toBe(400)
    expect((await send('PUT', path, { in: 'x' })).status).toBe(400)
    expect((await send('PUT', `/api/effects/nobody/takes/${file}/fades`, fades)).status).toBe(404)
    expect((await send('PUT', path, { in: 50, out: 50, shape: 'smooth' })).status).toBe(409)
    expect(await send('PUT', path, fades).then((r) => r.json())).toEqual({ ok: true })
    expect((await view('door-creak')).takes[0].fades).toEqual(fades)
    expect(await send('DELETE', path).then((r) => r.json())).toEqual({ ok: true })
    expect((await view('door-creak')).takes[0].fades).toBeUndefined()
  })

  it('refuses fades on a take of an effect that loops', async () => {
    await send('POST', '/api/effects/wind/takes', { count: 1 })
    const file = (await settled('wind')).takes[0].file as string
    const answer = await send('PUT', `/api/effects/wind/takes/${file}/fades`, {
      in: 0.1,
      out: 0.1,
      shape: 'smooth',
    })
    expect(answer.status).toBe(409)
    expect(await answer.json()).toEqual({
      ok: false,
      message: 'Only a sound that plays once can fade.',
    })
  })

  it('serves a take with the fades asked for in the address, to hear them before saving', async () => {
    await send('POST', '/api/effects/coins/takes', { count: 1 })
    const file = (await settled('coins')).takes[0].file as string
    const url = `/api/effects/coins/takes/${file}`
    const faded = readWav(
      new Uint8Array(
        await (
          await fetch(new URL(`${url}?fadeIn=0.1&fadeOut=0.1&shape=straight`, studio.url))
        ).arrayBuffer(),
      ),
    )
    const samples = new Int16Array(faded.data.buffer, faded.data.byteOffset, faded.data.length / 2)
    expect(samples[0]).toBe(0)
    expect(samples[samples.length - 1]).toBe(0)
    expect(
      (await fetch(new URL(`${url}?fadeIn=-1&fadeOut=1&shape=straight`, studio.url))).status,
    ).toBe(400)
  })

  it('refuses Make all and Stop all from another page, and a body that is not { ids }', async () => {
    for (const [path, body] of [
      ['/api/effects/make-all', { ids: ['coins'] }],
      ['/api/effects/stop-all', undefined],
      ['/api/effects/batch/close', undefined],
    ] as const) {
      expect((await send('POST', path, body, 'https://evil.example')).status).toBe(403)
    }
    expect((await send('POST', '/api/effects/make-all', {})).status).toBe(400)
    expect((await send('POST', '/api/effects/make-all', { ids: [1] })).status).toBe(400)
  })

  it('makes four takes for each listed effect, tells how it went, and stops them all', async () => {
    const models = await (await fetch(new URL('/api/effects/models', studio.url))).json()
    expect(models).toMatchObject({ ok: true, canMake: true, projectModel: 'small-sfx' })
    expect((await fetch(new URL('/api/effects/batch', studio.url))).status).toBe(200)
    const answer = await send('POST', '/api/effects/make-all', { ids: ['door-creak'] })
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ ok: true, started: [{ id: 'door-creak', takes: 4 }] })
    const stopped = await (await send('POST', '/api/effects/stop-all')).json()
    expect(stopped.ok).toBe(true)
    const batch = await (await fetch(new URL('/api/effects/batch', studio.url))).json()
    expect(batch).toMatchObject({ total: 4, running: false })
    expect(batch.made + batch.stopped + batch.failed.length).toBe(4)
    // Close clears it for every caller.
    expect(await (await send('POST', '/api/effects/batch/close')).json()).toEqual({ ok: true })
    expect(await (await fetch(new URL('/api/effects/batch', studio.url))).json()).toBeNull()
  })

  it('makes a looping take the length asked and serves its seam: the last 4 seconds, then the first 4', async () => {
    expect((await send('POST', '/api/effects/wind/takes', { count: 1 })).status).toBe(200)
    const made = await settled('wind')
    expect(made.takes[0]).toMatchObject({ loops: true, seconds: 6, quietAt: null })
    const seam = await fetch(
      new URL(`/api/effects/wind/takes/${made.takes[0].file}?seam=1`, studio.url),
    )
    expect(seam.status).toBe(200)
    expect(seam.headers.get('content-type')).toBe('audio/wav')
    const heard = readWav(new Uint8Array(await seam.arrayBuffer()))
    expect(heard.data.length / 2 / heard.format.sampleRate).toBe(8)
    const plain = await fetch(new URL(`/api/effects/wind/takes/${made.takes[0].file}`, studio.url))
    expect(readWav(new Uint8Array(await plain.arrayBuffer())).data.length / 2 / 8000).toBe(6)
    const project = await (await fetch(new URL('/api/project', studio.url))).json()
    expect(project.summary.effects.rows.find((r: { id: string }) => r.id === 'wind').loops).toBe(
      true,
    )
  })

  it('serves a one-shot take’s seam as well: the take twice over when shorter than 4 seconds', async () => {
    expect((await send('POST', '/api/effects/door-creak/takes', { count: 1 })).status).toBe(200)
    const made = await settled('door-creak')
    const url = `/api/effects/door-creak/takes/${made.takes[0].file}`
    const plain = readWav(
      new Uint8Array(await (await fetch(new URL(url, studio.url))).arrayBuffer()),
    )
    const seam = readWav(
      new Uint8Array(await (await fetch(new URL(`${url}?seam=1`, studio.url))).arrayBuffer()),
    )
    expect(seam.data.length).toBe(plain.data.length * 2)
  })

  it('refuses to drop the chosen take (409), drops another, and un-chooses', async () => {
    const v = await view('coins')
    const chosen = v.takes.find((t: { chosen: boolean }) => t.chosen)
    const other = v.takes.find((t: { chosen: boolean }) => !t.chosen)
    const refused = await send('DELETE', `/api/effects/coins/takes/${chosen.file}`)
    expect(refused.status).toBe(409)
    expect((await send('DELETE', `/api/effects/coins/takes/${other.file}`)).status).toBe(200)
    expect((await send('POST', '/api/effects/coins/unchoose')).status).toBe(200)
    expect((await send('POST', '/api/effects/coins/unchoose')).status).toBe(409)
    expect((await fetch(new URL('/api/effects/clips/coins.mp3', studio.url))).status).toBe(404)
  })

  it('stops a batch', async () => {
    await send('POST', '/api/effects/door-creak/takes', { count: 3 })
    const stopped = await send('POST', '/api/effects/door-creak/stop')
    expect(await stopped.json()).toEqual({ ok: true, stopped: 3 })
    expect((await view('door-creak')).making).toEqual([])
  })
})

describe('server, trimming a sound effect take', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      effects: {
        from: { shared: 'tts/effects.json' },
        clips: 'audio/effects',
        manifest: 'audio/effects/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/effects.json': [{ id: 'coins', text: 'Coins spill on stone', seconds: 2 }],
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    effects: {
      download: () => 'whole',
      ready: () => ({ ok: true }),
      async generate(request) {
        // A tenth of a second of near-silence, sound, a tenth of near-silence.
        const samples = new Int16Array(1000)
        samples.forEach((_, i) => {
          samples[i] = i < 100 || i >= 900 ? 20 : i % 2 ? 4000 : -4000
        })
        const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
        return {
          wav: writeWav({ format, data: new Uint8Array(samples.buffer) }),
          seed: request.seed,
        }
      },
      async close() {},
    },
  })
  afterAll(() => studio.stop(true))
  const at = (path: string) => new URL(path, studio.url)
  const post = (path: string, body: unknown, origin = studio.url.origin) =>
    fetch(at(path), {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('trims and untrims from the studio’s own page only, and plays only the part between the cuts', async () => {
    await post('/api/effects/coins/takes', { count: 1 })
    let view = await (await fetch(at('/api/effects/coins/takes'))).json()
    for (let i = 0; i < 300 && (view.making.length || !view.takes.length); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      view = await (await fetch(at('/api/effects/coins/takes'))).json()
    }
    const file = view.takes[0].file
    expect(view.takes[0].trimmable).toBe('cut')
    const path = '/api/effects/coins/trim'
    expect((await post(path, { file }, 'https://evil.example')).status).toBe(403)
    expect((await post(path, { nope: 1 })).status).toBe(400)
    expect((await post('/api/effects/nobody/trim', { file })).status).toBe(404)
    expect((await post(path, { file: '0123456789abcdef.9.wav' })).status).toBe(409)
    expect(await post(path, { file }).then((r) => r.json())).toEqual({ ok: true })
    const after = await (await fetch(at('/api/effects/coins/takes'))).json()
    expect(after.takes[0].trim.seconds).toBeCloseTo(0.82, 3)
    const base = `/api/effects/coins/takes/${file}`
    const whole = await (await fetch(at(base))).arrayBuffer()
    const part = await (await fetch(at(`${base}?trimmed=1`))).arrayBuffer()
    expect(part.byteLength).toBeLessThan(whole.byteLength)
    expect(await post(path, { file, undo: true }).then((r) => r.json())).toEqual({ ok: true })
    const undone = await (await fetch(at(`${base}?trimmed=1`))).arrayBuffer()
    expect(undone.byteLength).toBe(whole.byteLength)
  })
})

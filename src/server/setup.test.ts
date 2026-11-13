import { afterAll, describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { type FishClient } from '../services/fish'
import { startServer } from './index'
import { encode, fish } from './test-support'

describe('server, retiring models', () => {
  const project = projectJson()
  ;(project.narration as { models?: unknown }).models = { fish: { draft: 's1', final: 's1' } }
  const ownRoot = tempRepo({
    'content-studio.json': project,
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  })
  const server = startServer({
    projectFile: join(ownRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const patch = (body: unknown, origin: string | null = server.url.origin) =>
    fetch(new URL('/api/models', server.url), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    })

  it('switches the models from its own page, and the project then shows them', async () => {
    const takes = ['draft', 'final']
    expect((await patch({ takes }, 'http://evil.test')).status).toBe(403)
    expect((await patch({ takes: ['both'] })).status).toBe(400)
    expect((await patch({ takes: [] })).status).toBe(400)
    expect((await patch({ takes: ['draft', 'draft'] })).status).toBe(400)
    const saved = await patch({ takes })
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect((await patch({ takes })).status).toBe(409)
    const shown = await (await fetch(new URL('/api/project', server.url))).json()
    expect(shown.summary.models).toEqual({ draft: 's2.1-pro', final: 's2.1-pro' })
  })
})

describe('server, choosing the stages’ models', () => {
  const base = projectJson()
  ;(base.narration as Record<string, unknown>).models = {
    audition: 's2.1-pro-free',
    draft: 's2.1-pro-free',
    final: 's2.1-pro-free',
  }
  const modelsRoot = tempRepo({
    'content-studio.json': base,
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const slow: FishClient = {
    ...fish,
    async tts(request) {
      await gate
      return fish.tts(request)
    },
  }
  const modelServer = startServer({
    projectFile: join(modelsRoot, 'content-studio.json'),
    port: 0,
    fish: slow,
    encode,
    transcriber: null,
  })
  afterAll(() => modelServer.stop(true))
  const at = (path: string) => new URL(path, modelServer.url)
  const put = (stage: string, body: unknown, origin: string | null = modelServer.url.origin) =>
    fetch(at(`/api/models/${stage}`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    })

  it('shows the models, the dialog and nothing going on', async () => {
    const view = await (await fetch(at('/api/models'))).json()
    expect(view).toMatchObject({
      ok: true,
      file: 'content-studio.json',
      models: { draft: 's2.1-pro-free' },
      dialog: { lines: 1 },
      busy: null,
    })
  })

  it('saves a model from its own page only, and the plan then uses it', async () => {
    const body = { model: 's2.1-pro', was: 's2.1-pro-free' }
    expect((await put('draft', body, 'http://evil.test')).status).toBe(403)
    expect((await put('nope', body)).status).toBe(404)
    expect((await put('draft', { model: 's2.1-pro' })).status).toBe(400)
    const saved = await put('draft', body)
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect((await put('draft', body)).status).toBe(409)
    const plan = await (await fetch(at('/api/parts/act1/plan'))).json()
    expect(plan.plan.model).toBe('s2.1-pro')
    expect((await put('draft', { model: 'mystery', was: 's2.1-pro' })).status).toBe(409)
  })

  it('saves an ElevenLabs stage’s model from its own page only, and shows it', async () => {
    const putEleven = (stage: string, body: unknown, origin = modelServer.url.origin) =>
      fetch(at(`/api/models/elevenlabs/${stage}`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      })
    const body = { model: 'eleven_flash_v2_5', was: 'eleven_v3' }
    expect((await putEleven('draft', body, 'http://evil.test')).status).toBe(403)
    expect((await putEleven('nope', body)).status).toBe(404)
    expect((await putEleven('draft', { model: 's2-pro', was: 'eleven_v3' })).status).toBe(409)
    const saved = await putEleven('draft', body)
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    const view = await (await fetch(at('/api/models'))).json()
    expect(view.elevenlabs).toEqual({
      audition: 'eleven_v3',
      draft: 'eleven_flash_v2_5',
      final: 'eleven_v3',
    })
    expect(
      (await putEleven('draft', { model: 'eleven_v3', was: 'eleven_flash_v2_5' })).status,
    ).toBe(200)
    expect(
      (await putEleven('audition', { model: 'eleven_flash_v2_5', was: 'eleven_v3' })).status,
    ).toBe(200)
    expect((await (await fetch(at('/api/models'))).json()).elevenlabs.audition).toBe(
      'eleven_flash_v2_5',
    )
    expect(
      (await putEleven('audition', { model: 'eleven_v3', was: 'eleven_flash_v2_5' })).status,
    ).toBe(200)
  })

  it('saves ElevenLabs’ voice settings from its own page only, and shows them', async () => {
    const putTts = (body: unknown, origin = modelServer.url.origin) =>
      fetch(at('/api/elevenlabs/tts'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      })
    const was = { stability: 0.5, similarityBoost: 0.75, style: 0 }
    const tts = { stability: 1, similarityBoost: 0.4, style: 0.3 }
    expect((await putTts({ tts, was }, 'http://evil.test')).status).toBe(403)
    expect((await putTts({ tts })).status).toBe(400)
    expect((await putTts({ tts: { ...tts, style: 2 }, was })).status).toBe(409)
    const saved = await putTts({ tts, was })
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect((await putTts({ tts, was })).status).toBe(409)
    const view = await (await fetch(at('/api/models'))).json()
    expect(view.elevenTts).toEqual(tts)
    expect((await putTts({ tts: was, was: tts })).status).toBe(200)
  })

  it('refuses a change while a part is recording, and names it', async () => {
    expect((await put('draft', { model: 's2.1-pro-free', was: 's2.1-pro' })).status).toBe(200)
    const started = await fetch(at('/api/parts/act1/jobs'), {
      method: 'POST',
      headers: { origin: modelServer.url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ speaker: null, keys: ['a'], orphans: [] }),
    })
    expect(started.status).toBe(200)
    const view = await (await fetch(at('/api/models'))).json()
    expect(view.busy).toEqual({ kind: 'recording', name: 'Act I' })
    const refused = await put('final', { model: 'drama-3', was: 's2.1-pro-free' })
    expect(refused.status).toBe(409)
    const elevenRefused = await fetch(at('/api/models/elevenlabs/final'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: modelServer.url.origin },
      body: JSON.stringify({ model: 'eleven_flash_v2_5', was: 'eleven_v3' }),
    })
    expect(elevenRefused.status).toBe(409)
    expect(await elevenRefused.json()).toMatchObject({
      problems: [{ path: 'narration.models.elevenlabs.final', message: 'Act I is recording' }],
    })
    const ttsRefused = await fetch(at('/api/elevenlabs/tts'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: modelServer.url.origin },
      body: JSON.stringify({
        tts: { stability: 1, similarityBoost: 0.75, style: 0 },
        was: { stability: 0.5, similarityBoost: 0.75, style: 0 },
      }),
    })
    expect(ttsRefused.status).toBe(409)
    expect(await ttsRefused.json()).toMatchObject({
      problems: [{ path: 'narration.generate.elevenlabs', message: 'Act I is recording' }],
    })
    release()
  })
})

describe('server, models while a line or an audition take is going on', () => {
  const base = projectJson()
  const lineRoot = tempRepo({
    'content-studio.json': base,
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  let release: () => void = () => {}
  let gate = Promise.resolve()
  const arm = () => {
    gate = new Promise<void>((resolve) => (release = resolve))
  }
  const slow: FishClient = {
    ...fish,
    async tts(request) {
      await gate
      return fish.tts(request)
    },
  }
  const lineServer = startServer({
    projectFile: join(lineRoot, 'content-studio.json'),
    port: 0,
    fish: slow,
    encode,
    transcriber: null,
  })
  afterAll(() => lineServer.stop(true))
  const at = (path: string) => new URL(path, lineServer.url)
  const busy = async () => (await (await fetch(at('/api/models'))).json()).busy

  it('names the part while one line is recorded', async () => {
    arm()
    const own = { origin: lineServer.url.origin, 'content-type': 'application/json' }
    const recording = fetch(at('/api/parts/act1/lines/a/record'), {
      method: 'POST',
      headers: own,
      body: '{}',
    })
    for (let i = 0; i < 100 && !(await busy()); i++) await new Promise((r) => setTimeout(r, 10))
    expect(await busy()).toEqual({ kind: 'recording', name: 'Act I' })
    release()
    await recording
    expect(await busy()).toBeNull()
  })

  it('names the character while an audition take is recorded', async () => {
    arm()
    const own = { origin: lineServer.url.origin, 'content-type': 'application/json' }
    const taking = fetch(at('/api/characters/narrator/takes'), {
      method: 'POST',
      headers: own,
      body: JSON.stringify({ voice: 'w1' }),
    })
    for (let i = 0; i < 100 && !(await busy()); i++) await new Promise((r) => setTimeout(r, 10))
    expect(await busy()).toEqual({ kind: 'auditioning', name: 'Narrator' })
    release()
    await taking
    expect(await busy()).toBeNull()
  })
})

describe('server, paid auditions in two languages', () => {
  const base = projectJson()
  const root = tempRepo({
    'content-studio.json': {
      ...base,
      languages: ['en', 'sv'],
      narration: {
        ...(base.narration as object),
        models: { fish: { audition: 's2.1-pro' } },
        from: { part: 'tts/{part}/{language}/script.json' },
        clips: 'audio/{part}/{language}',
        manifest: 'audio/{part}/{language}/manifest.json',
        audition: { phrase: { sv: 'Kom in.' } },
      },
    },
    'content-studio/narration/cast.json': {
      speakers: { gran: { voice: 'cur', audition: { keywords: ['warm'] } } },
    },
    'tts/act1/en/script.json': [{ id: 'a', speaker: 'gran', text: 'Hello.' }],
    'tts/act1/sv/script.json': [{ id: 'a', speaker: 'gran', text: 'Hej.' }],
  })
  const server = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish: {
      ...fish,
      async credit() {
        return 5
      },
      async getVoice() {
        throw new Error('gone')
      },
    },
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const send = (method: string, path: string, body?: unknown) =>
    fetch(new URL(path, server.url), {
      method,
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const sitting = async (language: string) =>
    (await (await send('GET', `/api/auditions/gran/sitting?language=${language}`)).json()).sitting

  it('keeps a sitting for each language’s audition, so starting one leaves the other’s money', async () => {
    expect(
      (await send('POST', '/api/auditions/gran/start?language=en', { spendUpTo: 0.5 })).status,
    ).toBe(200)
    expect(
      (await send('POST', '/api/auditions/gran/start?language=sv', { spendUpTo: 0.2 })).status,
    ).toBe(200)
    expect((await sitting('en')).dollars).toBe(0.5)
    expect((await sitting('sv')).dollars).toBe(0.2)
    await send('DELETE', '/api/auditions/gran?language=sv')
    expect(await sitting('sv')).toBeNull()
    expect((await sitting('en')).dollars).toBe(0.5)
  })
})

describe('server, the Fish tier', () => {
  const ownRoot = tempRepo({
    'content-studio.json': projectJson(),
    '.env': 'FISH_AUDIO_API_KEY=k\n',
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  })
  const server = startServer({
    projectFile: join(ownRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    elevenlabs: null,
  })
  afterAll(() => server.stop(true))
  const patch = (body: unknown, origin: string | null = server.url.origin) =>
    fetch(new URL('/api/fish-tier', server.url), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    })
  const tierShown = async () => {
    const setup = await (await fetch(new URL('/api/setup', server.url))).json()
    return setup.checks.find((c: { id: string }) => c.id === 'requests')
  }

  it('saves the tier from its own page, and the setup then shows it', async () => {
    expect((await patch({ tier: '100' }, 'http://evil.test')).status).toBe(403)
    expect((await patch({ tier: '50' })).status).toBe(400)
    expect((await patch({})).status).toBe(400)
    const saved = await patch({ tier: '100' })
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect((await tierShown()).tier).toEqual({ chosen: '100' })
    expect((await patch({ tier: null })).status).toBe(200)
    expect((await tierShown()).tier).toEqual({ chosen: null })
  })
})

describe('server, the take fade', () => {
  const ownRoot = tempRepo({ 'content-studio.json': projectJson() })
  const server = startServer({
    projectFile: join(ownRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const patch = (body: unknown, origin: string | null = server.url.origin) =>
    fetch(new URL('/api/take-fade', server.url), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    })
  const shown = async () =>
    (await (await fetch(new URL('/api/project', server.url))).json()).summary.takeFade

  it('saves the length from its own page, and the project then shows it', async () => {
    expect(await shown()).toBe(0.2)
    expect((await patch({ seconds: 1 }, 'http://evil.test')).status).toBe(403)
    expect((await patch({ seconds: -1 })).status).toBe(400)
    expect((await patch({ seconds: 'long' })).status).toBe(400)
    expect((await patch({})).status).toBe(400)
    expect(await shown()).toBe(0.2)
    const saved = await patch({ seconds: 1 })
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect(await shown()).toBe(1)
    expect((await patch({ seconds: 0 })).status).toBe(200)
    expect(await shown()).toBe(0)
  })
})

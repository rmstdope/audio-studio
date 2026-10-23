import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeWav } from '../core/wav'
import { projectJson, tempRepo } from '../../test/helpers'
import type { FishClient } from '../services/fish'
import { allowedHosts, startServer } from './index'

const root = tempRepo({
  'audio-studio.json': projectJson(),
  'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
  'audio/act1/manifest.json': { a: { file: 'a.mp3' } },
  'audio/act1/a.mp3': 'ID3-not-really-audio',
})
const fish: FishClient = {
  async listVoices() {
    return {
      total: 1,
      items: [
        {
          id: 'w1',
          title: 'Warm',
          description: '',
          tags: [],
          languages: ['en'],
          uses: 1,
          likes: 0,
          author: '',
          sample: null,
        },
      ],
    }
  },
  async getVoice() {
    throw new Error('not used')
  },
  async tts(request) {
    if (request.format !== 'wav') return new Uint8Array([0x49, 0x44, 0x33])
    return writeWav({
      format: { channels: 1, sampleRate: 1000, bitsPerSample: 16 },
      data: new Uint8Array(2000),
    })
  },
}
/** An encoder that keeps the WAV, so the tests need no ffmpeg. */
const encode = async (wav: Uint8Array, file: string) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, wav)
}
const server = startServer({ projectFile: join(root, 'audio-studio.json'), port: 0, fish, encode })
afterAll(() => server.stop(true))

const url = (path: string) => new URL(path, server.url)
const post = (path: string, origin: string | null = server.url.origin) =>
  fetch(url(path), { method: 'POST', headers: origin ? { origin } : {} })

describe('server', () => {
  it('listens on localhost only', () => {
    expect(server.hostname).toBe('127.0.0.1')
  })

  it('serves the project summary', async () => {
    const body = await (await fetch(url('/api/project'))).json()
    expect(body.ok).toBe(true)
    expect(body.summary.name).toBe('Test Game')
  })

  it('serves a part with the state of its lines', async () => {
    const body = await (await fetch(url('/api/parts/act1'))).json()
    expect(body.part.lines[0]).toMatchObject({ key: 'a', status: 'untracked', file: 'a.mp3' })
  })

  it('answers an unknown part with 404', async () => {
    expect((await fetch(url('/api/parts/act9'))).status).toBe(404)
  })

  it('serves a clip, and nothing outside the clips folder', async () => {
    const clip = await fetch(url('/api/parts/act1/clips/a.mp3'))
    expect(await clip.text()).toBe('ID3-not-really-audio')
    expect((await fetch(url('/api/parts/act1/clips/manifest.jsonx'))).status).toBe(404)
    expect((await fetch(url('/api/parts/act1/clips/..%2Fmanifest.json'))).status).toBe(404)
  })

  it('refuses changes from another page', async () => {
    expect((await post('/api/parts/act1/adopt', 'https://evil.example')).status).toBe(403)
    expect((await post('/api/parts/act1/adopt', null)).status).toBe(403)
    expect(existsSync(join(root, 'tts/act1/narration.lock.json'))).toBe(false)
  })

  it('refuses requests for another host name (DNS rebinding)', async () => {
    const response = await fetch(url('/api/project'), {
      headers: { host: `evil.example:${server.port}` },
    })
    expect(response.status).toBe(403)
  })

  it('refuses another host name on every API route', async () => {
    for (const path of ['/api/parts/act1', '/api/parts/act1/clips/a.mp3', '/api/nothing']) {
      const response = await fetch(url(path), { headers: { host: `evil.example:${server.port}` } })
      expect(response.status).toBe(403)
    }
  })

  it('accepts localhost as well as 127.0.0.1', async () => {
    const response = await fetch(url('/api/project'), {
      headers: { host: `localhost:${server.port}` },
    })
    expect(response.status).toBe(200)
  })

  it('adopts a part’s clips', async () => {
    const response = await post('/api/parts/act1/adopt')
    expect(await response.json()).toMatchObject({ ok: true, adopted: 1 })
    expect(existsSync(join(root, 'tts/act1/narration.lock.json'))).toBe(true)
  })

  it('accepts changes from the page opened as localhost too', async () => {
    const response = await post('/api/parts/act1/adopt', `http://localhost:${server.port}`)
    expect(response.status).toBe(200)
  })

  it('saves a character’s keywords, from the studio’s own page only', async () => {
    const patch = (body: unknown, origin = server.url.origin) =>
      fetch(url('/api/characters/narrator'), {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await patch({ keywords: ['warm'] }, 'https://evil.example')).status).toBe(403)
    expect((await patch({ keywords: 'warm' })).status).toBe(400)
    expect((await patch({ keywords: ['warm'] })).status).toBe(200)
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.narrator.audition).toEqual({ keywords: ['warm'] })
  })

  it('finds candidates for a character with its keywords', async () => {
    const body = await (await fetch(url('/api/characters/narrator/candidates'))).json()
    expect(body).toMatchObject({ ok: true, keywords: ['warm'] })
    expect(body.candidates.map((c: { voice: { id: string } }) => c.voice.id)).toEqual(['w1'])
  })

  it('answers an unknown character with 404', async () => {
    expect((await fetch(url('/api/characters/nobody/candidates'))).status).toBe(404)
    const patch = await fetch(url('/api/characters/nobody'), {
      method: 'PATCH',
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ keywords: ['x'] }),
    })
    expect(patch.status).toBe(404)
  })

  it('saves a character’s own phrase', async () => {
    const response = await fetch(url('/api/characters/narrator'), {
      method: 'PATCH',
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ phrase: 'Once upon a time.' }),
    })
    expect(response.status).toBe(200)
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.narrator.audition.phrase).toBe('Once upon a time.')
  })

  it('records a take, from the studio’s own page only, and serves it', async () => {
    const record = (origin: string) =>
      fetch(url('/api/characters/narrator/takes'), {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ voice: 'w1' }),
      })
    expect((await record('https://evil.example')).status).toBe(403)
    const body = await (await record(server.url.origin)).json()
    expect(body).toMatchObject({ ok: true, cached: false })
    const take = await fetch(url(`/api/takes/${body.key}.mp3`))
    expect([...new Uint8Array(await take.arrayBuffer())]).toEqual([0x49, 0x44, 0x33])
    expect((await fetch(url('/api/takes/nope.mp3'))).status).toBe(404)
    expect((await fetch(url(`/api/takes/${body.key}`))).status).toBe(404)
    const audition = await (
      await fetch(url('/api/characters/narrator/audition?voices=w1,other'))
    ).json()
    expect(audition).toMatchObject({ ok: true, takes: { w1: body.key } })
  })

  it('runs an audition: start, verdicts, next round and cast', async () => {
    const post = (path: string, body?: unknown) =>
      fetch(url(path), {
        method: 'POST',
        headers: { origin: server.url.origin, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    expect(await (await fetch(url('/api/auditions/narrator'))).json()).toEqual({
      ok: true,
      session: null,
      audition: null,
      takes: {},
      recorded: [],
    })
    const started = await (await post('/api/auditions/narrator/start')).json()
    expect(started.session.pool).toEqual(['w1'])
    expect(started.audition.spoken).toContain('Once upon a time.')
    expect(
      (await post('/api/auditions/narrator/verdict', { voice: 'w1', verdict: 'maybe' })).status,
    ).toBe(400)
    const kept = await (
      await post('/api/auditions/narrator/verdict', { voice: 'w1', verdict: 'keep' })
    ).json()
    expect(kept.session.verdicts).toEqual({ w1: 'keep' })
    expect((await post('/api/auditions/narrator/next')).status).toBe(200)
    const cast = await (await post('/api/auditions/narrator/cast')).json()
    expect(cast).toMatchObject({ ok: true, voice: { id: 'w1', name: 'Warm' }, changed: true })
    const saved = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(saved.speakers.narrator).toMatchObject({ voice: 'w1', voiceName: 'Warm' })
    expect((await post('/api/auditions/narrator/cast')).status).toBe(409)
  })

  it('refuses every audition change from another page', async () => {
    const changes: [string, string][] = [
      ['DELETE', '/api/auditions/narrator'],
      ...['start', 'verdict', 'next', 'more', 'add', 'cast'].map((action): [string, string] => [
        'POST',
        `/api/auditions/narrator/${action}`,
      ]),
    ]
    for (const [method, path] of changes) {
      const response = await fetch(url(path), {
        method,
        headers: { origin: 'https://evil.example' },
      })
      expect([path, response.status]).toEqual([path, 403])
    }
  })

  it('answers ending the audition of an unknown character with 404', async () => {
    const response = await fetch(url('/api/auditions/nobody'), {
      method: 'DELETE',
      headers: { origin: server.url.origin },
    })
    expect(response.status).toBe(404)
  })

  it('records a line, from the studio’s own page only', async () => {
    const record = (origin: string) =>
      fetch(url('/api/parts/act1/lines/a/record'), { method: 'POST', headers: { origin } })
    expect((await record('https://evil.example')).status).toBe(403)
    const body = await (await record(server.url.origin)).json()
    expect(body).toEqual({ ok: true, key: 'a', duration: 1 })
    const part = await (await fetch(url('/api/parts/act1'))).json()
    expect(part.part.lines[0].status).toBe('ok')
    expect(
      (
        await fetch(url('/api/parts/act1/lines/nope/record'), {
          method: 'POST',
          headers: { origin: server.url.origin },
        })
      ).status,
    ).toBe(404)
  })

  it('serves the UI', async () => {
    expect(await (await fetch(server.url)).text()).toContain('<div id="root">')
  })

  it('answers unknown API routes with a JSON 404', async () => {
    const response = await fetch(url('/api/nothing'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not found' })
  })
})

describe('allowedHosts', () => {
  it('names both addresses with the port', () => {
    expect(allowedHosts(4801)).toEqual(['127.0.0.1:4801', 'localhost:4801'])
  })

  it('also takes them without the port on port 80, where browsers leave it out', () => {
    expect(allowedHosts(80)).toEqual(['127.0.0.1:80', 'localhost:80', '127.0.0.1', 'localhost'])
  })
})

describe('server, with problems', () => {
  const broken = tempRepo({
    'audio-studio.json': projectJson(),
    'tts/cast.json': '{ broken',
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const other = startServer({ projectFile: join(broken, 'audio-studio.json'), port: 0, fish: null })
  afterAll(() => other.stop(true))

  it('refuses to save keywords over a broken cast with 409', async () => {
    const response = await fetch(new URL('/api/characters/narrator', other.url), {
      method: 'PATCH',
      headers: { origin: other.url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ keywords: ['warm'] }),
    })
    expect(response.status).toBe(409)
    expect(readFileSync(join(broken, 'tts/cast.json'), 'utf8')).toBe('{ broken')
  })

  it('reports the broken cast when asked for candidates', async () => {
    const body = await (
      await fetch(new URL('/api/characters/narrator/candidates', other.url))
    ).json()
    expect(body.ok).toBe(false)
    expect(body.problems[0].file).toBe('tts/cast.json')
  })
})

describe('server, without an API key', () => {
  const keyless = tempRepo({
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const other = startServer({
    projectFile: join(keyless, 'audio-studio.json'),
    port: 0,
    fish: null,
  })
  afterAll(() => other.stop(true))

  it('says there is no API key', async () => {
    const body = await (
      await fetch(new URL('/api/characters/narrator/candidates', other.url))
    ).json()
    expect(body).toMatchObject({ ok: false, reason: 'no-key' })
  })
})

describe('server, generating a part', () => {
  const genRoot = tempRepo({
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [
      { key: 'a', speaker: 'narrator', text: 'Once.' },
      { key: 'b', speaker: 'narrator', text: 'Twice.' },
    ],
    'audio/act1/manifest.json': {
      old: { file: 'old.mp3', speaker: 'narrator', duration: 1, words: [] },
    },
    'audio/act1/old.mp3': 'old',
  })
  const gen = startServer({
    projectFile: join(genRoot, 'audio-studio.json'),
    port: 0,
    fish,
    encode,
  })
  afterAll(() => gen.stop(true))
  const at = (path: string) => new URL(path, gen.url)
  const own = { origin: gen.url.origin, 'content-type': 'application/json' }

  it('plans, runs a job to the end, and removes the agreed orphans', async () => {
    const planned = await (await fetch(at('/api/parts/act1/plan'))).json()
    expect(planned.plan).toMatchObject({ keys: ['a', 'b'], missing: 2, orphans: ['old'], cost: 0 })
    const started = await fetch(at('/api/parts/act1/jobs'), {
      method: 'POST',
      headers: own,
      body: JSON.stringify({
        speaker: null,
        keys: planned.plan.keys,
        orphans: planned.plan.orphans,
      }),
    })
    const job = await started.json()
    expect(job).toMatchObject({ status: 'running', total: 2 })
    let state = job
    while (state.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 10))
      state = await (await fetch(at(`/api/jobs/${job.id}`))).json()
    }
    expect(state).toMatchObject({ status: 'done', done: 2, failed: [], removed: 1 })
    expect((await (await fetch(at('/api/parts/act1/jobs/latest'))).json()).id).toBe(job.id)
    const part = await (await fetch(at('/api/parts/act1'))).json()
    expect(part.part.counts.ok).toBe(2)
    expect(part.part.orphans).toEqual([])
    expect(existsSync(join(genRoot, 'audio/act1/old.mp3'))).toBe(false)
  })

  it('has nothing to generate once everything is up to date', async () => {
    const response = await fetch(at('/api/parts/act1/jobs'), {
      method: 'POST',
      headers: own,
      body: JSON.stringify({ speaker: null, keys: ['a', 'b'], orphans: [] }),
    })
    expect(response.status).toBe(409)
  })

  it('refuses a body that is not a generation', async () => {
    for (const body of [
      { speaker: null, removeOrphans: true },
      { speaker: null, keys: [], orphans: [], extra: 1 },
    ]) {
      const response = await fetch(at('/api/parts/act1/jobs'), {
        method: 'POST',
        headers: own,
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
    }
  })

  it('takes jobs and cancels only from the studio’s own page', async () => {
    const evil = { origin: 'https://evil.example', 'content-type': 'application/json' }
    const start = await fetch(at('/api/parts/act1/jobs'), {
      method: 'POST',
      headers: evil,
      body: JSON.stringify({ speaker: null, keys: [], orphans: [] }),
    })
    expect(start.status).toBe(403)
    expect((await fetch(at('/api/jobs/x'), { method: 'DELETE', headers: evil })).status).toBe(403)
  })
})

describe('server, generating only what was shown', () => {
  const shownRoot = tempRepo({
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' }, mira: { voice: 'v2' } } },
    'tts/act1/script.json': [
      { key: 'a', speaker: 'narrator', text: 'Once.' },
      { key: 'b', speaker: 'mira', text: 'Twice.' },
    ],
    'audio/act1/manifest.json': {
      seen: { file: 'seen.mp3', speaker: 'mira', duration: 1, words: [] },
      unseen: { file: 'unseen.mp3', speaker: 'mira', duration: 1, words: [] },
    },
    'audio/act1/seen.mp3': 'x',
    'audio/act1/unseen.mp3': 'x',
  })
  const shown = startServer({
    projectFile: join(shownRoot, 'audio-studio.json'),
    port: 0,
    fish,
    encode,
  })
  afterAll(() => shown.stop(true))
  const at = (path: string) => new URL(path, shown.url)
  const own = { origin: shown.url.origin, 'content-type': 'application/json' }

  it('plans one speaker with ?speaker=', async () => {
    const answer = await (await fetch(at('/api/parts/act1/plan?speaker=mira'))).json()
    expect(answer.plan).toMatchObject({ keys: ['b'], orphans: ['seen', 'unseen'] })
  })

  it('records and removes only what the page showed, and runs one job per part', async () => {
    const start = (keys: string[], orphans: string[]) =>
      fetch(at('/api/parts/act1/jobs'), {
        method: 'POST',
        headers: own,
        body: JSON.stringify({ speaker: null, keys, orphans }),
      })
    const first = await (await start(['a'], ['seen'])).json()
    expect(first).toMatchObject({ total: 1 })
    expect((await start(['b'], [])).status).toBe(409)
    let state = first
    while (state.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 10))
      state = await (await fetch(at(`/api/jobs/${first.id}`))).json()
    }
    expect(state).toMatchObject({ status: 'done', removed: 1 })
    const part = await (await fetch(at('/api/parts/act1'))).json()
    expect(part.part.lines.map((l: { status: string }) => l.status)).toEqual(['ok', 'missing'])
    expect(existsSync(join(shownRoot, 'audio/act1/seen.mp3'))).toBe(false)
    expect(existsSync(join(shownRoot, 'audio/act1/unseen.mp3'))).toBe(true)
  })
})

import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  async tts() {
    return new Uint8Array([0x49, 0x44, 0x33])
  },
}
const server = startServer({ projectFile: join(root, 'audio-studio.json'), port: 0, fish })
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

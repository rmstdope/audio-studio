import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { allowedHosts, startServer } from './index'

const root = tempRepo({
  'audio-studio.json': projectJson(),
  'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
  'audio/act1/manifest.json': { a: { file: 'a.mp3' } },
  'audio/act1/a.mp3': 'ID3-not-really-audio',
})
const server = startServer({ projectFile: join(root, 'audio-studio.json'), port: 0 })
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

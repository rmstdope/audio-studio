import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeWav } from '../core/wav'
import { projectJson, tempRepo } from '../../test/helpers'
import { FishError, type FishClient } from '../services/fish'
import { createLimiter } from '../services/limit'
import { recordLine } from '../services/narration'
import { allowedHosts, startServer } from './index'

const root = tempRepo({
  'audio-studio.json': projectJson(),
  'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
  'audio/act1/manifest.json': { a: { file: 'a.mp3' } },
  'audio/act1/a.mp3': 'ID3-not-really-audio',
})
const fish: FishClient = {
  async listOwnVoices() {
    return []
  },
  createVoice: () => Promise.reject(new Error('not used')),
  designVoice: () => Promise.reject(new Error('not used')),
  async credit() {
    return 25
  },
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
const server = startServer({
  projectFile: join(root, 'audio-studio.json'),
  port: 0,
  fish,
  encode,
  transcriber: null,
})
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

  it('serves what Whisper heard of a line, and 404 for an unknown line', async () => {
    const body = await (await fetch(url('/api/parts/act1/lines/a/heard'))).json()
    expect(body).toEqual({ ok: true, heard: null })
    expect((await fetch(url('/api/parts/act1/lines/zz/heard'))).status).toBe(404)
    expect((await fetch(url('/api/parts/act9/lines/a/heard'))).status).toBe(404)
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

  it('gives a character’s cast voice, its take and the audition phrase', async () => {
    const body = await (await fetch(url('/api/characters/narrator/voice'))).json()
    expect(body).toMatchObject({ ok: true, take: null, language: 'en' })
    expect(body.audition.spoken).toBeString()
  })

  it('answers an unknown character with 404', async () => {
    expect((await fetch(url('/api/characters/nobody/voice'))).status).toBe(404)
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

  it('saves a character’s style, which marks its recorded lines stale', async () => {
    const response = await fetch(url('/api/characters/narrator'), {
      method: 'PATCH',
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ style: '[grave]' }),
    })
    expect(response.status).toBe(200)
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.narrator.style).toBe('[grave]')
  })

  it('saves a character’s own speed, within what Fish speaks at', async () => {
    const patch = (body: unknown) =>
      fetch(url('/api/characters/narrator'), {
        method: 'PATCH',
        headers: { origin: server.url.origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await patch({ speed: 3 })).status).toBe(400)
    expect((await patch({ speed: 1.2 })).status).toBe(200)
    let cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.narrator.speed).toBe(1.2)
    const summary = await (await fetch(url('/api/project'))).json()
    expect(summary.summary.characters.find((c: { id: string }) => c.id === 'narrator').speed).toBe(
      1.2,
    )
    expect((await patch({ speed: null })).status).toBe(200)
    cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect('speed' in cast.speakers.narrator).toBe(false)
  })

  it('refreshes a part’s dialog from the studio’s own page only, here with no command', async () => {
    const refresh = (origin: string) =>
      fetch(url('/api/parts/act1/refresh'), { method: 'POST', headers: { origin } })
    expect((await refresh('https://evil.example')).status).toBe(403)
    const answer = await refresh(server.url.origin)
    expect(answer.status).toBe(409)
    expect(await answer.json()).toMatchObject({ ok: false, reason: 'none' })
    expect(
      (
        await fetch(url('/api/parts/act9/refresh'), {
          method: 'POST',
          headers: { origin: server.url.origin },
        })
      ).status,
    ).toBe(404)
  })

  it('moves or removes an orphaned cue, from the studio’s own page only', async () => {
    writeFileSync(join(root, 'tts/act1/cues.json'), '{\n  "gone": "[sad]"\n}\n')
    const move = (to: string | null, origin = server.url.origin) =>
      fetch(url('/api/parts/act1/cues/gone/move'), {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ to }),
      })
    expect((await move('a', 'https://evil.example')).status).toBe(403)
    const part = await (await fetch(url('/api/parts/act1'))).json()
    expect(part.part.orphanCues).toEqual([{ key: 'gone', cue: '[sad]' }])
    expect((await move('a')).status).toBe(200)
    expect(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8')).toBe('{\n  "a": "[sad]"\n}\n')
    expect((await move(null)).status).toBe(404)
    writeFileSync(join(root, 'tts/act1/cues.json'), '{}\n')
  })

  it('checks the setup', async () => {
    const body = await (await fetch(url('/api/setup'))).json()
    expect(body.ok).toBe(true)
    const states = Object.fromEntries(
      body.checks.map((c: { id: string; state: string }) => [c.id, c.state]),
    )
    // No key in this fixture: Fish is not asked. The tools depend on the machine running the tests.
    expect(states).toMatchObject({ key: 'problem', fish: 'off', refresh: 'off' })
    expect(Object.keys(states)).toEqual(['ffmpeg', 'whisper', 'key', 'fish', 'requests', 'refresh'])
  })

  it('tells the account’s credit', async () => {
    expect(await (await fetch(url('/api/credit'))).json()).toEqual({ ok: true, credit: 25 })
  })

  it('says what git sees of the project, here no repository', async () => {
    const body = await (await fetch(url('/api/changes'))).json()
    expect(body).toMatchObject({ ok: false, reason: 'no-git' })
  })

  it('saves the pronunciation table, from the studio’s own page only', async () => {
    const patch = (body: unknown, origin = server.url.origin) =>
      fetch(url('/api/pronounce'), {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const table = { table: [['Eldoria', 'El-door-ia']], was: [] }
    expect((await patch(table, 'https://evil.example')).status).toBe(403)
    expect((await patch({ table: 'Eldoria' })).status).toBe(400)
    expect((await patch({ table: [['', 'El-door-ia']], was: [] })).status).toBe(409)
    expect((await patch(table)).status).toBe(200)
    const project = await (await fetch(url('/api/project'))).json()
    expect(project.summary.pronounce).toEqual([['Eldoria', 'El-door-ia']])
    expect((await patch(table)).status).toBe(409)
    expect((await patch({ table: [], was: [['Eldoria', 'El-door-ia']] })).status).toBe(200)
  })

  it('saves a line’s cue, from the studio’s own page only', async () => {
    const patch = (key: string, body: unknown, origin = server.url.origin) =>
      fetch(url(`/api/parts/act1/cues/${key}`), {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await patch('a', { cue: '[hushed]' }, 'https://evil.example')).status).toBe(403)
    expect((await patch('a', { cue: 3 })).status).toBe(400)
    expect((await patch('nope', { cue: '[hushed]' })).status).toBe(404)
    expect((await patch('a', { cue: '[hushed]' })).status).toBe(200)
    const part = await (await fetch(url('/api/parts/act1'))).json()
    expect(part.part.lines.find((l: { key: string }) => l.key === 'a')).toMatchObject({
      cue: '[hushed]',
      cueFrom: 'own',
      sourceCue: null,
    })
    expect((await patch('a', { cue: '' })).status).toBe(200)
    const after = await (await fetch(url('/api/parts/act1'))).json()
    expect(after.part.lines.find((l: { key: string }) => l.key === 'a').cueFrom).toBe('style')
  })

  it('tries a cue on a line, from the studio’s own page only, and serves the take', async () => {
    const tryCue = (key: string, body: unknown, origin = server.url.origin) =>
      fetch(url(`/api/parts/act1/lines/${key}/try`), {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await tryCue('a', { cue: '[hushed]' }, 'https://evil.example')).status).toBe(403)
    expect((await tryCue('a', { cue: 3 })).status).toBe(400)
    expect((await tryCue('nope', { cue: '[hushed]' })).status).toBe(404)
    expect(
      (
        await fetch(url('/api/parts/act9/lines/a/try'), {
          method: 'POST',
          headers: { origin: server.url.origin, 'content-type': 'application/json' },
          body: '{"cue":""}',
        })
      ).status,
    ).toBe(404)
    const response = await tryCue('a', { cue: '[hushed]' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, spoken: '[hushed] Once.', cached: false })
    const take = await fetch(url(`/api/takes/${body.key}.mp3`))
    expect([...new Uint8Array(await take.arrayBuffer())]).toEqual([0x49, 0x44, 0x33])
  })

  it('keeps a note on a line, from the studio’s own page only', async () => {
    const patch = (key: string, body: unknown, origin = server.url.origin) =>
      fetch(url(`/api/parts/act1/lines/${key}/note`), {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await patch('a', { note: 'x' }, 'https://evil.example')).status).toBe(403)
    expect((await patch('a', { note: 3 })).status).toBe(400)
    expect((await patch('nope', { note: 'x' })).status).toBe(404)
    expect((await patch('a', { note: 'too fast' })).status).toBe(200)
    const part = await (await fetch(url('/api/parts/act1'))).json()
    expect(part.part.notes).toEqual({ a: 'too fast' })
    expect((await patch('a', { note: '' })).status).toBe(200)
    const after = await (await fetch(url('/api/parts/act1'))).json()
    expect(after.part.notes).toEqual({})
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
  })

  it('rules out a dropped voice, lists it, and allows one or all again', async () => {
    const send = (method: string, path: string, body?: unknown) =>
      fetch(url(path), {
        method,
        headers: { origin: server.url.origin, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const listed = async () => await (await fetch(url('/api/characters/narrator/ruled-out'))).json()
    expect(await listed()).toEqual({ ok: true, voices: [] })
    await send('POST', '/api/auditions/narrator/start')
    await send('POST', '/api/auditions/narrator/move', { voice: 'w1', move: 'drop' })
    expect(await listed()).toMatchObject({ ok: true, voices: [{ id: 'w1', title: 'Warm' }] })
    const one = await send('DELETE', '/api/characters/narrator/ruled-out/w1')
    expect(await one.json()).toEqual({ ok: true, voices: [] })
    await send('POST', '/api/auditions/narrator/undo')
    await send('POST', '/api/auditions/narrator/move', { voice: 'w1', move: 'drop' })
    const all = await send('DELETE', '/api/characters/narrator/ruled-out')
    expect(await all.json()).toEqual({ ok: true, voices: [] })
    await send('DELETE', '/api/auditions/narrator')
    expect((await fetch(url('/api/characters/nobody/ruled-out'))).status).toBe(404)
    expect((await send('DELETE', '/api/characters/nobody/ruled-out/w1')).status).toBe(404)
    expect((await send('DELETE', '/api/characters/narrator/ruled-out/not%20an%20id')).status).toBe(
      400,
    )
    for (const path of [
      '/api/characters/narrator/ruled-out',
      '/api/characters/narrator/ruled-out/w1',
    ]) {
      const response = await fetch(url(path), {
        method: 'DELETE',
        headers: { origin: 'https://evil.example' },
      })
      expect([path, response.status]).toEqual([path, 403])
    }
  })

  it('runs an audition: start, shortlist, drop and undo, and cast', async () => {
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
    const own = await (await post('/api/auditions/narrator/own')).json()
    expect(own).toMatchObject({ ok: true, session: { yours: [], mine: [] } })
    expect(started.session.toHear).toEqual(['w1'])
    expect(started.audition.spoken).toContain('Once upon a time.')
    for (const body of [
      { voice: 'w1', move: 'keep' },
      { move: 'drop' },
      { voice: '../x', move: 'drop' },
    ]) {
      expect((await post('/api/auditions/narrator/move', body)).status).toBe(400)
    }
    const dropped = await (
      await post('/api/auditions/narrator/move', { voice: 'w1', move: 'drop' })
    ).json()
    expect(dropped.session.dropped).toEqual([{ id: 'w1', from: 'toHear' }])
    expect(dropped.recorded).toBeUndefined()
    await post('/api/auditions/narrator/undo')
    expect((await post('/api/auditions/narrator/cast', { voice: 'w1' })).status).toBe(409)
    const listed = await (
      await post('/api/auditions/narrator/move', { voice: 'w1', move: 'shortlist' })
    ).json()
    // The cast voice (one Fish cannot look up here) starts on the shortlist.
    expect(listed.session.shortlist).toEqual(['v1', 'w1'])
    expect((await post('/api/auditions/narrator/cast')).status).toBe(400)
    expect((await post('/api/auditions/narrator/cast', { voice: 'not an id' })).status).toBe(400)
    const cast = await (await post('/api/auditions/narrator/cast', { voice: 'w1' })).json()
    expect(cast).toMatchObject({ ok: true, voice: { id: 'w1', name: 'Warm' }, changed: true })
    const saved = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(saved.speakers.narrator).toMatchObject({ voice: 'w1', voiceName: 'Warm' })
    expect((await post('/api/auditions/narrator/cast', { voice: 'w1' })).status).toBe(409)
  })

  it('refuses every audition change from another page', async () => {
    const changes: [string, string][] = [
      ['DELETE', '/api/auditions/narrator'],
      ...['start', 'move', 'undo', 'more', 'add', 'cast', 'own'].map((action): [string, string] => [
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

  it('takes a line again into the cache, serves the take, uses it as the clip, and drops it', async () => {
    const takes = url('/api/parts/act1/lines/a/takes')
    const own = { origin: server.url.origin }
    expect(
      (await fetch(takes, { method: 'POST', headers: { origin: 'https://evil.example' } })).status,
    ).toBe(403)
    const made = await (await fetch(takes, { method: 'POST', headers: own })).json()
    expect(made).toMatchObject({ ok: true, take: { current: true, heard: null } })
    const listed = await (await fetch(takes)).json()
    expect(listed.takes.map((t: { id: string }) => t.id)).toEqual([made.take.id])
    const wav = await fetch(url(`/api/parts/act1/lines/a/takes/${made.take.id}.wav`))
    expect(wav.status).toBe(200)
    expect((await fetch(url('/api/parts/act1/lines/a/takes/nope.wav'))).status).toBe(404)
    const used = await fetch(url(`/api/parts/act1/lines/a/takes/${made.take.id}/use`), {
      method: 'POST',
      headers: own,
    })
    expect(await used.json()).toMatchObject({ ok: true, key: 'a', duration: 1 })
    const dropped = await fetch(url(`/api/parts/act1/lines/a/takes/${made.take.id}`), {
      method: 'DELETE',
      headers: own,
    })
    expect(dropped.status).toBe(200)
    expect((await fetch(url('/api/parts/act1/lines/nope/takes'))).status).toBe(404)
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

describe('server, accepting a weak line', () => {
  const weakRoot = tempRepo({
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [
      { key: 'a', speaker: 'narrator', text: 'Once upon a time.' },
      { key: 'b', speaker: 'narrator', text: 'Twice.' },
    ],
  })
  const projectFile = join(weakRoot, 'audio-studio.json')
  const halfHeard = {
    transcribe: async () => [{ start: 0, end: 0.9, words: [{ word: 'Once', start: 0, end: 0.3 }] }],
    close() {},
  }
  const server = startServer({ projectFile, port: 0, fish, encode, transcriber: halfHeard })
  afterAll(() => server.stop(true))
  const accept = (key: string, origin: string | null = server.url.origin) =>
    fetch(new URL(`/api/parts/act1/lines/${key}/accept`, server.url), {
      method: 'POST',
      headers: origin ? { origin } : {},
    })

  it('accepts a weak line from its own page only, and no other line', async () => {
    await recordLine(projectFile, 'act1', 'a', async () => fish, {
      encode,
      limiter: createLimiter(),
      transcriber: halfHeard,
    })
    expect((await accept('a', 'http://evil.test')).status).toBe(403)
    expect((await accept('b')).status).toBe(409)
    expect((await accept('nope')).status).toBe(404)
    const answer = await accept('a')
    expect([answer.status, await answer.json()]).toEqual([200, { ok: true, key: 'a' }])
    const part = await (await fetch(new URL('/api/parts/act1', server.url))).json()
    expect(part.part.lines[0]).toMatchObject({ status: 'ok', accepted: true })
  })
})

describe('server, words that sound the same', () => {
  const ownRoot = tempRepo({
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  })
  const server = startServer({
    projectFile: join(ownRoot, 'audio-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const patch = (body: unknown, origin: string | null = server.url.origin) =>
    fetch(new URL('/api/sound-alike', server.url), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    })

  it('saves the groups from its own page, and the project then lists them', async () => {
    const groups = [['Lyria', 'Liria']]
    expect((await patch({ groups, was: [] }, 'http://evil.test')).status).toBe(403)
    expect((await patch({ groups: 'Lyria' })).status).toBe(400)
    const saved = await patch({ groups, was: [] })
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect((await patch({ groups: [], was: [] })).status).toBe(409)
    const project = await (await fetch(new URL('/api/project', server.url))).json()
    expect(project.summary.soundAlike).toEqual(groups)
  })
})

describe('server, a character per language', () => {
  const base = projectJson()
  const languageRoot = tempRepo({
    'audio-studio.json': {
      ...base,
      narration: {
        ...(base.narration as object),
        languages: ['en', 'sv'],
        paths: {
          dialog: 'tts/{part}/{language}/script.json',
          cues: 'tts/{part}/{language}/cues.json',
          lock: 'tts/{part}/{language}/narration.lock.json',
          clips: 'audio/{part}/{language}',
          manifest: 'audio/{part}/{language}/manifest.json',
        },
        audition: { phrases: { sv: 'Kom in.' } },
      },
    },
    'tts/cast.json': { speakers: { narrator: { voice: 'w1', audition: { keywords: ['warm'] } } } },
    'tts/act1/en/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
    'tts/act1/sv/script.json': [{ key: 'a', speaker: 'narrator', text: 'En gång.' }],
  })
  const warm = {
    id: 'w1',
    title: 'Warm',
    description: '',
    tags: [],
    languages: ['en'],
    uses: 1,
    likes: 0,
    author: '',
    sample: null,
  }
  const asked: (string | undefined)[] = []
  const languageServer = startServer({
    projectFile: join(languageRoot, 'audio-studio.json'),
    port: 0,
    fish: {
      ...fish,
      async listVoices(query) {
        asked.push(query.language)
        return { total: 1, items: [{ ...warm, id: 'w2' }] }
      },
      async getVoice() {
        return warm
      },
    },
    encode,
    transcriber: null,
  })
  afterAll(() => languageServer.stop(true))
  const call = (method: string, path: string, body?: unknown) =>
    fetch(new URL(path, languageServer.url), {
      method,
      headers: { origin: languageServer.url.origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => r.json())

  it('keeps an audition for each language, the one asked for with ?language=', async () => {
    const started = await call('POST', '/api/auditions/narrator/start?language=sv')
    expect(started.session.shortlist).toEqual(['w1'])
    expect(started.audition).toMatchObject({ phrase: 'Kom in.', from: 'standard' })
    expect(asked).toEqual(['sv'])
    expect((await call('GET', '/api/auditions/narrator')).session).toBeNull()
    expect((await call('GET', '/api/auditions/narrator?language=sv')).session).not.toBeNull()
  })

  it('serves the voice cast in the language, and the ruled-out voices of it', async () => {
    expect((await call('GET', '/api/characters/narrator/voice?language=sv')).id).toBeNull()
    expect((await call('GET', '/api/characters/narrator/voice')).id).toBe('w1')
    await call('POST', '/api/auditions/narrator/move?language=sv', { voice: 'w2', move: 'drop' })
    expect(
      (await call('GET', '/api/characters/narrator/ruled-out?language=sv')).voices,
    ).toHaveLength(1)
    expect((await call('GET', '/api/characters/narrator/ruled-out')).voices).toHaveLength(0)
  })

  it('changes a character’s speed and casts a voice for the language only', async () => {
    await call('PATCH', '/api/characters/narrator?language=sv', { speed: 0.95 })
    await call('POST', '/api/auditions/narrator/move?language=sv', {
      voice: 'w1',
      move: 'shortlist',
    })
    const cast = await call('POST', '/api/auditions/narrator/cast?language=sv', { voice: 'w1' })
    expect(cast.ok).toBe(true)
    const saved = JSON.parse(readFileSync(join(languageRoot, 'tts/cast.json'), 'utf8'))
    expect(saved.speakers.narrator.languages.sv).toMatchObject({ voice: 'w1', speed: 0.95 })
    expect(saved.speakers.narrator.speed).toBeUndefined()
  })
})

describe('server, retiring models', () => {
  const project = projectJson()
  ;(project.narration as { models?: unknown }).models = { draft: 's1', final: 's1' }
  const ownRoot = tempRepo({
    'audio-studio.json': project,
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  })
  const server = startServer({
    projectFile: join(ownRoot, 'audio-studio.json'),
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
    'audio-studio.json': base,
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
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
    projectFile: join(modelsRoot, 'audio-studio.json'),
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
      file: 'audio-studio.json',
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
    release()
  })
})

describe('server, paid auditions in two languages', () => {
  const base = projectJson()
  const root = tempRepo({
    'audio-studio.json': {
      ...base,
      narration: {
        ...(base.narration as object),
        languages: ['en', 'sv'],
        models: { audition: 's2.1-pro' },
        paths: {
          dialog: 'tts/{part}/{language}/script.json',
          cues: 'tts/{part}/{language}/cues.json',
          lock: 'tts/{part}/{language}/narration.lock.json',
          clips: 'audio/{part}/{language}',
          manifest: 'audio/{part}/{language}/manifest.json',
        },
        audition: { phrases: { sv: 'Kom in.' } },
      },
    },
    'tts/cast.json': { speakers: { gran: { voice: 'cur', audition: { keywords: ['warm'] } } } },
    'tts/act1/en/script.json': [{ key: 'a', speaker: 'gran', text: 'Hello.' }],
    'tts/act1/sv/script.json': [{ key: 'a', speaker: 'gran', text: 'Hej.' }],
  })
  const server = startServer({
    projectFile: join(root, 'audio-studio.json'),
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
    'audio-studio.json': projectJson(),
    '.env': 'FISH_AUDIO_API_KEY=k\n',
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  })
  const server = startServer({
    projectFile: join(ownRoot, 'audio-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
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
  const other = startServer({
    projectFile: join(broken, 'audio-studio.json'),
    port: 0,
    fish: null,
    transcriber: null,
  })
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

  it('reports the broken cast when asked for the voice', async () => {
    const body = await (await fetch(new URL('/api/characters/narrator/voice', other.url))).json()
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
    transcriber: null,
  })
  afterAll(() => other.stop(true))

  it('says there is no API key', async () => {
    const started = await fetch(new URL('/api/auditions/narrator/start', other.url), {
      method: 'POST',
      headers: { origin: other.url.origin },
    })
    expect(await started.json()).toMatchObject({ ok: false, reason: 'no-key' })
    const voice = await (await fetch(new URL('/api/characters/narrator/voice', other.url))).json()
    expect(voice).toMatchObject({ ok: true, voice: null })
    expect(voice.lookup).toMatchObject({ reason: 'no-key' })
  })

  it('says when Fish cannot tell the credit', async () => {
    const down = startServer({
      projectFile: join(root, 'audio-studio.json'),
      port: 0,
      fish: {
        ...fish,
        credit: () => Promise.reject(new Error('Fish Audio answered 401: invalid key')),
      },
      transcriber: null,
    })
    try {
      const body = await (await fetch(new URL('/api/credit', down.url))).json()
      expect(body).toEqual({
        ok: false,
        reason: 'fish',
        message: 'Fish Audio answered 401: invalid key',
      })
    } finally {
      down.stop(true)
    }
  })

  it('has no credit to tell without a key', async () => {
    const body = await (await fetch(new URL('/api/credit', other.url))).json()
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
    transcriber: null,
  })
  afterAll(() => gen.stop(true))
  const at = (path: string) => new URL(path, gen.url)
  const own = { origin: gen.url.origin, 'content-type': 'application/json' }

  it('plans, runs a job to the end, and removes the agreed orphans', async () => {
    const planned = await (await fetch(at('/api/parts/act1/plan'))).json()
    expect(planned.plan).toMatchObject({
      keys: ['a', 'b'],
      missing: 2,
      orphans: ['old'],
      cost: 0,
      takes: 3,
      checked: true,
    })
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

describe('server, refreshing and generating', () => {
  const json = projectJson()
  ;(json.narration as Record<string, unknown>).refreshDialog = 'sleep 0.5'
  const busyRoot = tempRepo({
    'audio-studio.json': json,
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const slowFish: FishClient = {
    ...fish,
    async tts(...args) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return fish.tts(...args)
    },
  }
  const busy = startServer({
    projectFile: join(busyRoot, 'audio-studio.json'),
    port: 0,
    fish: slowFish,
    encode,
    transcriber: null,
  })
  afterAll(() => busy.stop(true))
  const at = (path: string) => new URL(path, busy.url)
  const own = { origin: busy.url.origin, 'content-type': 'application/json' }
  const generate = () =>
    fetch(at('/api/parts/act1/jobs'), {
      method: 'POST',
      headers: own,
      body: JSON.stringify({ speaker: null, keys: ['a'], orphans: [] }),
    })
  const refresh = () => fetch(at('/api/parts/act1/refresh'), { method: 'POST', headers: own })

  it('does not start a generation while the part is refreshing', async () => {
    const refreshing = refresh()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const answer = await generate()
    expect(answer.status).toBe(409)
    expect((await answer.json()).error).toContain('refresh')
    expect((await refreshing).status).toBe(200)
  })

  it('does not refresh while a generation runs on the part', async () => {
    expect((await generate()).status).toBe(200)
    const answer = await refresh()
    expect(answer.status).toBe(409)
    expect(await answer.json()).toMatchObject({ ok: false, reason: 'busy' })
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
    transcriber: null,
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

describe('server, takes not checked', () => {
  const plain = projectJson()
  ;(plain.narration as { quality?: unknown }).quality = { transcriber: 'none' }
  const plainRoot = tempRepo({
    'audio-studio.json': plain,
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const server = startServer({
    projectFile: join(plainRoot, 'audio-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))

  it('plans one unchecked take a line', async () => {
    const answer = await (await fetch(new URL('/api/parts/act1/plan', server.url))).json()
    expect(answer.plan).toMatchObject({ takes: 1, checked: false })
  })
})

describe.skipIf(!Bun.which('ffmpeg'))('server, measuring clips', () => {
  const measureRoot = tempRepo({
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once upon a time.' }],
  })
  const projectFile = join(measureRoot, 'audio-studio.json')
  /** Hears "Once upon" only, whatever the clip. */
  const halfHeard = {
    transcribe: async () => [
      {
        start: 0,
        end: 0.9,
        words: [
          { word: 'Once', start: 0, end: 0.3 },
          { word: 'upon', start: 0.3, end: 0.6 },
        ],
      },
    ],
    close() {},
  }
  const server = startServer({ projectFile, port: 0, fish, encode, transcriber: halfHeard })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }

  async function finish(id: string) {
    let state = await (await fetch(at(`/api/jobs/${id}`))).json()
    while (state.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 10))
      state = await (await fetch(at(`/api/jobs/${id}`))).json()
    }
    return state
  }

  it('measures a clip recorded unchecked, which then shows how well it is heard', async () => {
    const unchecked = await recordLine(projectFile, 'act1', 'a', async () => fish, {
      encode,
      limiter: createLimiter(),
    })
    expect(unchecked).toMatchObject({ ok: true })
    const planned = await (await fetch(at('/api/parts/act1/plan'))).json()
    expect(planned.plan.unmeasured).toEqual(['a'])
    const job = await (
      await fetch(at('/api/parts/act1/jobs'), {
        method: 'POST',
        headers: own,
        body: JSON.stringify({ kind: 'measure', speaker: null, keys: ['a'], orphans: [] }),
      })
    ).json()
    expect(job.kind).toBe('measure')
    expect(await finish(job.id)).toMatchObject({ status: 'done', failed: [] })
    const part = await (await fetch(at('/api/parts/act1'))).json()
    expect(part.part.lines[0]).toMatchObject({ status: 'weak', heard: 0.5 })
    const weak = await (await fetch(at('/api/parts/act1/plan?weak=1'))).json()
    expect(weak.plan).toMatchObject({ keys: ['a'], weak: ['a'], unmeasured: [] })
  })

  it('retakes a weak line only when the job says so', async () => {
    const recordJob = async (retakeWeak?: boolean) => {
      const started = await (
        await fetch(at('/api/parts/act1/jobs'), {
          method: 'POST',
          headers: own,
          body: JSON.stringify({ speaker: null, keys: ['a'], orphans: [], retakeWeak }),
        })
      ).json()
      return started.id ? finish(started.id) : started
    }
    expect(await recordJob()).toEqual({ error: 'There is nothing to do.' })
    expect(await recordJob(true)).toMatchObject({ status: 'done', done: 1, skipped: 0 })
  })

  it('checks the weak lines again in a job, without new audio', async () => {
    const planned = await (await fetch(at('/api/parts/act1/plan'))).json()
    expect(planned.plan.recheck).toEqual(['a'])
    const job = await (
      await fetch(at('/api/parts/act1/jobs'), {
        method: 'POST',
        headers: own,
        body: JSON.stringify({ kind: 'check', speaker: null, keys: ['a'], orphans: [] }),
      })
    ).json()
    expect(job.kind).toBe('check')
    expect(await finish(job.id)).toMatchObject({ status: 'done', done: 1, failed: [] })
    // Only the weak lines of the server's own plan are taken.
    const other = await fetch(at('/api/parts/act1/jobs'), {
      method: 'POST',
      headers: own,
      body: JSON.stringify({ kind: 'check', speaker: null, keys: ['b'], orphans: [] }),
    })
    expect([other.status, await other.json()]).toEqual([409, { error: 'There is nothing to do.' }])
  })

  it('checks a weak line again from its own page, and no line it cannot', async () => {
    const check = (key: string, origin = server.url.origin) =>
      fetch(at(`/api/parts/act1/lines/${key}/check`), { method: 'POST', headers: { origin } })
    expect((await check('a', 'http://evil.test')).status).toBe(403)
    expect((await check('nope')).status).toBe(404)
    const answer = await check('a')
    expect([answer.status, await answer.json()]).toEqual([
      200,
      { ok: true, key: 'a', heard: 0.5, duration: expect.any(Number) },
    ])
    // Accepted, the line is no longer weak, and is not checked again.
    await fetch(at('/api/parts/act1/lines/a/accept'), {
      method: 'POST',
      headers: { origin: server.url.origin },
    })
    expect((await check('a')).status).toBe(409)
  })
})

describe('server, a paid draft model', () => {
  const paid = projectJson({
    narration: { ...(projectJson().narration as object), models: { draft: 's2-pro' } },
  })
  const paidRoot = tempRepo({
    'audio-studio.json': paid,
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once upon a time.' }],
  })
  let credit = 10
  let spoken = 0
  const account: FishClient = {
    ...fish,
    createVoice: () => Promise.reject(new Error('not used')),
    designVoice: () => Promise.reject(new Error('not used')),
    async credit() {
      return credit
    },
    async tts(request) {
      spoken++
      return fish.tts(request)
    },
  }
  const server = startServer({
    projectFile: join(paidRoot, 'audio-studio.json'),
    port: 0,
    fish: account,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }
  const record = (confirmedCost?: number) =>
    fetch(at('/api/parts/act1/lines/a/record'), {
      method: 'POST',
      headers: own,
      body: JSON.stringify(confirmedCost === undefined ? {} : { confirmedCost }),
    })

  it('plans the cost, and the most it can cost', async () => {
    const { plan } = await (await fetch(at('/api/parts/act1/plan'))).json()
    expect(plan.cost).toBeGreaterThan(0)
    expect(plan.ceiling).toBeCloseTo(plan.cost * 3, 12)
  })

  it('records a line only once its cost is confirmed, saying what to confirm', async () => {
    const asked = await record()
    expect(asked.status).toBe(409)
    const body = await asked.json()
    expect(body).toMatchObject({ ok: false, reason: 'confirm' })
    expect(body.ceiling).toBeGreaterThan(0)
    expect(spoken).toBe(0)
    expect((await record(body.ceiling / 2)).status).toBe(409)
    expect(spoken).toBe(0)
    credit = body.ceiling / 2
    expect(await (await record(body.ceiling)).json()).toMatchObject({ ok: false, reason: 'credit' })
    expect(spoken).toBe(0)
    credit = 10
    expect(await (await record(body.ceiling)).json()).toMatchObject({ ok: true, key: 'a' })
    expect(spoken).toBeGreaterThan(0)
  })

  describe('an extra take', () => {
    const takes = () => at('/api/parts/act1/lines/a/takes')
    const takeAgain = (confirmedCost?: number) =>
      fetch(takes(), {
        method: 'POST',
        headers: own,
        body: confirmedCost === undefined ? undefined : JSON.stringify({ confirmedCost }),
      })

    it('is recorded only once its cost is confirmed, and priced for one take', async () => {
      credit = 10
      const before = spoken
      const asked = await takeAgain()
      expect(asked.status).toBe(409)
      const body = await asked.json()
      expect(body).toMatchObject({ ok: false, reason: 'confirm' })
      // 17 bytes of text at $15 per million: one take, not the three a recording is held to.
      expect(body.ceiling).toBeCloseTo((17 / 1_000_000) * 15, 12)
      const small = await takeAgain(body.ceiling / 2)
      expect(small.status).toBe(409)
      expect(await small.json()).toMatchObject({ ok: false, reason: 'confirm' })
      expect(spoken).toBe(before)
      credit = body.ceiling / 2
      expect(await (await takeAgain(body.ceiling)).json()).toMatchObject({
        ok: false,
        reason: 'credit',
      })
      expect(spoken).toBe(before)
      credit = 10
      expect(await (await takeAgain(body.ceiling)).json()).toMatchObject({
        ok: true,
        take: { current: true },
      })
      expect(spoken).toBe(before + 1)
      const listed = await (await fetch(takes())).json()
      expect(listed.takes).toHaveLength(1)
    })

    it('records nothing when the account’s credit is unknown', async () => {
      const before = spoken
      const was = account.credit
      account.credit = async () => {
        throw new Error('Fish is down')
      }
      try {
        const answer = await takeAgain(1)
        expect(answer.status).toBe(409)
        expect(await answer.json()).toMatchObject({
          ok: false,
          reason: 'credit',
          message: 'The account’s credit is unknown, so nothing is recorded.',
        })
        expect(spoken).toBe(before)
      } finally {
        account.credit = was
      }
    })

    it('answers a body it cannot read with 400', async () => {
      const bad = await fetch(takes(), { method: 'POST', headers: own, body: '{ not json' })
      expect(bad.status).toBe(400)
    })

    it('refuses a request from another page', async () => {
      const response = await fetch(takes(), {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      })
      expect(response.status).toBe(403)
    })
  })

  it('answers a body it cannot read with 400', async () => {
    const bad = await fetch(at('/api/parts/act1/lines/a/record'), {
      method: 'POST',
      headers: own,
      body: '{ not json',
    })
    expect(bad.status).toBe(400)
  })

  it('starts a paid job only for the cost confirmed', async () => {
    writeFileSync(
      join(paidRoot, 'tts/act1/script.json'),
      JSON.stringify([
        { key: 'a', speaker: 'narrator', text: 'Once upon a time.' },
        { key: 'b', speaker: 'narrator', text: 'There was a fox.' },
      ]),
    )
    const { plan } = await (await fetch(at('/api/parts/act1/plan'))).json()
    expect(plan.keys).toEqual(['b'])
    const start = (confirmedCost?: number) =>
      fetch(at('/api/parts/act1/jobs'), {
        method: 'POST',
        headers: own,
        body: JSON.stringify({ speaker: null, keys: ['b'], orphans: [], confirmedCost }),
      })
    const refused = await start()
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ reason: 'confirm' })
    expect((await start(plan.ceiling)).status).toBe(200)
  })
})

/** A promise and the function that settles it: lets a test hold a fake's call until it says so. */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { open, opened }
}

/** Waits until `check` holds, looking every few milliseconds; fails after two seconds. */
async function until(check: () => boolean) {
  const giveUp = Date.now() + 2000
  while (!check()) {
    if (Date.now() > giveUp) throw new Error('waited in vain')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('server, paid recording and what changes meanwhile', () => {
  const oneAtATime = { ...(projectJson().narration as object), quality: { parallel: 1 } }
  const freeProject = projectJson({ narration: oneAtATime })
  const paidProject = projectJson({ narration: { ...oneAtATime, models: { draft: 's2-pro' } } })
  const root = tempRepo({
    'audio-studio.json': freeProject,
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': ['a', 'b', 'c', 'd'].map((key) => ({
      key,
      speaker: 'narrator',
      text: `Line ${key}.`,
    })),
  })
  const projectFile = join(root, 'audio-studio.json')
  let credit = 10
  let creditGate: Promise<void> | null = null
  let creditCalls = 0
  /** Each request to Fish waits at its own gate, opened by the test. */
  const requests: { model: string; gate: ReturnType<typeof gate> }[] = []
  const held: FishClient = {
    ...fish,
    createVoice: () => Promise.reject(new Error('not used')),
    designVoice: () => Promise.reject(new Error('not used')),
    async credit() {
      creditCalls++
      if (creditGate) await creditGate
      return credit
    },
    async tts(request) {
      const waiting = gate()
      requests.push({ model: request.model, gate: waiting })
      await waiting.opened
      return fish.tts(request)
    },
  }
  const server = startServer({ projectFile, port: 0, fish: held, encode, transcriber: null })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }
  const post = (path: string, body: unknown) =>
    fetch(at(path), { method: 'POST', headers: own, body: JSON.stringify(body) })
  const jobState = async (id: string) => (await fetch(at(`/api/jobs/${id}`))).json()
  /** Opens every request's gate, now and as they come, until the job ends. */
  async function letThrough(id: string) {
    for (;;) {
      for (const request of requests) request.gate.open()
      const state = await jobState(id)
      if (state.status !== 'running' && state.status !== 'cancelling') return state
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  const ceilingOf = async (key: string) =>
    (await (await post(`/api/parts/act1/lines/${key}/record`, {})).json()).ceiling as number

  it('never sends a paid request in a job confirmed for the free model', async () => {
    const job = await (
      await post('/api/parts/act1/jobs', { speaker: null, keys: ['a', 'b', 'c', 'd'], orphans: [] })
    ).json()
    await until(() => requests.length === 1)
    writeFileSync(projectFile, JSON.stringify(paidProject))
    const state = await letThrough(job.id)
    expect(requests.map((r) => r.model)).toEqual(['s2.1-pro-free'])
    expect(state.failed).toHaveLength(3)
    expect(state.failed[0].message).toContain('s2-pro')
    requests.length = 0
  })

  it('refuses a line whose plan cannot be made, sending nothing', async () => {
    writeFileSync(join(root, 'tts/cast.json'), '{ broken')
    const answer = await post('/api/parts/act1/lines/a/record', {})
    expect(answer.status).toBe(409)
    expect((await answer.json()).problems).toBeDefined()
    expect(requests).toHaveLength(0)
    writeFileSync(
      join(root, 'tts/cast.json'),
      JSON.stringify({ speakers: { narrator: { voice: 'v1' } } }),
    )
  })

  it('refuses a paid job the credit does not cover', async () => {
    const { plan } = await (await fetch(at('/api/parts/act1/plan'))).json()
    credit = plan.ceiling / 2
    const answer = await post('/api/parts/act1/jobs', {
      speaker: null,
      keys: plan.keys,
      orphans: [],
      confirmedCost: plan.ceiling,
    })
    expect(answer.status).toBe(409)
    expect(await answer.json()).toMatchObject({ reason: 'credit' })
    credit = 10
  })

  it('holds back what a running recording may spend, while it runs', async () => {
    const [ca, cb] = [await ceilingOf('a'), await ceilingOf('b')]
    credit = ca + cb / 2
    const first = post('/api/parts/act1/lines/a/record', { confirmedCost: ca })
    await until(() => requests.length === 1)
    const second = await (
      await post('/api/parts/act1/lines/b/record', { confirmedCost: cb })
    ).json()
    expect(second).toMatchObject({ ok: false, reason: 'credit' })
    requests[0]!.gate.open()
    expect(await (await first).json()).toMatchObject({ ok: true })
    requests.length = 0
    credit = 10
  })

  it('lets two recordings asked for at once not both count on the same credit', async () => {
    const [cb, cc] = [await ceilingOf('b'), await ceilingOf('c')]
    credit = Math.max(cb, cc) * 1.5
    const slowCredit = gate()
    creditGate = slowCredit.opened
    const calls = creditCalls
    const both = [
      post('/api/parts/act1/lines/b/record', { confirmedCost: cb }),
      post('/api/parts/act1/lines/c/record', { confirmedCost: cc }),
    ]
    // Both are waiting for the credit before it comes: they are truly asked for at once.
    await until(() => creditCalls === calls + 2)
    slowCredit.open()
    creditGate = null
    // Let every request through as it comes, until both have answered.
    let settled = false
    const answering = Promise.all(both.map(async (answer) => (await answer).json())).finally(
      () => (settled = true),
    )
    while (!settled) {
      for (const request of requests) request.gate.open()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const answers = await answering
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1)
    expect(answers.filter((answer) => answer.reason === 'credit')).toHaveLength(1)
    requests.length = 0
    credit = 10
  })

  it('holds back nothing for a job that is refused, and frees a job’s credit when it ends', async () => {
    const { plan } = await (await fetch(at('/api/parts/act1/plan'))).json()
    credit = plan.ceiling * 1.5
    const job = await (
      await post('/api/parts/act1/jobs', {
        speaker: null,
        keys: plan.keys,
        orphans: [],
        confirmedCost: plan.ceiling,
      })
    ).json()
    expect(job.status).toBe('running')
    credit = plan.ceiling * 3
    const again = await post('/api/parts/act1/jobs', {
      speaker: null,
      keys: plan.keys,
      orphans: [],
      confirmedCost: plan.ceiling,
    })
    expect(again.status).toBe(409)
    await letThrough(job.id)
    requests.length = 0
    // Nothing is held back now: the whole credit is there for a line again.
    const line = await ceilingOf('a')
    credit = line
    const recorded = post('/api/parts/act1/lines/a/record', { confirmedCost: line })
    await until(() => requests.length === 1)
    requests[0]!.gate.open()
    expect(await (await recorded).json()).toMatchObject({ ok: true })
    requests.length = 0
    credit = 10
  })

  it('holds back all a running recording was given, not only what it has not spent yet', async () => {
    const [ca, cb] = [await ceilingOf('a'), await ceilingOf('b')]
    const first = post('/api/parts/act1/lines/a/record', { confirmedCost: ca })
    // Charged and sent, but not yet answered: its budget has less left than it was given.
    await until(() => requests.length === 1)
    credit = ca + cb - ca / 4
    const second = await (
      await post('/api/parts/act1/lines/b/record', { confirmedCost: cb })
    ).json()
    expect(second).toMatchObject({ ok: false, reason: 'credit' })
    requests[0]!.gate.open()
    await first
    requests.length = 0
    credit = 10
  })

  it('counts a recording that ended while the credit was being read', async () => {
    const [ca, cb] = [await ceilingOf('a'), await ceilingOf('b')]
    // A runs; B asks for the credit, which comes only after A has ended and given its budget
    // back: the credit read may still count A's money as there.
    credit = ca + cb / 2
    const first = post('/api/parts/act1/lines/a/record', { confirmedCost: ca })
    await until(() => requests.length === 1)
    const slowCredit = gate()
    creditGate = slowCredit.opened
    const calls = creditCalls
    const second = post('/api/parts/act1/lines/b/record', { confirmedCost: cb })
    await until(() => creditCalls === calls + 1)
    requests[0]!.gate.open()
    await first
    slowCredit.open()
    creditGate = null
    // Let any request through, so a wrong admission shows as a failure rather than a wait.
    let settled = false
    const answer = second.then((response) => response.json()).finally(() => (settled = true))
    while (!settled) {
      for (const request of requests) request.gate.open()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(await answer).toMatchObject({ ok: false, reason: 'credit' })
    requests.length = 0
    credit = 10
  })
})

describe('server, a paid job refused for a refresh', () => {
  const json = projectJson({
    narration: { ...(projectJson().narration as object), models: { draft: 's2-pro' } },
  })
  ;(json.narration as Record<string, unknown>).refreshDialog = 'sleep 1'
  const root = tempRepo({
    'audio-studio.json': json,
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once upon a time.' }],
  })
  let credit = 10
  const account: FishClient = {
    ...fish,
    createVoice: () => Promise.reject(new Error('not used')),
    designVoice: () => Promise.reject(new Error('not used')),
    async credit() {
      return credit
    },
  }
  const server = startServer({
    projectFile: join(root, 'audio-studio.json'),
    port: 0,
    fish: account,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }

  it('holds nothing back for it afterwards', async () => {
    const { plan } = await (await fetch(at('/api/parts/act1/plan'))).json()
    credit = plan.ceiling
    const refreshing = fetch(at('/api/parts/act1/refresh'), { method: 'POST', headers: own })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const refused = await fetch(at('/api/parts/act1/jobs'), {
      method: 'POST',
      headers: own,
      body: JSON.stringify({
        speaker: null,
        keys: ['a'],
        orphans: [],
        confirmedCost: plan.ceiling,
      }),
    })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toContain('refresh')
    await refreshing
    const line = await fetch(at('/api/parts/act1/lines/a/record'), {
      method: 'POST',
      headers: own,
      body: JSON.stringify({ confirmedCost: plan.ceiling }),
    })
    expect(await line.json()).toMatchObject({ ok: true, key: 'a' })
  })
})

describe('server, the final recording', () => {
  const withFinal = projectJson({
    narration: { ...(projectJson().narration as object), models: { final: 's2-pro' } },
  })
  const root = tempRepo({
    'audio-studio.json': withFinal,
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [
      { key: 'a', speaker: 'narrator', text: 'Once upon a time.' },
      { key: 'b', speaker: 'narrator', text: 'There was a fox.' },
    ],
  })
  const models: string[] = []
  const account: FishClient = {
    ...fish,
    createVoice: () => Promise.reject(new Error('not used')),
    designVoice: () => Promise.reject(new Error('not used')),
    async credit() {
      return 10
    },
    async tts(request) {
      models.push(request.model)
      return fish.tts(request)
    },
  }
  const server = startServer({
    projectFile: join(root, 'audio-studio.json'),
    port: 0,
    fish: account,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }
  const finish = async (id: string) => {
    let state = await (await fetch(at(`/api/jobs/${id}`))).json()
    while (state.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 10))
      state = await (await fetch(at(`/api/jobs/${id}`))).json()
    }
    return state
  }

  it('plans and records the final recording with the final model, each spend confirmed', async () => {
    // Drafted first, for free.
    const draft = await (await fetch(at('/api/parts/act1/plan'))).json()
    const drafted = await (
      await fetch(at('/api/parts/act1/jobs'), {
        method: 'POST',
        headers: own,
        body: JSON.stringify({ speaker: null, keys: draft.plan.keys, orphans: [] }),
      })
    ).json()
    await finish(drafted.id)
    expect(models.every((m) => m === 's2.1-pro-free')).toBe(true)

    const { plan } = await (await fetch(at('/api/parts/act1/plan?stage=final'))).json()
    expect(plan).toMatchObject({ final: true, model: 's2-pro', keys: ['a', 'b'] })
    expect(plan.ceiling).toBeGreaterThan(0)
    const start = (confirmedCost?: number) =>
      fetch(at('/api/parts/act1/jobs'), {
        method: 'POST',
        headers: own,
        body: JSON.stringify({
          stage: 'final',
          speaker: null,
          keys: plan.keys,
          orphans: [],
          confirmedCost,
        }),
      })
    expect(await (await start()).json()).toMatchObject({ reason: 'confirm' })
    const job = await (await start(plan.ceiling)).json()
    expect(await finish(job.id)).toMatchObject({ status: 'done', failed: [] })
    expect(models.filter((m) => m === 's2-pro')).toHaveLength(2)
    const part = await (await fetch(at('/api/parts/act1'))).json()
    expect(part.part.lines.map((l: { final: boolean }) => l.final)).toEqual([true, true])
    // The draft plan leaves final clips alone; the final plan has nothing left.
    expect((await (await fetch(at('/api/parts/act1/plan'))).json()).plan.keys).toEqual([])
    expect((await (await fetch(at('/api/parts/act1/plan?stage=final'))).json()).plan.keys).toEqual(
      [],
    )
  })

  it('records a final clip again from its row with the final model, its cost confirmed', async () => {
    const before = models.length
    const asked = await (
      await fetch(at('/api/parts/act1/lines/a/record'), {
        method: 'POST',
        headers: own,
        body: JSON.stringify({ stage: 'final' }),
      })
    ).json()
    expect(asked).toMatchObject({ ok: false, reason: 'confirm' })
    const done = await (
      await fetch(at('/api/parts/act1/lines/a/record'), {
        method: 'POST',
        headers: own,
        body: JSON.stringify({ stage: 'final', confirmedCost: asked.ceiling }),
      })
    ).json()
    expect(done).toMatchObject({ ok: true })
    expect(models.slice(before)).toEqual(['s2-pro'])
  })
})

describe('server, a final stage without a final model', () => {
  const root = tempRepo({
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const server = startServer({
    projectFile: join(root, 'audio-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))

  it('plans the final stage as the draft one', async () => {
    const draft = await (await fetch(new URL('/api/parts/act1/plan', server.url))).json()
    const final = await (
      await fetch(new URL('/api/parts/act1/plan?stage=final', server.url))
    ).json()
    expect(final.plan).toMatchObject({ final: false, keys: draft.plan.keys })
  })
})

describe('server, a paid audition', () => {
  const paid = projectJson({
    narration: { ...(projectJson().narration as object), models: { audition: 's2.1-pro' } },
  })
  const paidRoot = tempRepo({
    'audio-studio.json': paid,
    'tts/cast.json': {
      speakers: { gran: { voice: 'cur', style: '[warm]' }, kid: { voice: 'k1' } },
    },
    'tts/act1/script.json': [
      { key: 'a', speaker: 'gran', text: 'Hello.' },
      { key: 'b', speaker: 'kid', text: 'Hi.' },
    ],
  })
  let credit = 4.82
  const models: string[] = []
  const account: FishClient = {
    ...fish,
    async credit() {
      return credit
    },
    async tts(request) {
      models.push(request.model)
      return new Uint8Array([1, 2, 3])
    },
  }
  const server = startServer({
    projectFile: join(paidRoot, 'audio-studio.json'),
    port: 0,
    fish: account,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }
  const send = (method: string, path: string, body?: unknown) =>
    fetch(at(path), {
      method,
      headers: own,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const sitting = async (id: string) => (await fetch(at(`/api/auditions/${id}/sitting`))).json()
  const takeOf = async (id: string, voice: string, board = true) =>
    (await send('POST', `/api/characters/${id}/takes`, { voice, board })).json()
  const startWith = (id: string, spendUpTo?: number) =>
    send('POST', `/api/auditions/${id}/start`, spendUpTo === undefined ? {} : { spendUpTo })

  it('tells the audition model, what a take costs, and an amount to suggest', async () => {
    const body = await sitting('gran')
    expect(body).toMatchObject({ ok: true, model: 's2.1-pro', paid: true, sitting: null })
    expect(body.perTake).toBeGreaterThan(0)
    expect(body.suggested).toBeGreaterThanOrEqual(0.05)
  })

  it('does not start without an amount, nor for more than the credit', async () => {
    const asked = await startWith('gran')
    expect(asked.status).toBe(409)
    expect(await asked.json()).toMatchObject({ ok: false, reason: 'confirm' })
    const over = await startWith('gran', 5)
    expect(await over.json()).toMatchObject({ ok: false, reason: 'credit' })
    expect(await (await fetch(at('/api/auditions/gran'))).json()).toMatchObject({ session: null })
    expect((await sitting('gran')).sitting).toBeNull()
  })

  it('starts with an amount, and charges board takes to it on the audition model', async () => {
    const started = await startWith('gran', 0.01)
    expect(started.status).toBe(200)
    expect((await sitting('gran')).sitting).toMatchObject({
      dollars: 0.01,
      spent: 0,
      usedUp: false,
    })
    models.length = 0
    expect(await takeOf('gran', 'cur')).toMatchObject({ ok: true })
    expect(models).toEqual(['s2.1-pro'])
    const after = await sitting('gran')
    expect(after.sitting.spent).toBeGreaterThan(0)
    expect(after.sitting.dollars).toBe(0.01)
    // The saved audition keeps it for the character's page.
    const again = await sitting('gran')
    expect(again.spentBefore).toBeCloseTo(after.sitting.spent, 12)
  })

  it('keeps the cast voice’s page take on the free model', async () => {
    models.length = 0
    expect(await takeOf('gran', 'cur', false)).toMatchObject({ ok: true })
    expect(models).toEqual(['s2.1-pro-free'])
  })

  it('makes takes wait when the money is used, and lets them record after an addition', async () => {
    const per = (await sitting('gran')).perTake
    // Use up what is left in whole takes: the next one would go past the budget.
    let n = 0
    while ((await takeOf('gran', `v${n++}`)).ok && n < 200) {}
    expect(n).toBeLessThan(200)
    const used = await sitting('gran')
    expect(used.sitting).toMatchObject({ usedUp: true })
    expect(await takeOf('gran', 'late')).toMatchObject({ ok: false, reason: 'waits' })

    const added = await send('POST', '/api/auditions/gran/sitting/add', { amount: per * 2 })
    expect(added.status).toBe(200)
    const topped = await sitting('gran')
    expect(topped.sitting.dollars).toBeCloseTo(0.01 + per * 2, 12)
    expect(topped.sitting.usedUp).toBe(false)
    expect(await takeOf('gran', 'late')).toMatchObject({ ok: true })

    const tooMuch = await send('POST', '/api/auditions/gran/sitting/add', { amount: 100 })
    expect(await tooMuch.json()).toMatchObject({ ok: false, reason: 'credit' })
  })

  it('holds a sitting’s money back from another one, and gives it back when it ends', async () => {
    credit = 0.015
    // gran's sitting holds what is left of it: add 0.01, and only about 0.005 is free for kid.
    await send('POST', '/api/auditions/gran/sitting/add', { amount: 0.01 })
    const refused = await startWith('kid', 0.01)
    expect(await refused.json()).toMatchObject({ ok: false, reason: 'credit' })
    const ended = await send('DELETE', '/api/auditions/gran/sitting')
    expect(ended.status).toBe(200)
    expect((await sitting('gran')).sitting).toBeNull()
    expect(await takeOf('gran', 'again')).toMatchObject({ ok: false, reason: 'no-sitting' })
    expect((await startWith('kid', 0.01)).status).toBe(200)
  })

  it('resumes with a fresh sitting, and Stop and Cast end it', async () => {
    credit = 4.82
    const resumed = await send('POST', '/api/auditions/kid/sitting', { amount: 0.05 })
    expect(resumed.status).toBe(200)
    expect((await sitting('kid')).sitting).toMatchObject({ dollars: 0.05, spent: 0 })
    await send('DELETE', '/api/auditions/kid')
    expect((await sitting('kid')).sitting).toBeNull()

    await startWith('gran', 0.05)
    await send('POST', '/api/auditions/gran/cast', { voice: 'cur' })
    expect((await sitting('gran')).sitting).toBeNull()
  })

  it('counts money a sitting has spent once against the credit, not twice', async () => {
    credit = 0.02
    await send('DELETE', '/api/auditions/gran/sitting')
    await startWith('gran', 0.01)
    expect(await takeOf('gran', 'one')).toMatchObject({ ok: true })
    const spent = (await sitting('gran')).sitting.spent
    // Fish has billed what the take cost: its credit fell by that much.
    credit = 0.02 - spent
    const added = await send('POST', '/api/auditions/gran/sitting/add', { amount: 0.01 })
    expect(added.status).toBe(200)
    credit = 4.82
  })

  it('leaves no money held when two resumes arrive at once', async () => {
    credit = 4.82
    await send('DELETE', '/api/auditions/gran/sitting')
    await Promise.all([
      send('POST', '/api/auditions/gran/sitting', { amount: 0.01 }),
      send('POST', '/api/auditions/gran/sitting', { amount: 0.01 }),
    ])
    await send('DELETE', '/api/auditions/gran/sitting')
    credit = 0.015
    expect((await startWith('kid', 0.01)).status).toBe(200)
    await send('DELETE', '/api/auditions/kid/sitting')
    credit = 4.82
  })

  it('only takes sitting changes from its own page', async () => {
    const denied = await fetch(at('/api/auditions/gran/sitting'), { method: 'DELETE' })
    expect(denied.status).toBe(403)
  })
})

describe('server, a paid audition ended with takes queued', () => {
  const paid = projectJson({
    narration: {
      ...(projectJson().narration as object),
      models: { audition: 's2.1-pro' },
      quality: { parallel: 1 },
    },
  })
  const root = tempRepo({
    'audio-studio.json': paid,
    'tts/cast.json': { speakers: { gran: { voice: 'cur' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'gran', text: 'Hello.' }],
  })
  let calls = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const account: FishClient = {
    ...fish,
    async tts() {
      calls++
      await gate
      return new Uint8Array([1])
    },
  }
  const server = startServer({
    projectFile: join(root, 'audio-studio.json'),
    port: 0,
    fish: account,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }
  const send = (method: string, path: string, body?: unknown) =>
    fetch(at(path), {
      method,
      headers: own,
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('does not send takes that were still waiting their turn when the sitting ended', async () => {
    await send('POST', '/api/auditions/gran/start', { spendUpTo: 0.05 })
    const takes = ['v1', 'v2', 'v3'].map((voice) =>
      send('POST', '/api/characters/gran/takes', { voice, board: true }).then((r) => r.json()),
    )
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    await send('DELETE', '/api/auditions/gran/sitting')
    release()
    const answers = await Promise.all(takes)
    expect(calls).toBe(1)
    expect(answers.filter((a) => a.reason === 'no-sitting')).toHaveLength(2)
  })
})

describe('server, a paid audition with a take in flight', () => {
  const paid = projectJson({
    narration: { ...(projectJson().narration as object), models: { audition: 's2.1-pro' } },
  })
  const root = tempRepo({
    'audio-studio.json': paid,
    'tts/cast.json': { speakers: { gran: { voice: 'cur' }, kid: { voice: 'k1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'gran', text: 'Hello.' }],
  })
  let calls = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const account: FishClient = {
    ...fish,
    credit: async () => 0.011,
    async tts() {
      calls++
      await gate
      return new Uint8Array([1])
    },
  }
  const server = startServer({
    projectFile: join(root, 'audio-studio.json'),
    port: 0,
    fish: account,
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }
  const send = (method: string, path: string, body?: unknown) =>
    fetch(at(path), {
      method,
      headers: own,
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('still holds what a take in flight cost, which Fish’s credit does not show yet', async () => {
    expect((await send('POST', '/api/auditions/gran/start', { spendUpTo: 0.01 })).status).toBe(200)
    const take = send('POST', '/api/characters/gran/takes', { voice: 'v1', board: true })
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    // Credit 0.011, 0.01 held: only 0.001 is free, though gran's sitting has already been charged.
    const refused = await send('POST', '/api/auditions/kid/start', { spendUpTo: 0.0015 })
    expect(await refused.json()).toMatchObject({ ok: false, reason: 'credit' })
    release()
    await take
  })
})

describe('server, a part in another language', () => {
  const base = projectJson()
  const many = tempRepo({
    'audio-studio.json': {
      ...base,
      narration: {
        ...(base.narration as object),
        languages: ['en', 'sv'],
        paths: {
          dialog: 'tts/{part}/{language}/script.json',
          cues: 'tts/{part}/{language}/cues.json',
          lock: 'tts/{part}/{language}/lock.json',
          clips: 'audio/{part}/{language}',
          manifest: 'audio/{part}/{language}/manifest.json',
        },
      },
    },
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/en/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
    'tts/act1/sv/script.json': [{ key: 'a', speaker: 'narrator', text: 'En gång.' }],
    'audio/act1/sv/a.mp3': 'swedish-clip',
    'audio/act1/sv/manifest.json': { a: { file: 'a.mp3' } },
  })
  const swedish = startServer({
    projectFile: join(many, 'audio-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => swedish.stop(true))
  const get = (path: string) => fetch(new URL(path, swedish.url))

  it('lists the languages in the project summary', async () => {
    const body = await (await get('/api/project')).json()
    expect(body.summary.languages).toEqual([
      { id: 'en', name: 'English' },
      { id: 'sv', name: 'Svenska' },
    ])
  })

  it('serves a part in the language asked for, and its clips from that language', async () => {
    const body = await (await get('/api/parts/act1?language=sv')).json()
    expect(body.part.language).toBe('sv')
    expect(body.part.lines[0]).toMatchObject({ text: 'En gång.', english: 'Once.' })
    expect(await (await get('/api/parts/act1/clips/a.mp3?language=sv')).text()).toBe('swedish-clip')
    expect((await get('/api/parts/act1/clips/a.mp3')).status).toBe(404)
  })
})

describe('cloning a voice', () => {
  const repo = tempRepo({
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const made: { title: FormDataEntryValue | null; names: string[] }[] = []
  const cloning = startServer({
    projectFile: join(repo, 'audio-studio.json'),
    port: 0,
    fish: {
      ...fish,
      async createVoice({ title, files }) {
        if (title === 'Refused') throw new FishError(400, 'Audio too short')
        made.push({ title, names: files.map((f) => f.name) })
        return {
          id: 'f'.repeat(32),
          title,
          description: '',
          tags: [],
          languages: [],
          uses: 0,
          likes: 0,
          author: '',
          sample: null,
        }
      },
    },
    transcriber: null,
  })
  afterAll(() => cloning.stop(true))
  const send = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
    fetch(new URL(path, cloning.url), {
      method: 'POST',
      body,
      headers: { origin: cloning.url.origin, ...headers },
    })
  const form = (title: string, names: string[]) => {
    const data = new FormData()
    data.set('title', title)
    for (const name of names) data.append('voices', new File([new Uint8Array([1, 2])], name))
    return data
  }

  it('sends the recordings to Fish and gives the voice made', async () => {
    const response = await send(
      '/api/characters/narrator/clone-voice',
      form('Nora', ['a.wav', 'b.wav']),
    )
    expect(await response.json()).toEqual({ ok: true, voice: { id: 'f'.repeat(32), name: 'Nora' } })
    expect(made).toEqual([{ title: 'Nora', names: ['a.wav', 'b.wav'] }])
  })

  it('gives Fish’s refusal with a 409, and refuses a body that is not the form', async () => {
    const refused = await send('/api/characters/narrator/clone-voice', form('Refused', ['a.wav']))
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ ok: false, reason: 'fish', message: 'Audio too short' })
    const bad = await send('/api/characters/narrator/clone-voice', '{}', {
      'content-type': 'application/json',
    })
    expect(bad.status).toBe(400)
  })

  it('refuses another page, and an unknown character', async () => {
    const other = await send('/api/characters/narrator/clone-voice', form('Nora', ['a.wav']), {
      origin: 'https://evil.example',
    })
    expect(other.status).toBe(403)
    const unknown = await send('/api/characters/nobody/clone-voice', form('Nora', ['a.wav']))
    expect(unknown.status).toBe(404)
  })

  it('refuses to cast from another page or with a body that names no voice', async () => {
    const json = { 'content-type': 'application/json' }
    const other = await send('/api/characters/narrator/cast-voice', '{}', {
      ...json,
      origin: 'https://evil.example',
    })
    expect(other.status).toBe(403)
    expect((await send('/api/characters/narrator/cast-voice', '{}', json)).status).toBe(400)
  })

  it('casts the voice made without an audition', async () => {
    const response = await send(
      '/api/characters/narrator/cast-voice',
      JSON.stringify({ voice: 'f'.repeat(32), name: 'Nora' }),
      { 'content-type': 'application/json' },
    )
    expect(await response.json()).toMatchObject({
      ok: true,
      voice: { name: 'Nora' },
      changed: true,
    })
    const cast = JSON.parse(readFileSync(join(repo, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.narrator).toMatchObject({ voice: 'f'.repeat(32), voiceName: 'Nora' })
  })
})

describe('server, the spending record', () => {
  const oneAtATime = { ...(projectJson().narration as object), quality: { parallel: 1 } }
  const freeProject = projectJson({ narration: oneAtATime })
  const paidProject = projectJson({ narration: { ...oneAtATime, models: { draft: 's2-pro' } } })
  const script = ['a', 'b', 'c'].map((key) => ({ key, speaker: 'narrator', text: `Line ${key}.` }))
  const repo = tempRepo({
    'audio-studio.json': paidProject,
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': script,
  })
  const projectFile = join(repo, 'audio-studio.json')
  const requests: ReturnType<typeof gate>[] = []
  let hold = false
  let failFrom = Infinity
  let sent = 0
  const account: FishClient = {
    ...fish,
    createVoice: () => Promise.reject(new Error('not used')),
    async credit() {
      return 100
    },
    async tts(request) {
      if (++sent > failFrom) throw new FishError(500, 'boom')
      if (hold) {
        const waiting = gate()
        requests.push(waiting)
        await waiting.opened
      }
      return fish.tts(request)
    },
  }
  const server = startServer({ projectFile, port: 0, fish: account, encode, transcriber: null })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }
  const post = (path: string, body: unknown) =>
    fetch(at(path), { method: 'POST', headers: own, body: JSON.stringify(body) })
  const spending = async () => (await fetch(at('/api/spending'))).json()
  const ceilingOf = async () =>
    (await (await fetch(at('/api/parts/act1/plan'))).json()).plan.ceiling as number
  const startJob = async (keys: string[]) => {
    const ceiling = (await (await fetch(at('/api/parts/act1/plan'))).json()).plan.ceiling
    return (
      await post('/api/parts/act1/jobs', {
        speaker: null,
        keys,
        orphans: [],
        confirmedCost: ceiling,
      })
    ).json()
  }
  const waitJob = async (id: string) => {
    for (;;) {
      const state = await (await fetch(at(`/api/jobs/${id}`))).json()
      if (state.status !== 'running' && state.status !== 'cancelling') return state
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  const settle = async (rows: number) => {
    const giveUp = Date.now() + 2000
    for (;;) {
      const now = await spending()
      if (now.ok && now.rows.filter((r: { state: string }) => r.state !== 'running').length >= rows)
        return now
      if (Date.now() > giveUp) throw new Error('waited in vain')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  it('is empty before anything is recorded', async () => {
    expect(await spending()).toMatchObject({ ok: true, total: 0, count: 0, rows: [] })
  })

  it('logs a paid one-line recording with what it was charged', async () => {
    const ceiling = await ceilingOf()
    const line = (await (await fetch(at('/api/parts/act1/plan'))).json()).plan.cost / 3
    const done = await post('/api/parts/act1/lines/a/record', { confirmedCost: ceiling })
    expect(await done.json()).toMatchObject({ ok: true })
    const now = await spending()
    expect(now.count).toBe(1)
    expect(now.rows[0]).toMatchObject({
      part: 'act1',
      language: 'en',
      model: 's2-pro',
      lines: 1,
      planned: 1,
      state: 'done',
    })
    expect(now.rows[0].cost).toBeGreaterThan(0)
    expect(now.rows[0].cost).toBeLessThan(line * 1.01)
    expect(now.acts[0]).toMatchObject({ part: 'act1', title: 'Act I' })
    expect(now.total).toBeCloseTo(now.rows[0].cost, 12)
    expect(existsSync(join(repo, '.audio-studio/spending.json'))).toBe(true)
  })

  it('logs a whole-part job, and shows it live while it runs', async () => {
    hold = true
    const job = await startJob(['b', 'c'])
    await until(() => requests.length >= 1)
    const live = await spending()
    expect(live.rows[0]).toMatchObject({ state: 'running', planned: 2, lines: 0 })
    expect(live.rows[0].cost).toBeGreaterThan(0)
    expect(live.count).toBe(2)
    hold = false
    for (const r of requests) r.open()
    await waitJob(job.id)
    const now = await settle(2)
    expect(now.rows.map((r: { state: string }) => r.state)).toEqual(['done', 'done'])
    expect(now.rows[0]).toMatchObject({ lines: 2, planned: 2 })
  })

  it('logs a job that stopped, or ended on an error, with the lines it got through', async () => {
    writeFileSync(
      join(repo, 'tts/act1/script.json'),
      JSON.stringify(script.map((l) => ({ ...l, text: `${l.text} Again.` }))),
    )
    sent = 0
    failFrom = 1
    const failing = await startJob(['a', 'b', 'c'])
    await waitJob(failing.id)
    const now = await settle(3)
    expect(now.rows[0]).toMatchObject({ state: 'error', lines: 1, planned: 3 })
    failFrom = Infinity
  })

  it('keeps the record across a restart of the studio', async () => {
    const again = startServer({ projectFile, port: 0, fish: account, encode, transcriber: null })
    try {
      const body = await (await fetch(new URL('/api/spending', again.url))).json()
      expect(body.count).toBe(3)
    } finally {
      again.stop(true)
    }
  })

  it('says so when the record is damaged', async () => {
    const path = join(repo, '.audio-studio/spending.json')
    const good = readFileSync(path, 'utf8')
    writeFileSync(path, '{ nope')
    const body = await spending()
    expect(body).toMatchObject({ ok: false })
    expect(body.problems[0].file).toBe('.audio-studio/spending.json')
    writeFileSync(path, good)
  })

  it('logs nothing for a free model', async () => {
    const freeRepo = tempRepo({
      'audio-studio.json': freeProject,
      'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
      'tts/act1/script.json': script,
    })
    const free = startServer({
      projectFile: join(freeRepo, 'audio-studio.json'),
      port: 0,
      fish: account,
      encode,
      transcriber: null,
    })
    try {
      const o = { origin: free.url.origin, 'content-type': 'application/json' }
      const res = await fetch(new URL('/api/parts/act1/lines/a/record', free.url), {
        method: 'POST',
        headers: o,
        body: '{}',
      })
      expect(await res.json()).toMatchObject({ ok: true })
      expect(await (await fetch(new URL('/api/spending', free.url))).json()).toMatchObject({
        ok: true,
        count: 0,
      })
      expect(existsSync(join(freeRepo, '.audio-studio/spending.json'))).toBe(false)
    } finally {
      free.stop(true)
    }
  })

  it('logs a job stopped part-way as stopped, with the lines it got through', async () => {
    writeFileSync(
      join(repo, 'tts/act1/script.json'),
      JSON.stringify(script.map((l) => ({ ...l, text: `${l.text} Once more.` }))),
    )
    const before = (await spending()).count
    requests.length = 0
    hold = true
    const job = await startJob(['a', 'b', 'c'])
    await until(() => requests.length >= 1)
    await fetch(at(`/api/jobs/${job.id}`), { method: 'DELETE', headers: own })
    hold = false
    for (const r of requests) r.open()
    await waitJob(job.id)
    const now = await settle(before + 1)
    expect(now.rows[0]).toMatchObject({ state: 'stopped', planned: 3 })
    expect(now.rows[0].lines).toBeGreaterThan(0)
    expect(now.rows[0].lines).toBeLessThan(3)
  })

  it('logs a paid take whose request failed after it was charged as ended on an error', async () => {
    const before = (await spending()).count
    const ceiling = await ceilingOf()
    sent = 0
    failFrom = 0
    const res = await post('/api/parts/act1/lines/a/takes', { confirmedCost: ceiling })
    failFrom = Infinity
    expect((await res.json()).ok).toBe(false)
    const now = await spending()
    expect(now.count).toBe(before + 1)
    expect(now.rows[0]).toMatchObject({ state: 'error', lines: 0, planned: 1 })
    expect(now.rows[0].cost).toBeGreaterThan(0)
    expect(now.rows.some((r: { state: string }) => r.state === 'running')).toBe(false)
  })

  it('logs a paid extra take', async () => {
    const before = (await spending()).count
    const ceiling = await ceilingOf()
    const res = await post('/api/parts/act1/lines/a/takes', { confirmedCost: ceiling })
    expect(await res.json()).toMatchObject({ ok: true })
    const now = await spending()
    expect(now.count).toBe(before + 1)
    expect(now.rows[0]).toMatchObject({ lines: 1, planned: 1, state: 'done' })
  })
})

describe('designing a voice', () => {
  const repo = tempRepo({
    'audio-studio.json': projectJson(),
    'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const asked: string[] = []
  const saved: string[] = []
  let credit: number | Error = 25
  const designing = startServer({
    projectFile: join(repo, 'audio-studio.json'),
    port: 0,
    fish: {
      ...fish,
      async credit() {
        if (credit instanceof Error) throw credit
        return credit
      },
      async designVoice({ instruction, count }) {
        asked.push(instruction)
        if (instruction === 'refused') throw new FishError(503, 'Too busy')
        return Array.from({ length: count }, (_, i) => ({ id: `c${i}`, wav: new Uint8Array([i]) }))
      },
      async createVoice({ title }) {
        saved.push(title)
        return {
          id: 'f'.repeat(32),
          title,
          description: '',
          tags: [],
          languages: [],
          uses: 0,
          likes: 0,
          author: '',
          sample: null,
        }
      },
    },
    encode,
    transcriber: null,
  })
  afterAll(() => designing.stop(true))
  const send = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL(path, designing.url), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { origin: designing.url.origin, 'content-type': 'application/json', ...headers },
    })
  const design = (description: string, spendUpTo?: number) =>
    send('/api/characters/narrator/design', { description, spendUpTo })

  it('does not design until the cost is confirmed, or when the credit does not cover it', async () => {
    const unconfirmed = await design('an old woman')
    expect(unconfirmed.status).toBe(409)
    expect(await unconfirmed.json()).toMatchObject({ ok: false, reason: 'confirm' })
    credit = 0.005
    const short = await design('an old woman', 0.01)
    expect(short.status).toBe(409)
    expect(await short.json()).toMatchObject({ ok: false, reason: 'credit' })
    credit = new Error('wallet down')
    const unknown = await design('an old woman', 0.01)
    expect(await unknown.json()).toMatchObject({ ok: false, reason: 'credit' })
    credit = 25
    expect(asked).toEqual([])
  })

  it('designs once the cost is confirmed, and remembers the description', async () => {
    const response = await design('an old woman', 0.01)
    expect(await response.json()).toEqual({ ok: true, added: 4 })
    expect(asked).toEqual(['an old woman'])
    const last = await fetch(new URL('/api/characters/narrator/designs', designing.url))
    expect(await last.json()).toEqual({ ok: true, description: 'an old woman' })
  })

  it('gives Fish’s refusal with a 409', async () => {
    const refused = await design('refused', 0.01)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ ok: false, reason: 'fish', message: 'Too busy' })
  })

  it('refuses another page, a body that is not a description, and an unknown character', async () => {
    const other = await send(
      '/api/characters/narrator/design',
      { description: 'x', spendUpTo: 0.01 },
      { origin: 'https://evil.example' },
    )
    expect(other.status).toBe(403)
    expect((await send('/api/characters/narrator/design', {})).status).toBe(400)
    const unknown = await send('/api/characters/nobody/design', {
      description: 'x',
      spendUpTo: 0.01,
    })
    expect(unknown.status).toBe(404)
  })

  it('shows the designs on the board, saves one to the account on cast, and casts it', async () => {
    const started = await send('/api/auditions/narrator/start', {})
    const board = await started.json()
    expect(board.session.designed.length).toBe(4)
    const [id] = board.session.designed as string[]
    expect(board.takes[id!]).toMatch(/^[0-9a-f]{16}$/)
    expect((await fetch(new URL(`/api/takes/${board.takes[id!]}.mp3`, designing.url))).status).toBe(
      200,
    )
    await send('/api/auditions/narrator/move', { voice: id, move: 'shortlist' })
    const cast = await send('/api/auditions/narrator/cast', { voice: id })
    expect(await cast.json()).toMatchObject({
      ok: true,
      voice: { id: 'f'.repeat(32), name: 'Narrator (designed)' },
    })
    expect(saved).toEqual(['Narrator (designed)'])
    const file = JSON.parse(readFileSync(join(repo, 'tts/cast.json'), 'utf8'))
    expect(file.speakers.narrator.voice).toBe('f'.repeat(32))
  })
})

describe('server, generating per language', () => {
  const base = projectJson()
  const languageRoot = tempRepo({
    'audio-studio.json': {
      ...base,
      narration: {
        ...(base.narration as object),
        languages: ['en', 'sv'],
        quality: { transcriber: 'none' },
        paths: {
          dialog: 'tts/{part}/{language}/script.json',
          cues: 'tts/{part}/{language}/cues.json',
          lock: 'tts/{part}/{language}/narration.lock.json',
          clips: 'audio/{part}/{language}',
          manifest: 'audio/{part}/{language}/manifest.json',
        },
      },
    },
    'tts/cast.json': {
      speakers: {
        narrator: { voice: 'v-en', languages: { sv: { voice: 'v-sv' } } },
        gran: { voice: 'v-gran' },
      },
    },
    'tts/act1/en/script.json': [
      { key: 'a', speaker: 'narrator', text: 'Once.' },
      { key: 'b', speaker: 'gran', text: 'Come in.' },
      { key: 'c', speaker: 'narrator', text: 'Later.' },
    ],
    'tts/act1/sv/script.json': [
      { key: 'a', speaker: 'narrator', text: 'En gång.' },
      { key: 'b', speaker: 'gran', text: 'Kom in.' },
    ],
  })
  const spoken: string[] = []
  const server = startServer({
    projectFile: join(languageRoot, 'audio-studio.json'),
    port: 0,
    fish: {
      ...fish,
      async tts(request) {
        spoken.push(`${request.voice}: ${request.text}`)
        return fish.tts(request)
      },
    },
    encode,
    transcriber: null,
  })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const own = { origin: server.url.origin, 'content-type': 'application/json' }
  const get = async (path: string) => (await fetch(at(path))).json()
  const send = async (method: string, path: string, body: unknown) =>
    (await fetch(at(path), { method, headers: own, body: JSON.stringify(body) })).json()

  it('plans only the language asked for: its lines, who is uncast, what is not translated', async () => {
    const sv = (await get('/api/parts/act1/plan?language=sv')).plan
    expect(sv).toMatchObject({ keys: ['a'], uncast: ['gran'], untranslated: 1 })
    const en = (await get('/api/parts/act1/plan')).plan
    expect(en).toMatchObject({ keys: ['a', 'b', 'c'], uncast: [], untranslated: 0 })
    // Unknown language: the source language's.
    expect((await get('/api/parts/act1/plan?language=xx')).plan.keys).toEqual(['a', 'b', 'c'])
  })

  it('records a language into its own files, with its voice, and finds its job apart', async () => {
    const job = await send('POST', '/api/parts/act1/jobs?language=sv', {
      speaker: null,
      keys: ['a'],
      orphans: [],
    })
    expect(job).toMatchObject({ status: 'running', total: 1, language: 'sv' })
    let state = job
    while (state.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 10))
      state = await get(`/api/jobs/${job.id}`)
    }
    expect(state).toMatchObject({ status: 'done', done: 1, failed: [] })
    expect(spoken).toEqual(['v-sv: En gång.'])
    expect(existsSync(join(languageRoot, 'audio/act1/sv/a.mp3'))).toBe(true)
    expect(existsSync(join(languageRoot, 'audio/act1/en/a.mp3'))).toBe(false)
    expect((await get('/api/parts/act1/jobs/latest?language=sv')).id).toBe(job.id)
    expect(await get('/api/parts/act1/jobs/latest')).toBeNull()
    const sv = await get('/api/parts/act1?language=sv')
    expect(sv.part.counts.ok).toBe(1)
    expect((await get('/api/parts/act1')).part.counts.ok).toBe(0)
  })

  it('records one line of a language from its row', async () => {
    const result = await send('POST', '/api/parts/act1/lines/b/record?language=sv', {})
    expect(result).toMatchObject({ ok: false, reason: 'uncast' })
  })

  it('saves a cue, pronunciations and words that sound the same for the language asked for', async () => {
    expect(await send('PATCH', '/api/parts/act1/cues/a?language=sv', { cue: '[mjukt]' })).toEqual({
      ok: true,
    })
    expect(JSON.parse(readFileSync(join(languageRoot, 'tts/act1/sv/cues.json'), 'utf8'))).toEqual({
      a: '[mjukt]',
    })
    expect(existsSync(join(languageRoot, 'tts/act1/en/cues.json'))).toBe(false)
    expect(
      await send('PATCH', '/api/pronounce?language=sv', { table: [['Kom', 'Komm']], was: [] }),
    ).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(join(languageRoot, 'tts/cast.json'), 'utf8')).languages).toEqual(
      {
        sv: { pronounce: { Kom: 'Komm' } },
      },
    )
    expect(
      await send('PATCH', '/api/sound-alike?language=sv', {
        groups: [['Lyria', 'Liria']],
        was: [],
      }),
    ).toEqual({ ok: true })
    const project = JSON.parse(readFileSync(join(languageRoot, 'audio-studio.json'), 'utf8'))
    expect(project.narration.quality.soundAlikeByLanguage).toEqual({ sv: [['Lyria', 'Liria']] })
    const summary = (await get('/api/project')).summary
    expect(summary.perLanguage.sv).toEqual({
      pronounce: [['Kom', 'Komm']],
      soundAlike: [['Lyria', 'Liria']],
    })
    expect(summary.perLanguage.en).toEqual({ pronounce: [], soundAlike: [] })
  })

  it('keeps a language’s notes apart', async () => {
    await send('PATCH', '/api/parts/act1/lines/a/note?language=sv', { note: 'för snabb' })
    expect((await get('/api/parts/act1?language=sv')).part.notes).toEqual({ a: 'för snabb' })
    expect((await get('/api/parts/act1')).part.notes).toEqual({})
  })
})

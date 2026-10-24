import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeWav } from '../core/wav'
import { projectJson, tempRepo } from '../../test/helpers'
import type { FishClient } from '../services/fish'
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
      ownCue: true,
    })
    expect((await patch('a', { cue: '' })).status).toBe(200)
    const after = await (await fetch(url('/api/parts/act1'))).json()
    expect(after.part.lines.find((l: { key: string }) => l.key === 'a').ownCue).toBe(false)
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
    transcriber: null,
  })
  afterAll(() => other.stop(true))

  it('says there is no API key', async () => {
    const body = await (
      await fetch(new URL('/api/characters/narrator/candidates', other.url))
    ).json()
    expect(body).toMatchObject({ ok: false, reason: 'no-key' })
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

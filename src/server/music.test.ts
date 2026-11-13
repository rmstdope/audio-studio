import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWav, writeWav } from '../core/wav'
import { projectJson, tempRepo } from '../../test/helpers'
import { startServer } from './index'
import { encode, fish, startBase } from './test-support'

const { root } = startBase()

describe('server, the music pages', () => {
  const list = JSON.stringify([{ id: 'victory', title: 'Victory', text: 'fanfare', seconds: 5 }])
  const musicRoot = tempRepo({
    'content-studio.json': projectJson({
      refresh: { shared: `mkdir -p tts && printf '%s' '${list}' > tts/stingers.json` },
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
  })
  const studio = startServer({
    projectFile: join(musicRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => studio.stop(true))
  const refresh = (origin: string) =>
    fetch(new URL('/api/music/stingers/refresh', studio.url), {
      method: 'POST',
      headers: { origin },
    })

  it('shows the lists in the project summary', async () => {
    const body = await (await fetch(new URL('/api/project', studio.url))).json()
    expect(body.summary.music.lists.map((l: { id: string }) => l.id)).toEqual([
      'act1',
      'act2',
      'stingers',
    ])
  })

  it('refreshes the stingers from the studio’s own page only', async () => {
    expect((await refresh('https://evil.example')).status).toBe(403)
    const answer = await refresh(studio.url.origin)
    expect(answer.status).toBe(200)
    expect(await answer.json()).toMatchObject({
      ok: true,
      stingers: 1,
      change: { added: [{ id: 'victory' }], removed: [] },
    })
    expect(existsSync(join(musicRoot, 'tts/stingers.json'))).toBe(true)
  })

  describe('saving a track’s brief', () => {
    const patch = (id: string, body: unknown, origin = studio.url.origin) =>
      fetch(new URL(`/api/music/tracks/${id}`, studio.url), {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    beforeAll(() => writeFileSync(join(musicRoot, 'tts/stingers.json'), list))

    it('takes a change from the studio’s own page only', async () => {
      expect((await patch('victory', { brief: 'x' }, 'https://evil.example')).status).toBe(403)
    })

    it('refuses a body that is not one field', async () => {
      expect((await patch('victory', { brief: 'x', key: 'C' })).status).toBe(400)
      expect((await patch('victory', { bpm: 1000 })).status).toBe(400)
    })

    it('answers 404 for a track nobody lists', async () => {
      expect((await patch('nobody', { brief: 'x' })).status).toBe(404)
    })

    it('answers 409 with the reason for a stinger that is too long', async () => {
      const answer = await patch('victory', { seconds: 11 })
      expect(answer.status).toBe(409)
      expect(await answer.json()).toMatchObject({
        ok: false,
        problems: [{ path: 'victory.seconds' }],
      })
    })

    it('saves, and the summary then shows the change', async () => {
      const answer = await patch('victory', { brief: 'ours' })
      expect(answer.status).toBe(200)
      expect(await answer.json()).toEqual({ ok: true })
      const body = await (await fetch(new URL('/api/project', studio.url))).json()
      const stingers = body.summary.music.lists.find((l: { id: string }) => l.id === 'stingers')
      expect(stingers.tracks[0]).toMatchObject({ brief: 'ours', game: { brief: 'fanfare' } })
    })

    it('keeps the studio’s brief over the game’s new one, from the studio’s own page only', async () => {
      const keep = (id: string, origin = studio.url.origin) =>
        fetch(new URL(`/api/music/tracks/${id}/keep-mine`, studio.url), {
          method: 'POST',
          headers: { origin },
        })
      const stingers = async () => {
        const body = await (await fetch(new URL('/api/project', studio.url))).json()
        return body.summary.music.lists.find((l: { id: string }) => l.id === 'stingers')
      }
      writeFileSync(
        join(musicRoot, 'content-studio/music/edits.json'),
        JSON.stringify({ victory: { text: 'ours', gameWas: 'older' } }),
      )
      expect((await stingers()).tracks[0]).toMatchObject({ gameChanged: true, gameWas: 'older' })
      expect((await keep('victory', 'https://evil.example')).status).toBe(403)
      expect((await keep('nobody')).status).toBe(404)
      const answer = await keep('victory')
      expect(answer.status).toBe(200)
      expect(await answer.json()).toEqual({ ok: true })
      expect((await stingers()).tracks[0]).toMatchObject({
        brief: 'ours',
        gameChanged: false,
        gameWas: 'fanfare',
      })
    })
  })

  it('refuses with a reason when the project has no shared command', async () => {
    const plain = startServer({
      projectFile: join(root, 'content-studio.json'),
      port: 0,
      fish,
      encode,
      transcriber: null,
    })
    try {
      const answer = await fetch(new URL('/api/music/stingers/refresh', plain.url), {
        method: 'POST',
        headers: { origin: plain.url.origin },
      })
      expect(answer.status).toBe(409)
      expect(await answer.json()).toMatchObject({ ok: false, reason: 'none' })
    } finally {
      plain.stop(true)
    }
  })
})

describe('server, what music takes cost', () => {
  const musicRoot = tempRepo({
    'content-studio.json': projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
  })
  const studio = startServer({
    projectFile: join(musicRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    music: {
      ready: () => ({ ok: true }),
      installed: () => true,
      async generate(request) {
        const samples = new Int16Array(request.seconds * 1000).fill(4000)
        const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
        return { wav: writeWav({ format, data: new Uint8Array(samples.buffer) }) }
      },
      close() {},
    },
  })
  afterAll(() => studio.stop(true))
  const takes = () => new URL('/api/music/tracks/hall/takes', studio.url)
  const make = (body: unknown) =>
    fetch(takes(), {
      method: 'POST',
      headers: { origin: studio.url.origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('lists a paid take on the Spending page, in its act, and a free one not', async () => {
    const after = async () => {
      for (let i = 0; i < 200; i++) {
        const view = await (await fetch(takes())).json()
        if (!view.making.length) return
        await Bun.sleep(5)
      }
    }
    expect((await make({ count: 1, model: 'balanced' })).status).toBe(200)
    await after()
    expect((await make({ count: 1, model: 'eleven' })).status).toBe(200)
    await after()
    await Bun.sleep(20)
    const spending = await (await fetch(new URL('/api/spending', studio.url))).json()
    expect(spending).toMatchObject({ ok: true, takes: 1, count: 0 })
    expect(spending.rows).toMatchObject([
      { kind: 'music', part: 'act1', track: 'Hall', model: 'eleven', seconds: 25, state: 'done' },
    ])
    // No stinger cost anything: no Stingers tile.
    expect(spending.acts.map((a: { part: string }) => a.part)).not.toContain('stingers')
  })
})

describe('server, a track’s takes', () => {
  const musicRoot = tempRepo({
    'content-studio.json': projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
  })
  let ready: { ok: true } | { ok: false; message: string; fix: string } = { ok: true }
  const made: string[] = []
  const studio = startServer({
    projectFile: join(musicRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    music: {
      ready: () => ready,
      installed: () => true,
      async generate(request) {
        made.push(request.brief)
        const samples = new Int16Array(request.seconds * 1000).fill(4000)
        const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
        return {
          wav: writeWav({ format, data: new Uint8Array(samples.buffer) }),
          seed: request.seed,
        }
      },
      close() {},
    },
  })
  afterAll(() => studio.stop(true))
  const takes = (path = 'hall/takes') => new URL(`/api/music/tracks/${path}`, studio.url)
  const make = (body: unknown, origin = studio.url.origin) =>
    fetch(takes(), {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('makes takes from the studio’s own page only, and refuses a body that is not a request', async () => {
    expect((await make({ count: 2 }, 'https://evil.example')).status).toBe(403)
    expect((await make({ count: 0 })).status).toBe(400)
    expect((await make({ count: 7 })).status).toBe(400)
    expect((await make({ count: 50 })).status).toBe(400)
    expect((await make('two')).status).toBe(400)
  })

  it('answers 404 for a track nobody lists', async () => {
    expect((await fetch(takes('nobody/takes'))).status).toBe(404)
    const answer = await fetch(takes('nobody/takes'), {
      method: 'POST',
      headers: { origin: studio.url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ count: 2 }),
    })
    expect(answer.status).toBe(404)
  })

  it('refuses with the reason when the generator is not ready', async () => {
    ready = { ok: false, message: 'uv is not on the PATH.', fix: 'brew install uv' }
    const answer = await make({ count: 2 })
    expect(answer.status).toBe(409)
    expect(await answer.json()).toEqual({ ok: false, message: 'uv is not on the PATH.' })
    expect(made).toEqual([])
    ready = { ok: true }
  })

  it('refuses to make again a take that did not fail', async () => {
    const answer = await make({ retry: 7 })
    expect(answer.status).toBe(409)
    expect(await answer.json()).toEqual({
      ok: false,
      message: 'Take 7 did not fail, so it is not made again.',
    })
  })

  it('makes two takes, lists them, and serves each as a WAV', async () => {
    expect(await (await make({ count: 2 })).json()).toEqual({ ok: true })
    let view = await (await fetch(takes())).json()
    for (let i = 0; i < 200 && view.making.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      view = await (await fetch(takes())).json()
    }
    expect(view).toMatchObject({ ok: true, kind: 'loop', generator: { ok: true } })
    expect(view.takes.map((t: { n: number }) => t.n)).toEqual([1, 2])
    const clip = await fetch(takes(`hall/takes/${view.takes[0].file}`))
    expect(clip.status).toBe(200)
    expect(new Uint8Array(await clip.arrayBuffer()).slice(0, 4)).toEqual(
      new TextEncoder().encode('RIFF'),
    )
    const seam = await fetch(takes(`hall/takes/${view.takes[0].file}?seam=1`))
    const heard = readWav(new Uint8Array(await seam.arrayBuffer()))
    expect(heard.data.length / 2 / heard.format.sampleRate).toBe(8)
    expect((await fetch(takes('hall/takes/x.wav'))).status).toBe(404)
  })

  it('drops a take from the studio’s own page only, and its file is gone', async () => {
    await make({ count: 1 })
    let view = await (await fetch(takes())).json()
    for (let i = 0; i < 200 && view.making.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      view = await (await fetch(takes())).json()
    }
    const file = view.takes.at(-1).file
    const drop = (name: string, origin = studio.url.origin) =>
      fetch(takes(`hall/takes/${name}`), { method: 'DELETE', headers: { origin } })
    expect((await drop(file, 'https://evil.example')).status).toBe(403)
    expect((await fetch(takes(`hall/takes/${file}`))).status).toBe(200)
    expect(await (await drop(file)).json()).toEqual({ ok: true })
    expect((await fetch(takes(`hall/takes/${file}`))).status).toBe(404)
    const answer = await drop(file)
    expect(answer.status).toBe(409)
    expect(await answer.json()).toEqual({ ok: false, message: 'That take is not on the board.' })
    expect(
      (
        await fetch(takes('nobody/takes/aaaaaaaaaaaaaaaa.1.wav'), {
          method: 'DELETE',
          headers: { origin: studio.url.origin },
        })
      ).status,
    ).toBe(404)
  })

  it('stops waiting takes from the studio’s own page only, and says what is making', async () => {
    const stop = (id = 'hall', origin = studio.url.origin) =>
      fetch(takes(`${id}/stop`), { method: 'POST', headers: { origin } })
    expect((await stop('hall', 'https://evil.example')).status).toBe(403)
    expect((await stop('nobody')).status).toBe(404)
    expect(await (await stop()).json()).toEqual({ ok: true, stopped: 0 })
    const making = new URL('/api/music/making', studio.url)
    expect(await (await fetch(making)).json()).toEqual({})
    await make({ count: 2 })
    const summary = await (await fetch(making)).json()
    expect(summary.hall.takes).toBeGreaterThan(0)
    expect(summary.hall.left).toBeGreaterThan(0)
    // Leave nothing making, or the next test's make-all finds the track busy and makes nothing.
    await stop()
    for (let i = 0; i < 200 && Object.keys(await (await fetch(making)).json()).length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(await (await fetch(making)).json()).toEqual({})
  })

  it('makes and stops takes for a whole list from the studio’s own page only', async () => {
    const post = (path: string, origin = studio.url.origin) =>
      fetch(new URL(path, studio.url), { method: 'POST', headers: { origin } })
    expect((await post('/api/music/lists/act1/make-all', 'https://evil.example')).status).toBe(403)
    expect((await post('/api/music/lists/act1/stop', 'https://evil.example')).status).toBe(403)
    expect((await post('/api/music/lists/nobody/make-all')).status).toBe(404)
    expect((await post('/api/music/lists/nobody/stop')).status).toBe(404)
    expect((await post('/api/music/lists/act1/batch/close', 'https://evil.example')).status).toBe(
      403,
    )
    const state = await (await fetch(new URL('/api/music/model-state', studio.url))).json()
    expect(state).toMatchObject({ ok: true, model: 'balanced' })
    const made = await post('/api/music/lists/act1/make-all')
    expect(made.status).toBe(200)
    expect(await made.json()).toEqual({ ok: true, tracks: 1, takes: 4 })
    const batchUrl = new URL('/api/music/lists/act1/batch', studio.url)
    expect(await (await fetch(batchUrl)).json()).toMatchObject({ total: 4, tracks: ['hall'] })
    const stopped = await (await post('/api/music/lists/act1/stop')).json()
    expect(stopped.ok).toBe(true)
    expect(await (await fetch(batchUrl)).json()).toMatchObject({ running: false })
    expect((await (await fetch(batchUrl)).json()).stopped).toBeLessThanOrEqual(stopped.stopped)
    expect(await (await post('/api/music/lists/act1/batch/close')).json()).toEqual({ ok: true })
    expect(await (await fetch(batchUrl)).json()).toBeNull()
  })
})

describe('server, choosing a take', () => {
  const musicRoot = tempRepo({
    'content-studio.json': projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
  })
  const studio = startServer({
    projectFile: join(musicRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    music: {
      ready: () => ({ ok: true }),
      installed: () => true,
      async generate(request) {
        const samples = new Int16Array(request.seconds * 1000).fill(4000)
        const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
        return {
          wav: writeWav({ format, data: new Uint8Array(samples.buffer) }),
          seed: request.seed,
        }
      },
      close() {},
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

  it('chooses a take from the studio’s own page only, writes the music, and shows it chosen', async () => {
    await post('/api/music/tracks/hall/takes', { count: 2 })
    let view = await (await fetch(at('/api/music/tracks/hall/takes'))).json()
    for (let i = 0; i < 300 && (view.making.length || view.takes.length < 2); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      view = await (await fetch(at('/api/music/tracks/hall/takes'))).json()
    }
    const file = view.takes[0].file
    const path = '/api/music/tracks/hall/choose'
    expect((await post(path, { file }, 'https://evil.example')).status).toBe(403)
    expect((await post(path, { nope: 1 })).status).toBe(400)
    expect((await post('/api/music/tracks/nobody/choose', { file })).status).toBe(404)
    const missing = await post(path, { file: '0123456789abcdef.9.wav' })
    expect(missing.status).toBe(409)
    expect(await post(path, { file }).then((r) => r.json())).toEqual({ ok: true })
    expect(existsSync(join(musicRoot, 'audio/music/hall.mp3'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(musicRoot, 'audio/music/manifest.json'), 'utf8'))
    expect(manifest.hall).toEqual({ file: 'hall.mp3', duration: 5 })
    const summary = await (await fetch(at('/api/project'))).json()
    const row = summary.summary.music.lists[0].tracks[0]
    expect(row.status).toBe('chosen')
    const after = await (await fetch(at('/api/music/tracks/hall/takes'))).json()
    expect(after.takes.map((t: { chosen: boolean }) => t.chosen)).toEqual([true, false])
    // The chosen take cannot be dropped.
    const drop = await fetch(at(`/api/music/tracks/hall/takes/${file}`), {
      method: 'DELETE',
      headers: { origin: studio.url.origin },
    })
    expect(drop.status).toBe(409)
  })

  it('takes a choice back from the studio’s own page only, and the track is not chosen again', async () => {
    const path = '/api/music/tracks/hall/unchoose'
    expect((await post(path, {}, 'https://evil.example')).status).toBe(403)
    expect((await post('/api/music/tracks/nobody/unchoose', {})).status).toBe(404)
    expect(await post(path, {}).then((r) => r.json())).toEqual({ ok: true })
    expect(existsSync(join(musicRoot, 'audio/music/hall.mp3'))).toBe(false)
    expect((await post(path, {})).status).toBe(409)
    const summary = await (await fetch(at('/api/project'))).json()
    expect(summary.summary.music.lists[0].tracks[0].status).toBe('not-chosen')
    const file = (await (await fetch(at('/api/music/tracks/hall/takes'))).json()).takes[0].file
    // Put the choice back for the tests that follow.
    expect(await post('/api/music/tracks/hall/choose', { file }).then((r) => r.json())).toEqual({
      ok: true,
    })
  })

  it('accepts a track’s changed brief from the studio’s own page only', async () => {
    const path = '/api/music/tracks/hall/accept'
    expect((await post(path, {}, 'https://evil.example')).status).toBe(403)
    expect((await post('/api/music/tracks/nobody/accept', {})).status).toBe(404)
    // Nothing has changed since the take was chosen.
    expect((await post(path, {})).status).toBe(409)
    const patch = (body: unknown) =>
      fetch(at('/api/music/tracks/hall'), {
        method: 'PATCH',
        headers: { origin: studio.url.origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const before = (await (await fetch(at('/api/project'))).json()).summary.music.lists[0].tracks[0]
    expect((await patch({ brief: 'a new brief' })).status).toBe(200)
    const changed = await (await fetch(at('/api/project'))).json()
    expect(changed.summary.music.lists[0].tracks[0].status).toBe('changed')
    expect(await post(path, {}).then((r) => r.json())).toEqual({ ok: true })
    const after = await (await fetch(at('/api/project'))).json()
    expect(after.summary.music.lists[0].tracks[0].status).toBe('chosen')
    // Put the brief back for the tests that follow, and accept it again.
    expect((await patch({ brief: before.brief })).status).toBe(200)
    expect(await post(path, {}).then((r) => r.json())).toEqual({ ok: true })
  })

  it('serves the music clip as a plain file and nothing else of the folder', async () => {
    expect((await fetch(at('/api/music/clips/hall.mp3'))).status).toBe(200)
    expect((await fetch(at('/api/music/clips/manifest.json'))).status).toBe(404)
    expect((await fetch(at('/api/music/clips/nobody.mp3'))).status).toBe(404)
    writeFileSync(join(musicRoot, 'audio/music/.hidden.mp3'), 'x')
    expect((await fetch(at('/api/music/clips/.hidden.mp3'))).status).toBe(404)
    expect((await fetch(at('/api/music/clips/..%2Fhall.mp3'))).status).toBe(404)
    mkdirSync(join(musicRoot, 'audio/music/folder.mp3'))
    expect((await fetch(at('/api/music/clips/folder.mp3'))).status).toBe(404)
    symlinkSync(join(musicRoot, 'audio/music/hall.mp3'), join(musicRoot, 'audio/music/link.mp3'))
    expect((await fetch(at('/api/music/clips/link.mp3'))).status).toBe(404)
  })
})

describe('server, playing what a track plays now', () => {
  const lock = {
    fp: '0123456789abcdef',
    model: 'm',
    seed: 1,
    list: 'act1',
    take: 3,
    inputs: { text: 'x', kind: 'loop', seconds: 5, bpm: null, key: null },
    at: '2026-11-02T10:00:00.000Z',
  }
  const musicRoot = tempRepo({
    'content-studio.json': projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [
      { id: 'game', title: 'G', text: 'x', seconds: 5, file: 'game/walk.mp3' },
      { id: 'gone', title: 'H', text: 'x', seconds: 5, file: 'game/nope.mp3' },
      { id: 'bare', title: 'B', text: 'x', seconds: 5 },
      { id: 'taken', title: 'T', text: 'x', seconds: 5, file: 'game/walk.mp3' },
      { id: 'folder', title: 'F', text: 'x', seconds: 5, file: 'game/dir.mp3' },
    ],
    'tts/act2/music.json': [],
    'tts/stingers.json': [],
    'content-studio/music/lock.json': { taken: lock },
    'audio/music/manifest.json': { taken: { file: 'taken.mp3', duration: 5 } },
    'audio/music/taken.mp3': 'the take',
    'game/walk.mp3': 'the game file',
  })
  mkdirSync(join(musicRoot, 'game/dir.mp3'))
  const studio = startServer({
    projectFile: join(musicRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => studio.stop(true))
  const at = (path: string) => new URL(path, studio.url)
  const current = (id: string) => fetch(at(`/api/music/tracks/${id}/current`))

  it('says what each row plays, and whether it is there', async () => {
    const summary = await (await fetch(at('/api/project'))).json()
    const rows = summary.summary.music.lists[0].tracks as { id: string; current: unknown }[]
    expect(Object.fromEntries(rows.map((r) => [r.id, r.current]))).toEqual({
      game: { kind: 'game', file: 'game/walk.mp3', exists: true },
      gone: { kind: 'game', file: 'game/nope.mp3', exists: false },
      bare: { kind: 'none' },
      taken: { kind: 'take', take: 3, exists: true },
      folder: { kind: 'game', file: 'game/dir.mp3', exists: false },
    })
  })

  it('serves the chosen take, else the game’s file, and nothing else', async () => {
    expect(await (await current('taken')).text()).toBe('the take')
    expect(await (await current('game')).text()).toBe('the game file')
    for (const id of ['gone', 'bare', 'folder', 'nobody'])
      expect((await current(id)).status).toBe(404)
  })

  it('never writes the game’s file', async () => {
    await current('game')
    expect(readFileSync(join(musicRoot, 'game/walk.mp3'), 'utf8')).toBe('the game file')
  })
})

describe('server, removing music the game no longer asks for', () => {
  const musicRoot = tempRepo({
    'content-studio.json': projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
    'tts/act2/music.json': [],
    'tts/stingers.json': [],
    'content-studio/music/lock.json': {
      'castle-gates': {
        fp: '0123456789abcdef',
        model: 'm',
        seed: 1,
        list: 'act1',
        take: 1,
        inputs: { text: 'x', kind: 'loop', seconds: 5, bpm: null, key: null },
        at: '2026-11-02T10:00:00.000Z',
      },
    },
    'audio/music/manifest.json': { 'castle-gates': { file: 'castle-gates.mp3', duration: 5 } },
    'audio/music/castle-gates.mp3': 'mp3',
  })
  const studio = startServer({
    projectFile: join(musicRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => studio.stop(true))
  const at = (path: string) => new URL(path, studio.url)
  const remove = (id: string, origin = studio.url.origin) =>
    fetch(at(`/api/music/tracks/${id}/remove`), { method: 'POST', headers: { origin } })

  it('lists the orphan on its act, and removes it from the studio’s own page only', async () => {
    const before = await (await fetch(at('/api/project'))).json()
    expect(before.summary.music.lists[0].orphans.map((o: { id: string }) => o.id)).toEqual([
      'castle-gates',
    ])
    expect((await remove('castle-gates', 'https://evil.example')).status).toBe(403)
    expect(existsSync(join(musicRoot, 'audio/music/castle-gates.mp3'))).toBe(true)
    // A listed track and an unknown one are not orphans.
    expect((await remove('hall')).status).toBe(404)
    expect((await remove('nobody')).status).toBe(404)
    // A manifest that cannot be read: refused with why, nothing deleted.
    const manifestFile = join(musicRoot, 'audio/music/manifest.json')
    const manifest = readFileSync(manifestFile, 'utf8')
    writeFileSync(manifestFile, '{ nope')
    const refused = await remove('castle-gates')
    expect(refused.status).toBe(409)
    expect((await refused.json()).problems.length).toBeGreaterThan(0)
    expect(existsSync(join(musicRoot, 'audio/music/castle-gates.mp3'))).toBe(true)
    writeFileSync(manifestFile, manifest)
    expect(await (await remove('castle-gates')).json()).toEqual({ ok: true })
    expect(existsSync(join(musicRoot, 'audio/music/castle-gates.mp3'))).toBe(false)
    const after = await (await fetch(at('/api/project'))).json()
    expect(after.summary.music.lists[0].orphans).toEqual([])
    expect((await remove('castle-gates')).status).toBe(404)
  })
})

describe('server, the music model', () => {
  const paths = {
    from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
    clips: 'audio/music',
    manifest: 'audio/music/manifest.json',
  }
  const root = tempRepo({
    'content-studio.json': projectJson({ music: paths }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
  })
  const asked: string[] = []
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    music: {
      ready: () => ({ ok: true }),
      installed: (model) => model !== 'careful',
      async generate(request) {
        asked.push(request.model)
        const samples = new Int16Array(request.seconds * 1000).fill(4000)
        const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
        return { wav: writeWav({ format, data: new Uint8Array(samples.buffer) }), seed: 1 }
      },
      close() {},
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

  it('shows the project’s music model and which models are here', async () => {
    const view = await (await fetch(at('/api/models'))).json()
    expect(view.music).toEqual({
      model: 'balanced',
      installed: {
        balanced: true,
        quick: true,
        quickest: true,
        careful: false,
        short: true,
        shortest: true,
        eleven: true,
      },
      loops: [5],
    })
  })

  it('saves the default from its own page only, and the page then shows it', async () => {
    const body = { model: 'careful', was: 'balanced' }
    expect((await send('PUT', '/api/music/model', body, 'http://evil.test')).status).toBe(403)
    expect((await send('PUT', '/api/music/model', { model: 'careful' })).status).toBe(400)
    const saved = await send('PUT', '/api/music/model', body)
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect((await send('PUT', '/api/music/model', body)).status).toBe(409)
    const view = await (await fetch(at('/api/models'))).json()
    expect(view.music.model).toBe('careful')
    const takes = await (await fetch(at('/api/music/tracks/hall/takes'))).json()
    expect(takes.defaultModel).toBe('careful')
  })

  it('makes takes with the model the page asked for, and refuses one not here', async () => {
    expect(
      (await send('POST', '/api/music/tracks/hall/takes', { count: 1, model: 'huge' })).status,
    ).toBe(400)
    const refused = await send('POST', '/api/music/tracks/hall/takes', {
      count: 1,
      model: 'careful',
    })
    expect(refused.status).toBe(409)
    const made = await send('POST', '/api/music/tracks/hall/takes', { count: 1, model: 'quick' })
    expect(made.status).toBe(200)
    for (let i = 0; i < 100 && !asked.length; i++) await new Promise((r) => setTimeout(r, 10))
    expect(asked).toEqual(['quick'])
  })
})

describe('server, no music model without music', () => {
  it('has no music on the models view', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const studio = startServer({
      projectFile: join(root, 'content-studio.json'),
      port: 0,
      fish,
      encode,
      transcriber: null,
    })
    try {
      const view = await (await fetch(new URL('/api/models', studio.url))).json()
      expect(view.music).toBeNull()
    } finally {
      studio.stop(true)
    }
  })
})

describe('server, moving a take', () => {
  const musicRoot = tempRepo({
    'content-studio.json': projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
    'tts/act2/music.json': [{ id: 'hut', title: 'Hut', text: 'eerie', seconds: 5 }],
  })
  const studio = startServer({
    projectFile: join(musicRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    music: {
      ready: () => ({ ok: true }),
      installed: () => true,
      async generate(request) {
        const samples = new Int16Array(request.seconds * 1000).fill(4000)
        const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
        return {
          wav: writeWav({ format, data: new Uint8Array(samples.buffer) }),
          seed: request.seed,
        }
      },
      close() {},
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

  it('moves a take from the studio’s own page only, and answers its new number', async () => {
    await post('/api/music/tracks/hall/takes', { count: 1 })
    let view = await (await fetch(at('/api/music/tracks/hall/takes'))).json()
    for (let i = 0; i < 300 && (view.making.length || !view.takes.length); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      view = await (await fetch(at('/api/music/tracks/hall/takes'))).json()
    }
    const file = view.takes[0].file
    const path = '/api/music/tracks/hall/move'
    expect((await post(path, { file, to: 'hut' }, 'https://evil.example')).status).toBe(403)
    expect((await post(path, { file })).status).toBe(400)
    expect((await post('/api/music/tracks/nobody/move', { file, to: 'hut' })).status).toBe(404)
    const refused = await post(path, { file, to: 'hall' })
    expect(refused.status).toBe(409)
    expect(await post(path, { file, to: 'hut' }).then((r) => r.json())).toEqual({ ok: true, n: 1 })
    const hut = await (await fetch(at('/api/music/tracks/hut/takes'))).json()
    expect(hut.takes[0].movedFrom).toEqual({ title: 'Hall', n: 1 })
    const hall = await (await fetch(at('/api/music/tracks/hall/takes'))).json()
    expect(hall.takes).toEqual([])
  })
})

describe('server, trimming a stinger take', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
    'tts/stingers.json': [{ id: 'victory', title: 'Victory', text: 'fanfare', seconds: 6 }],
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    music: {
      ready: () => ({ ok: true }),
      installed: () => true,
      async generate(request) {
        // A second of near-silence, sound, a second of near-silence.
        const samples = new Int16Array(request.seconds * 1000)
        samples.forEach((_, i) => {
          samples[i] = i < 1000 || i >= samples.length - 1000 ? 20 : i % 2 ? 4000 : -4000
        })
        const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
        return {
          wav: writeWav({ format, data: new Uint8Array(samples.buffer) }),
          seed: request.seed,
        }
      },
      close() {},
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
    await post('/api/music/tracks/victory/takes', { count: 1 })
    let view = await (await fetch(at('/api/music/tracks/victory/takes'))).json()
    for (let i = 0; i < 300 && (view.making.length || !view.takes.length); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      view = await (await fetch(at('/api/music/tracks/victory/takes'))).json()
    }
    const file = view.takes[0].file
    expect(view.takes[0].trimmable).toBe('cut')
    const path = '/api/music/tracks/victory/trim'
    expect((await post(path, { file }, 'https://evil.example')).status).toBe(403)
    expect((await post(path, { nope: 1 })).status).toBe(400)
    expect((await post('/api/music/tracks/nobody/trim', { file })).status).toBe(404)
    expect((await post(path, { file: '0123456789abcdef.9.wav' })).status).toBe(409)
    expect(await post(path, { file }).then((r) => r.json())).toEqual({ ok: true })
    const after = await (await fetch(at('/api/music/tracks/victory/takes'))).json()
    expect(after.takes[0].trim.seconds).toBeCloseTo(5.05, 3)
    const base = `/api/music/tracks/victory/takes/${file}`
    const whole = await (await fetch(at(base))).arrayBuffer()
    const part = await (await fetch(at(`${base}?trimmed=1`))).arrayBuffer()
    expect(part.byteLength).toBeLessThan(whole.byteLength)
    expect(await post(path, { file, undo: true }).then((r) => r.json())).toEqual({ ok: true })
    const undone = await (await fetch(at(`${base}?trimmed=1`))).arrayBuffer()
    expect(undone.byteLength).toBe(whole.byteLength)
  })

  it('serves a trimmed take with the fades asked for over the part between the cuts, once', async () => {
    const view = await (await fetch(at('/api/music/tracks/victory/takes'))).json()
    const file = view.takes[0].file
    await post('/api/music/tracks/victory/trim', { file })
    const base = `/api/music/tracks/victory/takes/${file}`
    const read = async (query: string) => {
      const wav = readWav(new Uint8Array(await (await fetch(at(`${base}${query}`))).arrayBuffer()))
      return new Int16Array(wav.data.buffer, wav.data.byteOffset, wav.data.length / 2)
    }
    const plain = await read('?trimmed=1')
    const faded = await read('?trimmed=1&fadeIn=0.5&fadeOut=0&shape=straight')
    expect(faded.length).toBe(plain.length)
    expect(faded[0]).toBe(0)
    expect(Math.abs(faded[250]!)).toBeLessThan(Math.abs(plain[250]!))
    // Past the fade it is the cut sound as it was, so the fades were applied once.
    expect(faded[1000]).toBe(plain[1000])
  })
})

describe('server, a stinger take’s fades', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
    'tts/stingers.json': [{ id: 'victory', title: 'Victory', text: 'fanfare', seconds: 4 }],
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    music: {
      ready: () => ({ ok: true }),
      installed: () => true,
      async generate(request) {
        const samples = new Int16Array(request.seconds * 1000).fill(4000)
        const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
        return {
          wav: writeWav({ format, data: new Uint8Array(samples.buffer) }),
          seed: request.seed,
        }
      },
      close() {},
    },
  })
  afterAll(() => studio.stop(true))
  const at = (path: string) => new URL(path, studio.url)
  const send = (method: string, path: string, body?: unknown, origin = studio.url.origin) =>
    fetch(at(path), {
      method,
      headers: { origin, 'content-type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
  const fades = { in: 0.5, out: 1, shape: 'straight' }

  async function oneTake(id: string) {
    await send('POST', `/api/music/tracks/${id}/takes`, { count: 1 })
    let view = await (await fetch(at(`/api/music/tracks/${id}/takes`))).json()
    for (let i = 0; i < 300 && (view.making.length || !view.takes.length); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      view = await (await fetch(at(`/api/music/tracks/${id}/takes`))).json()
    }
    return view.takes[0].file as string
  }

  it('saves and removes fades from the studio’s own page only, and shows them on the take', async () => {
    const file = await oneTake('victory')
    const path = `/api/music/tracks/victory/takes/${file}/fades`
    expect((await send('PUT', path, fades, 'https://evil.example')).status).toBe(403)
    expect((await send('PUT', path, { in: -1, out: 0, shape: 'smooth' })).status).toBe(400)
    expect((await send('PUT', path, { in: 'x' })).status).toBe(400)
    expect((await send('PUT', `/api/music/tracks/nobody/takes/${file}/fades`, fades)).status).toBe(
      404,
    )
    expect((await send('PUT', path, { in: 3, out: 3, shape: 'smooth' })).status).toBe(409)
    expect(await send('PUT', path, fades).then((r) => r.json())).toEqual({ ok: true })
    const view = await (await fetch(at('/api/music/tracks/victory/takes'))).json()
    expect(view.takes[0].fades).toEqual(fades)
    expect((await send('DELETE', path, undefined, 'https://evil.example')).status).toBe(403)
    expect(await send('DELETE', path).then((r) => r.json())).toEqual({ ok: true })
    const after = await (await fetch(at('/api/music/tracks/victory/takes'))).json()
    expect(after.takes[0].fades).toBeUndefined()
  })

  it('serves a take with the fades asked for in the address, to hear them before saving', async () => {
    const file = await oneTake('victory')
    const url = `/api/music/tracks/victory/takes/${file}`
    const faded = readWav(
      new Uint8Array(
        await (await fetch(at(`${url}?fadeIn=0.5&fadeOut=1&shape=straight`))).arrayBuffer(),
      ),
    )
    const samples = new Int16Array(faded.data.buffer, faded.data.byteOffset, faded.data.length / 2)
    expect(samples[0]).toBe(0)
    expect(samples[samples.length - 1]).toBe(0)
    expect(samples[2000]).toBe(4000)
    expect((await fetch(at(`${url}?fadeIn=-1&fadeOut=1&shape=straight`))).status).toBe(400)
    expect((await fetch(at(`${url}?fadeIn=1&shape=wavy`))).status).toBe(400)
  })
})

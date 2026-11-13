import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { NO_ELEVENLABS_KEY } from '../services/elevenlabs'
import { allowedHosts, startServer } from './index'
import { startBase } from './test-support'

const { root, server, url, post } = startBase()

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
    expect(existsSync(join(root, 'content-studio/narration/act1.lock.json'))).toBe(false)
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
    expect(existsSync(join(root, 'content-studio/narration/act1.lock.json'))).toBe(true)
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
    const cast = JSON.parse(readFileSync(join(root, 'content-studio/narration/cast.json'), 'utf8'))
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
    const cast = JSON.parse(readFileSync(join(root, 'content-studio/narration/cast.json'), 'utf8'))
    expect(cast.speakers.narrator.audition.phrase).toBe('Once upon a time.')
  })

  it('saves a character’s style, which marks its recorded lines stale', async () => {
    const response = await fetch(url('/api/characters/narrator'), {
      method: 'PATCH',
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ style: '[grave]' }),
    })
    expect(response.status).toBe(200)
    const cast = JSON.parse(readFileSync(join(root, 'content-studio/narration/cast.json'), 'utf8'))
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
    let cast = JSON.parse(readFileSync(join(root, 'content-studio/narration/cast.json'), 'utf8'))
    expect(cast.speakers.narrator.speed).toBe(1.2)
    const summary = await (await fetch(url('/api/project'))).json()
    expect(summary.summary.characters.find((c: { id: string }) => c.id === 'narrator').speed).toBe(
      1.2,
    )
    expect((await patch({ speed: null })).status).toBe(200)
    cast = JSON.parse(readFileSync(join(root, 'content-studio/narration/cast.json'), 'utf8'))
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
    writeFileSync(
      join(root, 'content-studio/narration/act1.edits.json'),
      '{\n  "cues": {\n    "gone": "[sad]"\n  },\n  "scenes": {}\n}\n',
    )
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
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toBe(
      '{\n  "cues": {\n    "a": "[sad]"\n  },\n  "scenes": {}\n}\n',
    )
    expect((await move(null)).status).toBe(404)
    writeFileSync(
      join(root, 'content-studio/narration/act1.edits.json'),
      '{\n  "cues": {},\n  "scenes": {}\n}\n',
    )
  })

  it('checks the setup', async () => {
    const body = await (await fetch(url('/api/setup'))).json()
    expect(body.ok).toBe(true)
    const states = Object.fromEntries(
      body.checks.map((c: { id: string; state: string }) => [c.id, c.state]),
    )
    // No key in this fixture: Fish is not asked. The tools depend on the machine running the tests.
    expect(states).toMatchObject({ key: 'problem', fish: 'off', refresh: 'off' })
    expect(Object.keys(states)).toEqual([
      'ffmpeg',
      'whisper',
      'key',
      'fish',
      'requests',
      'refresh',
      'music',
      'stableAudio',
      'imageModels',
      'effectModels',
      'elevenlabsKey',
      'elevenlabs',
    ])
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

  it('saves and moves a scene’s cue, from the studio’s own page only', async () => {
    const send = (path: string, method: string, body: unknown, origin = server.url.origin) =>
      fetch(url(path), {
        method,
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const script = readFileSync(join(root, 'tts/act1/script.json'), 'utf8')
    writeFileSync(
      join(root, 'tts/act1/script.json'),
      JSON.stringify([{ id: 'a', speaker: 'narrator', text: 'Once.', scene: 'Old Cave' }]),
    )
    const save = (body: unknown, origin?: string) =>
      send('/api/parts/act1/scene-cues', 'PATCH', body, origin)
    expect((await save({ scene: 'Old Cave', cue: '[dark]' }, 'https://evil.example')).status).toBe(
      403,
    )
    expect((await save({ scene: 'Old Cave', cue: 3 })).status).toBe(400)
    expect((await save({ scene: 'Nowhere', cue: '[dark]' })).status).toBe(404)
    expect((await save({ scene: 'Old Cave', cue: '[dark]' })).status).toBe(200)
    const part = await (await fetch(url('/api/parts/act1'))).json()
    expect(part.part.lines[0]).toMatchObject({ cue: '[dark]', cueFrom: 'scene', scene: 'Old Cave' })
    expect(part.part.scenes[0]).toMatchObject({ name: 'Old Cave', cue: '[dark]', cueFrom: 'own' })
    expect(part.part.sceneCueSpeakers).toEqual(['narrator'])

    writeFileSync(
      join(root, 'tts/act1/script.json'),
      JSON.stringify([{ id: 'a', speaker: 'narrator', text: 'Once.', scene: 'Cave' }]),
    )
    const move = (to: string | null, origin?: string) =>
      send('/api/parts/act1/scene-cues/move', 'POST', { from: 'Old Cave', to }, origin)
    expect((await move('Cave', 'https://evil.example')).status).toBe(403)
    expect((await send('/api/parts/act1/scene-cues/move', 'POST', { to: 3 })).status).toBe(400)
    const after = await (await fetch(url('/api/parts/act1'))).json()
    expect(after.part.orphanCues).toEqual([{ key: 'scene:Old Cave', cue: '[dark]' }])
    expect((await move('Cave')).status).toBe(200)
    expect((await move(null)).status).toBe(404)
    expect(readFileSync(join(root, 'content-studio/narration/act1.edits.json'), 'utf8')).toBe(
      '{\n  "cues": {},\n  "scenes": {\n    "Cave": "[dark]"\n  }\n}\n',
    )
    writeFileSync(join(root, 'tts/act1/script.json'), script)
    writeFileSync(
      join(root, 'content-studio/narration/act1.edits.json'),
      '{\n  "cues": {},\n  "scenes": {}\n}\n',
    )
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

  it('makes no board take of an ElevenLabs voice without a key, and refuses one for casting a voice made from recordings', async () => {
    const send = (path: string, body: unknown) =>
      fetch(url(path), {
        method: 'POST',
        headers: { origin: server.url.origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const voice = 'eleven:abc'
    expect(
      (await send('/api/characters/narrator/cast-voice', { voice, name: 'Mine' })).status,
    ).toBe(400)
    const board = await send('/api/characters/narrator/takes', { voice, board: true })
    expect([board.status, await board.json()]).toEqual([
      200,
      // This studio has no ElevenLabs key; with one, a board take without credits is refused too.
      { ok: false, reason: 'no-key', message: NO_ELEVENLABS_KEY },
    ])
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
    await send('POST', '/api/auditions/narrator/more')
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
    // An ElevenLabs voice's id is one too: nothing of it was ruled out, so nothing changes.
    const eleven = await send('DELETE', '/api/characters/narrator/ruled-out/eleven%3Aabc')
    expect(eleven.status).toBe(200)
    expect(await eleven.json()).toEqual({ ok: true, voices: [] })
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
    const empty = await (await post('/api/auditions/narrator/start')).json()
    expect(empty.session.toHear).toEqual([])
    const started = await (await post('/api/auditions/narrator/more')).json()
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
    const saved = JSON.parse(readFileSync(join(root, 'content-studio/narration/cast.json'), 'utf8'))
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
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': '{ broken',
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const other = startServer({
    projectFile: join(broken, 'content-studio.json'),
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
    expect(readFileSync(join(broken, 'content-studio/narration/cast.json'), 'utf8')).toBe(
      '{ broken',
    )
  })

  it('reports the broken cast when asked for the voice', async () => {
    const body = await (await fetch(new URL('/api/characters/narrator/voice', other.url))).json()
    expect(body.ok).toBe(false)
    expect(body.problems[0].file).toBe('content-studio/narration/cast.json')
  })
})

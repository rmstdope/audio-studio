import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { startServer } from './index'
import { encode, fish } from './test-support'

describe('server, saving a scene', () => {
  const mix = 'game/scenes/act1.mix.json'
  const entry = (level: number) => ({
    music: { track: null, level },
    effects: [{ id: 'coins', play: { mode: 'loop' }, level }],
  })
  const sceneRoot = tempRepo({
    'content-studio.json': projectJson({
      scenes: {
        from: { part: 'tts/{part}/scenes.json' },
        mix: 'game/scenes/{part}.mix.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/scenes.json': [{ id: 'store', title: 'Store', states: [], triggers: [] }],
  })
  const studio = startServer({
    projectFile: join(sceneRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => studio.stop(true))
  const put = (path: string, body?: unknown, origin = studio.url.origin) =>
    fetch(new URL(path, studio.url), {
      method: 'PUT',
      headers: { origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('saves from the studio’s own page only', async () => {
    const body = { scene: entry(1), was: null }
    expect((await put('/api/scenes/act1/store', body, 'https://evil.example')).status).toBe(403)
    expect(existsSync(join(sceneRoot, mix))).toBe(false)
    const saved = await put('/api/scenes/act1/store', body)
    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect(JSON.parse(readFileSync(join(sceneRoot, mix), 'utf8')).scenes.store).toEqual(entry(1))
  })

  it('takes the move of the loudness figures with a save, and nothing else extra', async () => {
    const moved = { db: 4, measuredAt: '2026-11-05T14:02:00.000Z' }
    const file = join(sceneRoot, mix)
    const was = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).scenes.store : null
    const ok = await put('/api/scenes/act1/store', { scene: entry(1), was, moved })
    expect(ok.status).toBe(200)
    const bad = await put('/api/scenes/act1/store', {
      scene: entry(1),
      was,
      moved: { ...moved, extra: 1 },
    })
    expect(bad.status).toBe(400)
  })

  it('answers 409 with what is saved when the page’s copy is stale', async () => {
    const stale = await put('/api/scenes/act1/store', { scene: entry(2), was: null })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ ok: false, kind: 'stale', current: entry(1) })
    expect((await put('/api/scenes/act1/store', { scene: entry(2), was: entry(1) })).status).toBe(
      200,
    )
  })

  it('answers 400 for a body that is not a scene and 404 for an unknown scene or act', async () => {
    expect((await put('/api/scenes/act1/store', { scene: { effects: 1 }, was: null })).status).toBe(
      400,
    )
    expect((await put('/api/scenes/act1/store', { nonsense: 1 })).status).toBe(400)
    expect((await put('/api/scenes/act1/nope', { scene: entry(1), was: null })).status).toBe(404)
    expect((await put('/api/scenes/act9/store', { scene: entry(1), was: null })).status).toBe(404)
  })

  it('shows the saved scene in the project summary', async () => {
    const body = await (await fetch(new URL('/api/project', studio.url))).json()
    const scene = body.summary.scenes.acts[0].scenes[0]
    expect(scene.effects.map((e: { level: number }) => e.level)).toEqual([2])
  })
})

describe('server, measuring the loudness of scenes', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      scenes: {
        from: { part: 'tts/{part}/scenes.json' },
        mix: 'game/scenes/{part}.mix.json',
        output: { lufs: -20, tolerance: 2 },
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/scenes.json': [{ id: 'store', title: 'Store', states: [], triggers: [] }],
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => studio.stop(true))
  const post = (path: string, body?: unknown, origin = studio.url.origin) =>
    fetch(new URL(path, studio.url), {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('starts from the studio’s own page only', async () => {
    expect((await post('/api/scene-loudness/act1', {}, 'https://evil.example')).status).toBe(403)
    expect(existsSync(join(root, 'content-studio/scenes/act1.lock.json'))).toBe(false)
  })

  it('answers 404 for an act it does not know and 400 for a body that is not an open scene', async () => {
    expect((await post('/api/scene-loudness/act9', {})).status).toBe(404)
    expect((await post('/api/scene-loudness/act1', { open: { scene: 'store' } })).status).toBe(400)
  })

  it('measures the act, which shows with the project and then is no longer being made', async () => {
    const started = await post('/api/scene-loudness/act1', {
      open: { scene: 'store', entry: { effects: [] } },
    })
    expect([started.status, await started.json()]).toEqual([200, { ok: true }])
    const file = join(root, 'content-studio/scenes/act1.lock.json')
    for (let i = 0; i < 100 && !existsSync(file); i++) await Bun.sleep(20)
    const kept = JSON.parse(readFileSync(file, 'utf8'))
    expect(kept.store.draft.states).toEqual([{ state: null, lufs: null }])
    for (let i = 0; i < 100; i++) {
      const making = await (await fetch(new URL('/api/scene-loudness', studio.url))).json()
      if (Object.keys(making).length === 0) break
      await Bun.sleep(20)
    }
    const body = await (await fetch(new URL('/api/project', studio.url))).json()
    expect(body.summary.scenes.loudnessTarget).toEqual({ target: -20, tolerance: 2 })
    expect(body.summary.scenes.acts[0].scenes[0].loudness.draft.entry).toEqual({ effects: [] })
  })
})

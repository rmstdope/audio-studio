import { afterAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { FishError } from '../services/fish'
import { startServer } from './index'
import { encode, fish } from './test-support'

describe('cloning a voice', () => {
  const repo = tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const made: { title: FormDataEntryValue | null; names: string[] }[] = []
  const cloning = startServer({
    projectFile: join(repo, 'content-studio.json'),
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
    const cast = JSON.parse(readFileSync(join(repo, 'content-studio/narration/cast.json'), 'utf8'))
    expect(cast.speakers.narrator).toMatchObject({ voice: 'f'.repeat(32), voiceName: 'Nora' })
  })
})

describe('designing a voice', () => {
  const repo = tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const asked: string[] = []
  const saved: string[] = []
  let credit: number | Error = 25
  const designing = startServer({
    projectFile: join(repo, 'content-studio.json'),
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
    expect(await last.json()).toMatchObject({ ok: true, description: 'an old woman' })
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
    const file = JSON.parse(readFileSync(join(repo, 'content-studio/narration/cast.json'), 'utf8'))
    expect(file.speakers.narrator.voice).toBe('f'.repeat(32))
  })
})

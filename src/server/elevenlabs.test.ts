import { afterAll, describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeWav } from '../core/wav'
import { elevenVoiceOf, fakeEleven, projectJson, tempRepo } from '../../test/helpers'
import { type ElevenLabsClient } from '../services/elevenlabs'
import { type FishClient } from '../services/fish'
import { startServer } from './index'
import { encode, fish } from './test-support'

describe('the ElevenLabs account on Setup', () => {
  const elevenRoot = tempRepo({
    'content-studio.json': projectJson(),
    '.env': 'ELEVENLABS_API_KEY=k\n',
  })
  const starter = {
    tier: 'starter',
    charactersUsed: 2550,
    characterLimit: 30000,
    renewsAt: null,
    overage: 0,
    voiceSlots: { used: 3, limit: 10 },
  }
  const unused = async (): Promise<never> => {
    throw new Error('not used')
  }
  const setupOf = async (elevenlabs: ElevenLabsClient) => {
    const server = startServer({
      projectFile: join(elevenRoot, 'content-studio.json'),
      port: 0,
      fish,
      elevenlabs,
    })
    try {
      const body = await (await fetch(new URL('/api/setup', server.url))).json()
      return body.checks.find((c: { id: string }) => c.id === 'elevenlabs')
    } finally {
      server.stop(true)
    }
  }

  it('shows the plan and the characters left', async () => {
    expect(
      await setupOf({
        subscription: async () => starter,
        sharedVoices: () => Promise.reject(new Error('not used')),
        addSharedVoice: () => Promise.reject(new Error('not used')),
        deleteVoice: () => Promise.reject(new Error('not used')),
        designVoices: () => Promise.reject(new Error('not used')),
        saveDesignedVoice: () => Promise.reject(new Error('not used')),
        music: unused,
        tts: unused,
        voice: unused,
      }),
    ).toMatchObject({
      state: 'ok',
      detail: 'Answers. Starter plan: 27,450 of 30,000 credits left.',
    })
  })

  it('treats no ElevenLabs client as no key, and asks nothing', async () => {
    const server = startServer({
      projectFile: join(elevenRoot, 'content-studio.json'),
      port: 0,
      fish,
      elevenlabs: null,
    })
    try {
      const body = await (await fetch(new URL('/api/setup', server.url))).json()
      expect(body.checks.find((c: { id: string }) => c.id === 'elevenlabs')).toMatchObject({
        state: 'off',
      })
    } finally {
      server.stop(true)
    }
  })

  it('says why when ElevenLabs does not answer', async () => {
    const check = await setupOf({
      subscription: async () => {
        throw new Error('ElevenLabs answered 401: Invalid API key')
      },
      sharedVoices: () => Promise.reject(new Error('not used')),
      addSharedVoice: () => Promise.reject(new Error('not used')),
      deleteVoice: () => Promise.reject(new Error('not used')),
      designVoices: () => Promise.reject(new Error('not used')),
      saveDesignedVoice: () => Promise.reject(new Error('not used')),
      music: unused,
      tts: unused,
      voice: unused,
    })
    expect(check).toMatchObject({
      state: 'problem',
      detail: 'Did not answer: ElevenLabs answered 401: Invalid API key',
    })
  })
})

describe('casting an ElevenLabs voice', () => {
  const elevenRoot = tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const { client: eleven, asked } = fakeEleven({ g1: elevenVoiceOf('g1') })
  const elevenServer = startServer({
    projectFile: join(elevenRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    elevenlabs: eleven,
  })
  afterAll(() => elevenServer.stop(true))
  const send = (path: string, body?: unknown) =>
    fetch(new URL(path, elevenServer.url), {
      method: 'POST',
      headers: { origin: elevenServer.url.origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('brings one in by id, shortlists and casts it, and shows it as ElevenLabs knows it', async () => {
    expect((await send('/api/auditions/narrator/start')).status).toBe(200)
    const added = await (await send('/api/auditions/narrator/add', { voice: 'eleven:g1' })).json()
    expect(added).toMatchObject({ ok: true, session: { toHear: ['eleven:g1'] } })
    expect(asked).toEqual(['g1'])
    const moved = await send('/api/auditions/narrator/move', {
      voice: 'eleven:g1',
      move: 'shortlist',
    })
    expect(moved.status).toBe(200)
    const cast = await send('/api/auditions/narrator/cast', { voice: 'eleven:g1' })
    expect(await cast.json()).toMatchObject({
      ok: true,
      voice: { id: 'eleven:g1', name: 'George' },
    })
    const file = JSON.parse(
      readFileSync(join(elevenRoot, 'content-studio/narration/cast.json'), 'utf8'),
    )
    expect(file.speakers.narrator.voice).toBe('eleven:g1')
    const page = await (
      await fetch(new URL('/api/characters/narrator/voice', elevenServer.url))
    ).json()
    expect(page).toMatchObject({
      ok: true,
      id: 'eleven:g1',
      voice: { title: 'George' },
      lookup: null,
    })
  })
})

describe('recording an ElevenLabs voice’s lines', () => {
  const account = {
    tier: 'starter',
    charactersUsed: 29_000,
    characterLimit: 30_000,
    renewsAt: null,
    overage: 0,
    voiceSlots: { used: 1, limit: 10 },
  }
  /** A part with the narrator on ElevenLabs and Mira on Fish, and a server for it. */
  function studio(
    left = account,
    { gate, fishCredit, draft }: { gate?: Promise<void>; fishCredit?: number; draft?: string } = {},
  ) {
    const where = tempRepo({
      'content-studio.json': draft
        ? projectJson({
            narration: {
              ...(projectJson().narration as object),
              models: { fish: { audition: 's2.1-pro-free', draft, final: draft } },
            },
          })
        : projectJson(),
      'content-studio/narration/cast.json': {
        speakers: { narrator: { voice: 'eleven:g1' }, mira: { voice: 'w1' } },
        pronounce: {},
      },
      'tts/act1/script.json': [
        { id: 'a', speaker: 'narrator', text: 'Once.' },
        { id: 'b', speaker: 'mira', text: 'Twice.' },
      ],
    })
    let spokenSoFar = 0
    const eleven = fakeEleven(
      {},
      {
        account: left,
        // Only the first speech waits for the gate, so later ones can run while it holds.
        speak: async () => {
          if (spokenSoFar++ === 0) await gate
          return writeWav({
            format: { channels: 1, sampleRate: 1000, bitsPerSample: 16 },
            data: new Uint8Array(2000),
          })
        },
      },
    )
    const fishAsked: string[] = []
    const watching: FishClient = {
      ...fish,
      tts: (request) => (fishAsked.push(request.voice), fish.tts(request)),
      ...(fishCredit === undefined ? {} : { credit: async () => fishCredit }),
    }
    let accountAsked = 0
    const counted: ElevenLabsClient = {
      ...eleven.client,
      subscription: () => (accountAsked++, eleven.client.subscription()),
    }
    const running = startServer({
      projectFile: join(where, 'content-studio.json'),
      port: 0,
      fish: watching,
      encode,
      transcriber: null,
      elevenlabs: counted,
    })
    const post = (path: string, body: unknown = {}) =>
      fetch(new URL(path, running.url), {
        method: 'POST',
        headers: { origin: running.url.origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const get = async (path: string) => (await fetch(new URL(path, running.url))).json()
    return { running, post, get, eleven, fishAsked, accountAsked: () => accountAsked }
  }

  it('plans the ElevenLabs lines in credits, with what is left of the plan', async () => {
    const { running, get } = studio()
    try {
      const planned = await get('/api/parts/act1/plan')
      // "Once." is five characters, a credit each, up to three takes.
      expect(planned.plan.eleven).toEqual({
        keys: ['a'],
        model: 'eleven_v3',
        characters: 5,
        credits: 5,
        ceiling: 15,
      })
      expect(planned.plan.keys).toEqual(['a', 'b'])
      expect(planned.elevenAccount).toEqual({ ok: true, account })
    } finally {
      running.stop(true)
    }
  })

  it('records a line only with its credits confirmed and covered, by ElevenLabs alone', async () => {
    const { running, post, eleven, fishAsked } = studio()
    try {
      const unconfirmed = await post('/api/parts/act1/lines/a/record')
      expect(unconfirmed.status).toBe(409)
      expect(await unconfirmed.json()).toMatchObject({ reason: 'confirm-credits', ceiling: 15 })
      const recorded = await post('/api/parts/act1/lines/a/record', { confirmedCredits: 15 })
      expect(await recorded.json()).toMatchObject({ ok: true, key: 'a' })
      expect(eleven.spoken.map((r) => [r.voice, r.text])).toEqual([['g1', 'Once.']])
      expect(fishAsked).toEqual([])
    } finally {
      running.stop(true)
    }
  })

  it('refuses credits the plan has not got left', async () => {
    const { running, post, eleven } = studio({ ...account, charactersUsed: 29_990 })
    try {
      const refused = await post('/api/parts/act1/lines/a/record', { confirmedCredits: 15 })
      expect(refused.status).toBe(409)
      expect(await refused.json()).toMatchObject({
        reason: 'credits',
        message:
          'This takes up to 15 credits, more than the 10 credits left on your ElevenLabs plan.',
      })
      expect(eleven.spoken).toEqual([])
    } finally {
      running.stop(true)
    }
  })

  it('records a part with both providers, each confirmed in its own unit', async () => {
    const { running, post, get, eleven, fishAsked } = studio()
    try {
      const body = { kind: 'record', speaker: null, keys: ['a', 'b'], orphans: [] }
      const unconfirmed = await post('/api/parts/act1/jobs', body)
      expect(unconfirmed.status).toBe(409)
      const started = await post('/api/parts/act1/jobs', { ...body, confirmedCredits: 15 })
      expect(started.status).toBe(200)
      const { id } = await started.json()
      let job = await get(`/api/jobs/${id}`)
      for (let i = 0; i < 100 && job.status === 'running'; i++) {
        await Bun.sleep(20)
        job = await get(`/api/jobs/${id}`)
      }
      expect(job).toMatchObject({ status: 'done', failed: [] })
      expect(eleven.spoken.map((r) => r.text)).toEqual(['Once.'])
      expect(fishAsked).toEqual(['w1'])
    } finally {
      running.stop(true)
    }
  })

  it('takes a line again with its credits confirmed', async () => {
    const { running, post, eleven } = studio()
    try {
      const unconfirmed = await post('/api/parts/act1/lines/a/takes')
      expect(await unconfirmed.json()).toMatchObject({ reason: 'confirm-credits', ceiling: 5 })
      const taken = await post('/api/parts/act1/lines/a/takes', { confirmedCredits: 5 })
      expect(await taken.json()).toMatchObject({ ok: true })
      expect(eleven.spoken).toHaveLength(1)
    } finally {
      running.stop(true)
    }
  })

  it('reads the account for the plan at most every half minute, and shows what recordings hold', async () => {
    let open = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    const { running, post, get, accountAsked } = studio({ ...account, charactersUsed: 0 }, { gate })
    try {
      await get('/api/parts/act1/plan')
      const recording = post('/api/parts/act1/lines/a/record', { confirmedCredits: 15 })
      await Bun.sleep(50)
      const planned = await get('/api/parts/act1/plan')
      expect(accountAsked()).toBe(2) // the plans' one, and the recording's own
      expect(planned.elevenHeld).toBe(15)
      open()
      expect(await (await recording).json()).toMatchObject({ ok: true })
      expect((await get('/api/parts/act1/plan')).elevenHeld ?? 0).toBe(0)
    } finally {
      running.stop(true)
    }
  })

  it('gives the credits back when a recording, a take or a job ends', async () => {
    // Twenty credits left: room for one line's fifteen at a time, never two.
    const { running, post, get } = studio({ ...account, charactersUsed: 29_980 })
    try {
      const body = { kind: 'record', speaker: 'narrator', keys: ['a'], orphans: [] }
      const started = await post('/api/parts/act1/jobs', { ...body, confirmedCredits: 15 })
      expect(started.status).toBe(200)
      const { id } = await started.json()
      let job = await get(`/api/jobs/${id}`)
      for (let i = 0; i < 100 && job.status === 'running'; i++) {
        await Bun.sleep(20)
        job = await get(`/api/jobs/${id}`)
      }
      expect(job).toMatchObject({ status: 'done', failed: [] })
      for (let i = 0; i < 2; i++) {
        const recorded = await post('/api/parts/act1/lines/a/record', { confirmedCredits: 15 })
        expect(await recorded.json()).toMatchObject({ ok: true })
        const taken = await post('/api/parts/act1/lines/a/takes', { confirmedCredits: 5 })
        expect(await taken.json()).toMatchObject({ ok: true })
      }
    } finally {
      running.stop(true)
    }
  })

  it('gives the credits back when a job cannot start, another running for the part', async () => {
    let open = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    // Forty left: the running job's fifteen, and room for one more fifteen, not two.
    const { running, post } = studio({ ...account, charactersUsed: 29_960 }, { gate })
    try {
      const body = { kind: 'record', speaker: 'narrator', keys: ['a'], orphans: [] }
      const first = await post('/api/parts/act1/jobs', { ...body, confirmedCredits: 15 })
      expect(first.status).toBe(200)
      const second = await post('/api/parts/act1/jobs', { ...body, confirmedCredits: 15 })
      expect(second.status).toBe(409)
      const recording = post('/api/parts/act1/lines/a/record', { confirmedCredits: 15 })
      await Bun.sleep(50)
      open()
      expect(await (await recording).json()).toMatchObject({ ok: true })
    } finally {
      open()
      running.stop(true)
    }
  })

  it('never lets two recordings count on the same credits', async () => {
    let open = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    const { running, post } = studio({ ...account, charactersUsed: 29_980 }, { gate })
    try {
      const first = post('/api/parts/act1/lines/a/record', { confirmedCredits: 15 })
      await Bun.sleep(50)
      // The first holds 15 of the 20: another 15 is refused, while 5 still fits.
      const second = await post('/api/parts/act1/lines/a/record', { confirmedCredits: 15 })
      expect(await second.json()).toMatchObject({ reason: 'credits' })
      const third = await post('/api/parts/act1/lines/a/takes', { confirmedCredits: 5 })
      expect(await third.json()).toMatchObject({ ok: true })
      open()
      expect(await (await first).json()).toMatchObject({ ok: true })
    } finally {
      open()
      running.stop(true)
    }
  })

  it('gives the Fish dollars back when the credits are refused', async () => {
    // Fish's credit covers one admission of Mira's line on s2-pro, never two held at once.
    const { running, post, get } = studio(
      { ...account, charactersUsed: 30_000 },
      { fishCredit: 0.0004, draft: 's2-pro' },
    )
    try {
      const planned = await get('/api/parts/act1/plan')
      const dollars = planned.plan.ceiling
      const body = { kind: 'record', speaker: null, keys: ['a', 'b'], orphans: [] }
      const refused = await post('/api/parts/act1/jobs', {
        ...body,
        confirmedCost: dollars,
        confirmedCredits: 15,
      })
      expect(await refused.json()).toMatchObject({ reason: 'credits' })
      const fishOnly = await post('/api/parts/act1/lines/b/record', { confirmedCost: dollars })
      expect(await fishOnly.json()).toMatchObject({ ok: true, key: 'b' })
    } finally {
      running.stop(true)
    }
  })
})

describe('a final recording on ElevenLabs’ side only', () => {
  const where = tempRepo({
    'content-studio.json': projectJson({
      narration: {
        ...(projectJson().narration as object),
        models: { elevenlabs: { final: 'eleven_multilingual_v2' } },
      },
    }),
    'content-studio/narration/cast.json': {
      speakers: { narrator: { voice: 'eleven:g1' } },
      pronounce: {},
    },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const running = startServer({
    projectFile: join(where, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    elevenlabs: null,
  })
  afterAll(() => running.stop(true))

  it('is planned with ElevenLabs’ final model, though Fish’s stages are one', async () => {
    const plan = await (
      await fetch(new URL('/api/parts/act1/plan?stage=final', running.url))
    ).json()
    expect(plan).toMatchObject({
      ok: true,
      stage: 'final',
      plan: { final: true, keys: ['a'], eleven: { model: 'eleven_multilingual_v2' } },
    })
  })

  it('takes an up-to-date line again with its stage’s ElevenLabs model', async () => {
    const draftOnFlash = tempRepo({
      'content-studio.json': projectJson({
        narration: {
          ...(projectJson().narration as object),
          models: { elevenlabs: { draft: 'eleven_flash_v2_5', final: 'eleven_flash_v2_5' } },
        },
      }),
      'content-studio/narration/cast.json': {
        speakers: { narrator: { voice: 'eleven:g1' } },
        pronounce: {},
      },
      'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
    })
    const eleven = fakeEleven(
      {},
      {
        account: {
          tier: 'starter',
          charactersUsed: 0,
          characterLimit: 30_000,
          renewsAt: null,
          overage: 0,
          voiceSlots: { used: 0, limit: 10 },
        },
        speak: () =>
          writeWav({
            format: { channels: 1, sampleRate: 1000, bitsPerSample: 16 },
            data: new Uint8Array(2000),
          }),
      },
    )
    const flash = startServer({
      projectFile: join(draftOnFlash, 'content-studio.json'),
      port: 0,
      fish,
      encode,
      transcriber: null,
      elevenlabs: eleven.client,
    })
    try {
      const post = (path: string, body: unknown) =>
        fetch(new URL(path, flash.url), {
          method: 'POST',
          headers: { origin: flash.url.origin, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      // Five characters at half a credit, up to three takes.
      const recorded = await post('/api/parts/act1/lines/a/record', { confirmedCredits: 8 })
      expect(await recorded.json()).toMatchObject({ ok: true })
      const taken = await post('/api/parts/act1/lines/a/takes', { confirmedCredits: 3 })
      expect(await taken.json()).toMatchObject({ ok: true })
      expect(eleven.spoken.map((r) => r.model)).toEqual(['eleven_flash_v2_5', 'eleven_flash_v2_5'])
    } finally {
      flash.stop(true)
    }
  })
})

describe('takes and tries with an ElevenLabs voice', () => {
  const elevenRoot = tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': {
      speakers: { narrator: { voice: 'eleven:g1', style: '[warm]' } },
    },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2])
  const { client: eleven, spoken } = fakeEleven({ g1: elevenVoiceOf('g1') }, { speak: () => wav })
  const elevenServer = startServer({
    projectFile: join(elevenRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    elevenlabs: eleven,
  })
  afterAll(() => elevenServer.stop(true))
  const send = (path: string, body: unknown) =>
    fetch(new URL(path, elevenServer.url), {
      method: 'POST',
      headers: { origin: elevenServer.url.origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('makes them on ElevenLabs, serves them as WAV, and counts their credits on the Spending page', async () => {
    const tried = await (await send('/api/parts/act1/lines/a/try', { cue: '[soft]' })).json()
    expect(tried).toMatchObject({
      ok: true,
      spoken: '[soft] Once.',
      model: 'eleven_v3',
      credits: 12,
    })
    const taken = await (
      await send('/api/characters/narrator/takes', { voice: 'eleven:g1' })
    ).json()
    expect(taken).toMatchObject({ ok: true, model: 'eleven_v3' })
    expect(spoken.map((s) => s.voice)).toEqual(['g1', 'g1'])
    const file = await fetch(new URL(`/api/takes/${tried.key}.mp3`, elevenServer.url))
    expect(file.headers.get('content-type')).toBe('audio/wav')
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([...wav])
    const page = await (await fetch(new URL('/api/spending', elevenServer.url))).json()
    expect(page.tries).toEqual({ count: 2, credits: 12 + taken.credits })
  })
})

describe('server, an audition paid in ElevenLabs credits', () => {
  const root = tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': {
      speakers: { gran: { voice: 'eleven:g1', style: '[warm]' }, kid: { voice: 'k1' } },
    },
    'tts/act1/script.json': [
      { id: 'a', speaker: 'gran', text: 'Hello.' },
      { id: 'b', speaker: 'kid', text: 'Hi.' },
    ],
  })
  const { client: eleven, spoken } = fakeEleven(
    { g1: elevenVoiceOf('g1') },
    {
      account: {
        tier: 'starter',
        charactersUsed: 0,
        characterLimit: 1000,
        renewsAt: null,
        overage: 0,
        voiceSlots: { used: 0, limit: 10 },
      },
      speak: () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 1]),
    },
  )
  const server = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    elevenlabs: eleven,
  })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const send = (method: string, path: string, body?: unknown) =>
    fetch(at(path), {
      method,
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const sitting = async (id: string) => (await fetch(at(`/api/auditions/${id}/sitting`))).json()
  const boardTake = async (id: string, voice: string) =>
    (await send('POST', `/api/characters/${id}/takes`, { voice, board: true })).json()

  it('tells ElevenLabs’ audition model, a take’s credits and the credits to suggest', async () => {
    const body = await sitting('gran')
    expect(body.eleven).toMatchObject({ model: 'eleven_v3', sitting: null })
    expect(body.eleven.perTake).toBeGreaterThan(0)
    expect(body.eleven.suggested % 100).toBe(0)
  })

  it('makes no board take of an ElevenLabs voice without credits, nor starts with more than the plan has', async () => {
    expect(await boardTake('gran', 'eleven:g1')).toMatchObject({ ok: false, reason: 'no-sitting' })
    const over = await send('POST', '/api/auditions/gran/start', { creditsUpTo: 2000 })
    expect([over.status, (await over.json()).reason]).toEqual([409, 'credits'])
    expect((await sitting('gran')).eleven.sitting).toBeNull()
    expect(spoken).toEqual([])
  })

  it('starts with credits, charges board takes to them, holds what is left, and adds more', async () => {
    const started = await send('POST', '/api/auditions/gran/start', { creditsUpTo: 100 })
    expect(started.status).toBe(200)
    expect((await sitting('gran')).eleven.sitting).toMatchObject({ dollars: 100, spent: 0 })
    const taken = await boardTake('gran', 'eleven:g1')
    expect(taken).toMatchObject({ ok: true, model: 'eleven_v3' })
    const after = (await sitting('gran')).eleven
    expect(after.sitting.spent).toBe(after.perTake)
    // What the sitting has left is held back from the plan's credits for any other sitting.
    const free = 1000 - after.sitting.left
    const greedy = await send('POST', '/api/auditions/kid/start', { creditsUpTo: free + 1 })
    expect([greedy.status, (await greedy.json()).reason]).toEqual([409, 'credits'])
    // Exactly what is free fits: the sitting holds what it has left, not what it was given.
    expect((await send('POST', '/api/auditions/kid/start', { creditsUpTo: free })).status).toBe(200)
    await send('DELETE', '/api/auditions/kid/sitting')
    const added = await send('POST', '/api/auditions/gran/sitting/add', { credits: 50 })
    expect(added.status).toBe(200)
    expect((await added.json()).eleven.sitting.dollars).toBe(150)
    const tooMuch = await send('POST', '/api/auditions/gran/sitting/add', { credits: 5000 })
    expect([tooMuch.status, (await tooMuch.json()).reason]).toEqual([409, 'credits'])
  })

  it('tells the plan’s account and what running sittings hold of it', async () => {
    const answer = await (await fetch(at('/api/elevenlabs/account'))).json()
    expect(answer.account).toMatchObject({ ok: true, account: { characterLimit: 1000 } })
    expect(answer.held).toBe((await sitting('gran')).eleven.sitting.left)
  })

  it('ends the credits with the sitting, and a fresh sitting can be given them alone', async () => {
    await send('DELETE', '/api/auditions/gran/sitting')
    expect((await sitting('gran')).eleven.sitting).toBeNull()
    expect(await boardTake('gran', 'eleven:g1')).toMatchObject({ ok: true, cached: true })
    const fresh = await send('POST', '/api/auditions/gran/sitting', { credits: 200 })
    expect(fresh.status).toBe(200)
    expect((await fresh.json()).eleven.sitting).toMatchObject({ dollars: 200, spent: 0 })
    expect((await send('POST', '/api/auditions/gran/sitting', {})).status).toBe(400)
    // On a free audition model there are no dollars to give, and the credits are left as they are.
    const dollars = await send('POST', '/api/auditions/gran/sitting', { amount: 1 })
    expect([dollars.status, (await dollars.json()).reason]).toEqual([409, 'confirm-credits'])
    expect((await sitting('gran')).eleven.sitting).toMatchObject({ dollars: 200 })
    const both = await send('POST', '/api/auditions/gran/sitting/add', { amount: 1, credits: 1 })
    expect(both.status).toBe(400)
  })
})

describe('server, an audition’s dollars and credits together', () => {
  const paid = projectJson({
    narration: {
      ...(projectJson().narration as object),
      models: { fish: { audition: 's2.1-pro' } },
    },
  })
  const root = tempRepo({
    'content-studio.json': paid,
    'content-studio/narration/cast.json': {
      speakers: { gran: { voice: 'eleven:g1', style: '[warm]' }, kid: { voice: 'k1' } },
    },
    'tts/act1/script.json': [
      { id: 'a', speaker: 'gran', text: 'Hello.' },
      { id: 'b', speaker: 'kid', text: 'Hi.' },
    ],
  })
  let release: () => void = () => {}
  const { client: eleven } = fakeEleven(
    { g1: elevenVoiceOf('g1') },
    {
      account: {
        tier: 'starter',
        charactersUsed: 0,
        characterLimit: 1000,
        renewsAt: null,
        overage: 0,
        voiceSlots: { used: 0, limit: 10 },
      },
      speak: () =>
        new Promise<Uint8Array>((resolve) => {
          release = () => resolve(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1]))
        }),
    },
  )
  const account: FishClient = { ...fish, credit: async () => 4.82 }
  const server = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish: account,
    encode,
    transcriber: null,
    elevenlabs: eleven,
  })
  afterAll(() => server.stop(true))
  const at = (path: string) => new URL(path, server.url)
  const send = (method: string, path: string, body?: unknown) =>
    fetch(at(path), {
      method,
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const sitting = async (id: string) => (await fetch(at(`/api/auditions/${id}/sitting`))).json()
  const held = async () => (await (await fetch(at('/api/parts/act1/plan'))).json()).elevenHeld

  it('starts with both, and a fresh sitting on a paid model needs its dollars', async () => {
    const started = await send('POST', '/api/auditions/gran/start', {
      spendUpTo: 0.05,
      creditsUpTo: 100,
    })
    expect(started.status).toBe(200)
    const credits = await send('POST', '/api/auditions/gran/sitting', { credits: 200 })
    expect([credits.status, (await credits.json()).reason]).toEqual([409, 'confirm'])
    const view = await sitting('gran')
    expect(view.sitting).toMatchObject({ dollars: 0.05 })
    expect(view.eleven.sitting).toMatchObject({ dollars: 100 })
  })

  it('leaves the sitting as it was when its credits are refused, holding no new dollars', async () => {
    const refused = await send('POST', '/api/auditions/gran/sitting', {
      amount: 0.05,
      credits: 5000,
    })
    expect([refused.status, (await refused.json()).reason]).toEqual([409, 'credits'])
    const view = await sitting('gran')
    expect(view.sitting).toMatchObject({ dollars: 0.05 })
    expect(view.eleven.sitting).toMatchObject({ dollars: 100 })
    // Only the running sitting's dollars are held: 4.82 less 0.05 is free.
    const fits = await send('POST', '/api/auditions/gran/sitting', { amount: 4.75, credits: 100 })
    expect(fits.status).toBe(200)
  })

  it('does not count a sitting’s old credits against the fresh ones, and a refused start keeps it', async () => {
    const fresh = await send('POST', '/api/auditions/gran/sitting', { amount: 0.05, credits: 950 })
    expect(fresh.status).toBe(200)
    const refused = await send('POST', '/api/auditions/gran/start', {
      spendUpTo: 0.05,
      creditsUpTo: 5000,
    })
    expect(refused.status).toBe(409)
    expect((await sitting('gran')).eleven.sitting).toMatchObject({ dollars: 950 })
  })

  it('holds a take’s credits while it is in flight, and what is left after', async () => {
    expect(await held()).toBe(950)
    const take = send('POST', '/api/characters/gran/takes', { voice: 'eleven:g1', board: true })
    for (let i = 0; i < 200 && (await sitting('gran')).eleven.sitting.spent === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const per = (await sitting('gran')).eleven.perTake
    expect((await sitting('gran')).eleven.sitting.left).toBe(950 - per)
    expect(await held()).toBe(950)
    release()
    expect(await (await take).json()).toMatchObject({ ok: true })
    expect(await held()).toBe(950 - per)
  })

  it('gives a sitting credits of its own on the board, leaving its dollars as they are', async () => {
    await send('DELETE', '/api/auditions/gran/sitting')
    expect((await send('POST', '/api/auditions/gran/sitting', { amount: 0.05 })).status).toBe(200)
    expect((await sitting('gran')).eleven.sitting).toBeNull()
    const given = await send('POST', '/api/auditions/gran/sitting/add', { credits: 300 })
    expect(given.status).toBe(200)
    const view = await given.json()
    expect(view.sitting).toMatchObject({ dollars: 0.05 })
    expect(view.eleven.sitting).toMatchObject({ dollars: 300, spent: 0 })
    expect(await held()).toBe(300)
    // More than the plan has free is refused, and leaves the credits given as they were.
    const over = await send('POST', '/api/auditions/gran/sitting/add', { credits: 800 })
    expect([over.status, (await over.json()).reason]).toEqual([409, 'credits'])
    expect((await sitting('gran')).eleven.sitting).toMatchObject({ dollars: 300 })
  })

  it('gives no credits to a character with no audition', async () => {
    const none = await send('POST', '/api/auditions/kid/sitting/add', { credits: 100 })
    expect([none.status, (await none.json()).reason]).toEqual([409, 'confirm-credits'])
    expect((await sitting('kid')).eleven.sitting).toBeNull()
  })

  it('lets only one of two sittings asking at once have the same credits', async () => {
    await send('DELETE', '/api/auditions/gran/sitting')
    const [one, two] = await Promise.all([
      send('POST', '/api/auditions/gran/sitting', { amount: 0.05, credits: 600 }),
      send('POST', '/api/auditions/kid/sitting', { amount: 0.05, credits: 600 }),
    ])
    expect([one.status, two.status].sort()).toEqual([200, 409])
  })
})

describe('server, credits in flight when a sitting is replaced or ended', () => {
  const root = tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': {
      speakers: { gran: { voice: 'eleven:g1', style: '[warm]' } },
    },
    'tts/act1/script.json': [{ id: 'a', speaker: 'gran', text: 'Hello.' }],
  })
  const { client: eleven } = fakeEleven(
    { g1: elevenVoiceOf('g1') },
    {
      account: {
        tier: 'starter',
        charactersUsed: 0,
        characterLimit: 1000,
        renewsAt: null,
        overage: 0,
        voiceSlots: { used: 0, limit: 10 },
      },
      // ElevenLabs never answers: the take stays in flight.
      speak: () => new Promise<Uint8Array>(() => {}),
    },
  )
  const server = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    elevenlabs: eleven,
  })
  afterAll(() => server.stop(true))
  const send = (method: string, path: string, body?: unknown) =>
    fetch(new URL(path, server.url), {
      method,
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const sitting = async () =>
    (await (await fetch(new URL('/api/auditions/gran/sitting', server.url))).json()).eleven

  it('keeps holding a take’s credits in flight after its sitting is replaced, and after it ended', async () => {
    expect((await send('POST', '/api/auditions/gran/sitting', { credits: 100 })).status).toBe(200)
    // Never answered: the server stopping at the end cuts it off, which is expected.
    void send('POST', '/api/characters/gran/takes', { voice: 'eleven:g1', board: true }).catch(
      () => undefined,
    )
    for (let i = 0; i < 200 && (await sitting()).sitting.spent === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const per = (await sitting()).perTake
    // The plan's 1,000 credits, less the take ElevenLabs may still bill.
    const all = await send('POST', '/api/auditions/gran/sitting', { credits: 1000 })
    expect([all.status, (await all.json()).reason]).toEqual([409, 'credits'])
    expect(
      (await send('POST', '/api/auditions/gran/sitting', { credits: 1000 - per })).status,
    ).toBe(200)
    await send('DELETE', '/api/auditions/gran/sitting')
    const after = await send('POST', '/api/auditions/gran/sitting', { credits: 1000 })
    expect([after.status, (await after.json()).reason]).toEqual([409, 'credits'])
  })
})

describe('server, voices from ElevenLabs’ library on the board', () => {
  const root = tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': {
      speakers: { gran: { style: '[warm]', audition: { keywords: ['warm'] } } },
    },
    'tts/act1/script.json': [{ id: 'a', speaker: 'gran', text: 'Hello.' }],
  })
  const eleven = fakeEleven(
    {},
    {
      account: {
        tier: 'starter',
        charactersUsed: 0,
        characterLimit: 1000,
        renewsAt: null,
        overage: 0,
        voiceSlots: { used: 0, limit: 10 },
      },
      speak: () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 1]),
    },
  )
  const added: string[] = []
  eleven.client.sharedVoices = async () => ({
    voices: [{ ...elevenVoiceOf('l1', 'Warm Gravel'), library: { owner: 'o1', added: false } }],
    more: false,
  })
  eleven.client.addSharedVoice = async (owner, id) => {
    added.push(`${owner}/${id}`)
    return `own-${id}`
  }
  const server = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    elevenlabs: eleven.client,
  })
  afterAll(() => server.stop(true))
  const send = (method: string, path: string, body?: unknown) =>
    fetch(new URL(path, server.url), {
      method,
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('brings library voices in, adds one at its first take, and casts it as added', async () => {
    expect((await send('POST', '/api/auditions/gran/start')).status).toBe(200)
    expect((await send('POST', '/api/auditions/gran/more', { provider: 'nobody' })).status).toBe(
      400,
    )
    const garbled = await fetch(new URL('/api/auditions/gran/more', server.url), {
      method: 'POST',
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: '{',
    })
    expect(garbled.status).toBe(400)
    const more = await (
      await send('POST', '/api/auditions/gran/more', { provider: 'elevenlabs' })
    ).json()
    expect(more.session.toHear).toContain('eleven:l1')
    expect((await send('POST', '/api/auditions/gran/sitting/add', { credits: 300 })).status).toBe(
      200,
    )
    const take = await send('POST', '/api/characters/gran/takes', {
      voice: 'eleven:l1',
      board: true,
    })
    expect(await take.json()).toMatchObject({ ok: true })
    expect(added).toEqual(['o1/l1'])
    expect(eleven.spoken.map((s) => s.voice)).toEqual(['own-l1'])
    const board = await (await fetch(new URL('/api/auditions/gran', server.url))).json()
    expect(board.session.voices['eleven:l1'].library).toEqual({ owner: 'o1', added: true })
    expect(
      JSON.parse(readFileSync(join(root, 'content-studio/cache/eleven-voices.json'), 'utf8')),
    ).toMatchObject({
      added: [{ library: 'eleven:l1', voice: 'eleven:own-l1', character: 'gran' }],
    })
    await send('POST', '/api/auditions/gran/move', { voice: 'eleven:l1', move: 'shortlist' })
    const cast = await send('POST', '/api/auditions/gran/cast', { voice: 'eleven:l1' })
    expect(await cast.json()).toMatchObject({ ok: true, voice: { id: 'eleven:own-l1' } })
    expect(added).toEqual(['o1/l1'])
  })

  it('offers a voice it added for freeing once nothing uses it, and frees it', async () => {
    const freeable = async () =>
      (await (await fetch(new URL('/api/elevenlabs/voices/freeable', server.url))).json()).voices
    // Cast as gran's voice: in use.
    expect(await freeable()).toEqual([])
    writeFileSync(
      join(root, 'content-studio/narration/cast.json'),
      JSON.stringify({ speakers: { gran: { style: '[warm]' } } }),
    )
    expect(await freeable()).toEqual([
      { voice: 'eleven:own-l1', name: 'Warm Gravel', character: 'gran' },
    ])
    const deleted: string[] = []
    eleven.client.deleteVoice = async (id) => void deleted.push(id)
    expect((await send('POST', '/api/elevenlabs/voices/free', { voices: [] })).status).toBe(400)
    const freed = await send('POST', '/api/elevenlabs/voices/free', { voices: ['eleven:own-l1'] })
    expect(await freed.json()).toEqual({
      ok: true,
      freed: ['Warm Gravel'],
      libraries: ['eleven:l1'],
      failed: [],
    })
    expect(deleted).toEqual(['own-l1'])
    expect(await freeable()).toEqual([])
  })

  it('asks ElevenLabs for the account afresh after a free or an add, for the slots shown', async () => {
    const slots = async () =>
      (await (await fetch(new URL('/api/elevenlabs/account', server.url))).json()).account.account
        .voiceSlots
    let used = 4
    eleven.client.subscription = async () => ({
      tier: 'starter',
      charactersUsed: 0,
      characterLimit: 1000,
      renewsAt: null,
      overage: 0,
      voiceSlots: { used, limit: 10 },
    })
    // Within half a minute of the last answer the account is not asked again...
    await slots()
    used = 3
    expect((await slots()).used).not.toBe(3)
    // ...but a free changes the slots, so it is.
    writeFileSync(
      join(root, 'content-studio/cache/eleven-voices.json'),
      JSON.stringify({
        version: 1,
        added: [{ library: 'eleven:z', voice: 'eleven:z2', name: 'Z', character: 'gran', at: '' }],
      }),
    )
    eleven.client.deleteVoice = async () => {}
    await send('POST', '/api/elevenlabs/voices/free', { voices: ['eleven:z2'] })
    expect((await slots()).used).toBe(3)
    // ...and so does casting a library voice, which adds it.
    used = 2
    expect((await slots()).used).toBe(3)
    eleven.client.addSharedVoice = async () => 'own-c1'
    eleven.client.sharedVoices = async () => ({
      voices: [{ ...elevenVoiceOf('c1', 'Warm Cedar'), library: { owner: 'o1', added: false } }],
      more: false,
    })
    writeFileSync(
      join(root, 'content-studio/narration/cast.json'),
      JSON.stringify({ speakers: { gran: { style: '[warm]', audition: { keywords: ['warm'] } } } }),
    )
    await send('POST', '/api/auditions/gran/start')
    await send('POST', '/api/auditions/gran/more', { provider: 'elevenlabs' })
    await send('POST', '/api/auditions/gran/move', { voice: 'eleven:c1', move: 'shortlist' })
    used = 4
    const cast = await send('POST', '/api/auditions/gran/cast', { voice: 'eleven:c1' })
    expect(await cast.json()).toMatchObject({ ok: true, voice: { id: 'eleven:own-c1' } })
    expect((await slots()).used).toBe(4)
  })

  it('offers and frees nothing while the cast cannot be read', async () => {
    writeFileSync(
      join(root, 'content-studio/cache/eleven-voices.json'),
      JSON.stringify({
        version: 1,
        added: [{ library: 'eleven:y', voice: 'eleven:y2', name: 'Y', character: 'gran', at: '' }],
      }),
    )
    writeFileSync(join(root, 'content-studio/narration/cast.json'), '{ not json')
    const deleted: string[] = []
    eleven.client.deleteVoice = async (id) => void deleted.push(id)
    const offered = await fetch(new URL('/api/elevenlabs/voices/freeable', server.url))
    const refusal = await offered.json()
    expect([offered.status, refusal.reason]).toEqual([409, 'unknown-use'])
    expect(refusal.message).toStartWith(
      'content-studio/narration/cast.json or a saved audition in content-studio/cache/auditions',
    )
    const freed = await send('POST', '/api/elevenlabs/voices/free', { voices: ['eleven:y2'] })
    expect([freed.status, (await freed.json()).reason]).toEqual([409, 'unknown-use'])
    expect(deleted).toEqual([])
    // With nothing the studio added there is nothing to offer, and nothing to say.
    writeFileSync(
      join(root, 'content-studio/cache/eleven-voices.json'),
      '{"version": 1, "added": []}',
    )
    const none = await fetch(new URL('/api/elevenlabs/voices/freeable', server.url))
    expect([none.status, await none.json()]).toEqual([200, { ok: true, voices: [] }])
  })
})

describe('server, designing voices with ElevenLabs', () => {
  const root = tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': {
      speakers: { gran: { style: '[warm]', audition: { keywords: ['warm'] } } },
    },
    'tts/act1/script.json': [
      { id: 'a', speaker: 'gran', text: 'Come in from the cold, child, the kettle is singing.' },
      { id: 'b', speaker: 'gran', text: 'Sit by the fire and I will tell you of the sea.' },
    ],
  })
  const eleven = fakeEleven(
    {},
    {
      account: {
        tier: 'starter',
        charactersUsed: 0,
        characterLimit: 1000,
        renewsAt: null,
        overage: 0,
        voiceSlots: { used: 0, limit: 10 },
      },
    },
  )
  const asked: (string | null)[] = []
  eleven.client.designVoices = async ({ text }) => {
    asked.push(text)
    return {
      text: text ?? '',
      previews: [1, 2, 3].map((i) => ({ generated: `g${i}`, audio: new Uint8Array([i]) })),
    }
  }
  eleven.client.saveDesignedVoice = async ({ generated }) => `v-${generated}`
  const server = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    elevenlabs: eleven.client,
  })
  afterAll(() => server.stop(true))
  const send = (method: string, path: string, body?: unknown) =>
    fetch(new URL(path, server.url), {
      method,
      headers: { origin: server.url.origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('says what a design costs, designs once confirmed, and casts a design as a saved voice', async () => {
    const plan = await (await fetch(new URL('/api/characters/gran/designs', server.url))).json()
    expect(plan.eleven.text).toContain('Come in from the cold')
    const credits = plan.eleven.credits
    expect(credits).toBe([...plan.eleven.text].length)
    const vague = await send('POST', '/api/characters/gran/design', {
      description: 'old wizard',
      provider: 'elevenlabs',
      creditsUpTo: credits,
    })
    expect([vague.status, (await vague.json()).reason]).toEqual([409, 'invalid'])
    // More than the plan has left is refused, and ElevenLabs is asked nothing.
    const subscription = eleven.client.subscription
    eleven.client.subscription = async () => ({
      ...(await subscription()),
      charactersUsed: 1000 - credits + 1,
    })
    const short = await send('POST', '/api/characters/gran/design', {
      description: 'An old wizard, gruff and slow',
      provider: 'elevenlabs',
      creditsUpTo: credits,
    })
    expect(short.status).toBe(409)
    eleven.client.subscription = subscription
    const unconfirmed = await send('POST', '/api/characters/gran/design', {
      description: 'An old wizard, gruff and slow',
      provider: 'elevenlabs',
    })
    expect(unconfirmed.status).toBe(409)
    expect(asked).toEqual([])
    const designed = await send('POST', '/api/characters/gran/design', {
      description: 'An old wizard, gruff and slow',
      provider: 'elevenlabs',
      creditsUpTo: credits,
    })
    expect(await designed.json()).toEqual({ ok: true, added: 3 })
    expect(asked).toEqual([plan.eleven.text])
    const started = await (await send('POST', '/api/auditions/gran/start')).json()
    const first = started.session.designed[0]
    await send('POST', '/api/auditions/gran/move', { voice: first, move: 'shortlist' })
    const cast = await send('POST', '/api/auditions/gran/cast', { voice: first })
    expect(await cast.json()).toMatchObject({ ok: true, voice: { id: 'eleven:v-g1' } })
  })
})

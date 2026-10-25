import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { FishClient, TtsRequest } from './fish'
import { createLimiter } from './limit'
import { auditionTakes, recordTake, takeFile, tryLine } from './takes'

const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': {
    speakers: {
      grandmother: {
        voice: 'cur',
        style: '[warm]',
        speed: 0.9,
        audition: { phrase: 'Elior, dear.' },
      },
    },
    pronounce: { Elior: 'El-ee-or' },
  },
  'tts/act1/script.json': [{ key: 'a', speaker: 'grandmother', text: 'Hello.' }],
}

function fakeFish() {
  const requests: TtsRequest[] = []
  const fish: FishClient = {
    async listOwnVoices() {
      return []
    },
    async credit() {
      return 25
    },
    listVoices: () => Promise.reject(new Error('not used')),
    getVoice: () => Promise.reject(new Error('not used')),
    async tts(request) {
      requests.push(request)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return new Uint8Array([7, 7, 7])
    },
  }
  return { fish, requests }
}

describe('recordTake', () => {
  it('has the voice say the character’s phrase in its style, and keeps the audio', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const projectFile = join(root, 'audio-studio.json')
    const result = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
    )
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.cached).toBe(false)
    expect(requests).toEqual([
      {
        text: '[warm] El-ee-or, dear.',
        voice: 'v9',
        model: 's2.1-pro-free',
        temperature: 0.7,
        topP: 0.7,
        speed: 0.9,
      },
    ])
    const file = await takeFile(projectFile, result.key)
    expect(file).toBe(join(root, '.audio-studio/takes', `${result.key}.mp3`))
    expect([...readFileSync(file!)]).toEqual([7, 7, 7])
  })

  it('records a take only once', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const projectFile = join(root, 'audio-studio.json')
    const limiter = createLimiter()
    const [a, b] = await Promise.all([
      recordTake(projectFile, 'grandmother', 'v9', async () => fish, limiter),
      recordTake(projectFile, 'grandmother', 'v9', async () => fish, limiter),
    ])
    const again = await recordTake(projectFile, 'grandmother', 'v9', async () => fish, limiter)
    expect(requests).toHaveLength(1)
    expect(again).toMatchObject({ ok: true, cached: true })
    expect(a?.ok && b?.ok && a.key === b.key).toBe(true)
  })

  it('records a take once even when a slower request started first', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const projectFile = join(root, 'audio-studio.json')
    const limiter = createLimiter()
    // Gated both ways, so the order is fixed whatever the machine's load: the slower request has
    // missed the cache and asked for its client before the faster one speaks, and gets its client
    // only once the faster one has stored the take.
    let asked!: () => void
    const slowerAsked = new Promise<void>((resolve) => (asked = resolve))
    let stored!: () => void
    const takeStored = new Promise<void>((resolve) => (stored = resolve))
    const slow = async () => {
      asked()
      await takeStored
      return fish
    }
    const waitsForSlower: FishClient = {
      ...fish,
      async tts(request) {
        await slowerAsked
        return fish.tts(request)
      },
    }
    const [slower, faster] = await Promise.all([
      recordTake(projectFile, 'grandmother', 'v9', slow, limiter),
      recordTake(projectFile, 'grandmother', 'v9', async () => waitsForSlower, limiter).finally(
        stored,
      ),
    ])
    expect(requests).toHaveLength(1)
    expect(slower).toMatchObject({ ok: true, cached: true })
    expect(faster).toMatchObject({ ok: true, cached: false })
  })

  it('says which phrase the take is of', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const result = await recordTake(
      join(root, 'audio-studio.json'),
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
    )
    expect(result).toMatchObject({ ok: true, spoken: '[warm] El-ee-or, dear.' })
  })

  it('refuses empty audio from Fish, and keeps nothing', async () => {
    const root = tempRepo(files)
    const empty: FishClient = { ...fakeFish().fish, tts: async () => new Uint8Array() }
    const projectFile = join(root, 'audio-studio.json')
    const result = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => empty,
      createLimiter(),
    )
    expect(result).toMatchObject({ ok: false, reason: 'fish' })
    expect(existsSync(join(root, '.audio-studio/takes'))).toBe(false)
  })

  it('refuses a phrase in the cast too long for one take, and pays nothing', async () => {
    const long = 'x'.repeat(401)
    const root = tempRepo({
      ...files,
      'tts/cast.json': { speakers: { grandmother: { voice: 'cur', audition: { phrase: long } } } },
    })
    const { fish, requests } = fakeFish()
    const result = await recordTake(
      join(root, 'audio-studio.json'),
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
    )
    expect(result && !result.ok && 'problems' in result && result.problems[0]!.message).toContain(
      '401',
    )
    expect(requests).toEqual([])
  })

  it('lists only the cast’s problems when the cast is broken', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': '{ broken',
      'tts/act2/script.json': '[ broken',
    })
    const { fish } = fakeFish()
    const result = await recordTake(
      join(root, 'audio-studio.json'),
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
    )
    expect(
      result && !result.ok && 'problems' in result && result.problems.map((p) => p.file),
    ).toEqual(['tts/cast.json'])
  })

  it('says so when there is no API key, or Fish fails', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    expect(
      await recordTake(projectFile, 'grandmother', 'v9', async () => null, createLimiter()),
    ).toMatchObject({
      ok: false,
      reason: 'no-key',
    })
    const failing: FishClient = {
      ...fakeFish().fish,
      tts: () => Promise.reject(new Error('no credit')),
    }
    expect(
      await recordTake(projectFile, 'grandmother', 'v9', async () => failing, createLimiter()),
    ).toEqual({
      ok: false,
      reason: 'fish',
      message: 'no credit',
    })
  })

  it('returns null for a character the project does not have', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    expect(
      await recordTake(
        join(root, 'audio-studio.json'),
        'nobody',
        'v9',
        async () => fish,
        createLimiter(),
      ),
    ).toBeNull()
  })
})

describe('takeFile', () => {
  it('knows only keys that look like keys and have a file', async () => {
    const root = tempRepo({ ...files, '.audio-studio/takes/0123456789abcdef.mp3': 'x' })
    const projectFile = join(root, 'audio-studio.json')
    expect(await takeFile(projectFile, '0123456789abcdef')).not.toBeNull()
    expect(await takeFile(projectFile, 'fedcba9876543210')).toBeNull()
    expect(await takeFile(projectFile, '../audio-studio')).toBeNull()
  })
})

describe('recordedTakes', () => {
  it('finds the takes recorded for the phrase, the current voice included', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const projectFile = join(root, 'audio-studio.json')
    const take = await recordTake(
      projectFile,
      'grandmother',
      'cur',
      async () => fish,
      createLimiter(),
    )
    const result = await auditionTakes(projectFile, 'grandmother', ['cur', 'other'])
    expect(take?.ok && result?.ok && result.takes).toEqual({ cur: take?.ok ? take.key : '' })
  })
})

describe('tryLine', () => {
  const projectFileOf = (root: string) => join(root, 'audio-studio.json')

  it('has the cast voice say the line with the cue tried, as the cast says it, and keeps it', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const result = await tryLine(
      projectFileOf(root),
      'act1',
      'a',
      '[hushed]',
      async () => fish,
      createLimiter(),
    )
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result).toMatchObject({ spoken: '[hushed] Hello.', cached: false })
    expect(requests).toEqual([
      {
        text: '[hushed] Hello.',
        voice: 'cur',
        model: 's2.1-pro-free',
        temperature: 0.7,
        topP: 0.7,
        speed: 0.9,
      },
    ])
    expect(await takeFile(projectFileOf(root), result.key)).toBe(
      join(root, '.audio-studio/takes', `${result.key}.mp3`),
    )
    // Nothing of the game's: no cue saved, no manifest or lock made.
    for (const file of [
      'tts/act1/cues.json',
      'audio/act1/manifest.json',
      'tts/act1/narration.lock.json',
    ]) {
      expect(existsSync(join(root, file))).toBe(false)
    }
  })

  it('needs only the dialog and the cast: a broken manifest or lock does not stop it', async () => {
    const root = tempRepo({
      ...files,
      'audio/act1/manifest.json': { a: { file: 3 } },
      'tts/act1/narration.lock.json': 'not json',
    })
    const { fish } = fakeFish()
    const result = await tryLine(
      projectFileOf(root),
      'act1',
      'a',
      '',
      async () => fish,
      createLimiter(),
    )
    expect(result).toMatchObject({ ok: true })
    const broken = tempRepo({ ...files, 'tts/cast.json': { speakers: 'no' } })
    const refused = await tryLine(
      projectFileOf(broken),
      'act1',
      'a',
      '',
      async () => fish,
      createLimiter(),
    )
    expect(refused).toMatchObject({ ok: false, problems: [{ file: 'tts/cast.json' }] })
  })

  it('tries the character’s style for an empty cue, and records a cue once', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const limiter = createLimiter()
    const first = await tryLine(projectFileOf(root), 'act1', 'a', '  ', async () => fish, limiter)
    const again = await tryLine(projectFileOf(root), 'act1', 'a', '', async () => fish, limiter)
    expect(first).toMatchObject({ ok: true, spoken: '[warm] Hello.', cached: false })
    expect(again).toMatchObject({ ok: true, spoken: '[warm] Hello.', cached: true })
    expect(requests).toHaveLength(1)
  })

  it('is null for an unknown part or line, and refuses a line whose speaker has no voice', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/script.json': [
        { key: 'a', speaker: 'grandmother', text: 'Hello.' },
        { key: 'b', speaker: 'stranger', text: 'Who?' },
      ],
    })
    const { fish, requests } = fakeFish()
    const limiter = createLimiter()
    expect(
      await tryLine(projectFileOf(root), 'act9', 'a', '', async () => fish, limiter),
    ).toBeNull()
    expect(
      await tryLine(projectFileOf(root), 'act1', 'zz', '', async () => fish, limiter),
    ).toBeNull()
    expect(await tryLine(projectFileOf(root), 'act1', 'b', '', async () => fish, limiter)).toEqual({
      ok: false,
      reason: 'uncast',
      message: 'stranger has no voice yet; cast one first.',
    })
    expect(requests).toHaveLength(0)
  })

  it('says there is no key, and what Fish answered', async () => {
    const root = tempRepo(files)
    const limiter = createLimiter()
    expect(
      await tryLine(projectFileOf(root), 'act1', 'a', '', async () => null, limiter),
    ).toMatchObject({
      ok: false,
      reason: 'no-key',
    })
    const failing: FishClient = { ...fakeFish().fish, tts: () => Promise.reject(new Error('boom')) }
    expect(
      await tryLine(projectFileOf(root), 'act1', 'a', '', async () => failing, limiter),
    ).toEqual({ ok: false, reason: 'fish', message: 'boom' })
  })
})

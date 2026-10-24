import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { FishClient, TtsRequest } from './fish'
import { createLimiter } from './limit'
import { auditionTakes, recordTake, takeFile } from './takes'

const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': {
    speakers: {
      grandmother: { voice: 'cur', style: '[warm]', audition: { phrase: 'Elior, dear.' } },
    },
    pronounce: { Elior: 'El-ee-or' },
  },
  'tts/act1/script.json': [{ key: 'a', speaker: 'grandmother', text: 'Hello.' }],
}

function fakeFish() {
  const requests: TtsRequest[] = []
  const fish: FishClient = {
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
        speed: 1,
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
    // The slower request gets its client only once the faster one has stored the take: an event,
    // not a time, so a busy machine cannot reorder them.
    let stored!: () => void
    const takeStored = new Promise<void>((resolve) => (stored = resolve))
    const slow = async () => {
      await takeStored
      return fish
    }
    const [slower, faster] = await Promise.all([
      recordTake(projectFile, 'grandmother', 'v9', slow, limiter),
      recordTake(projectFile, 'grandmother', 'v9', async () => fish, limiter).finally(stored),
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

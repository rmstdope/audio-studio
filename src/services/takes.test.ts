import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { FishClient, TtsRequest } from './fish'
import { createLimiter } from './limit'
import { recordTake, takeFile } from './takes'

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

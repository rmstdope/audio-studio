import { describe, expect, it } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { cloneVoice } from './cloneVoice'
import { FishError, type CreateVoiceRequest, type FishClient } from './fish'

const root = () =>
  tempRepo({
    'content-studio.json': projectJson(),
    'tts/cast.json': { speakers: { mira: { voice: 'cur' } } },
    'tts/act1/script.json': [{ key: 'a', speaker: 'mira', text: 'Hi.' }],
  })

const file = (name: string) => ({ name, type: 'audio/wav', bytes: new Uint8Array([1]) })

const aVoice = (id: string, title: string) => ({
  id,
  title,
  description: '',
  tags: [],
  languages: [],
  uses: 0,
  likes: 0,
  author: '',
  sample: null,
})

function fishThat(make: FishClient['createVoice']) {
  const fish = { createVoice: make } as FishClient
  return async () => fish
}

describe('cloneVoice', () => {
  it('makes the voice on Fish and gives its id and name', async () => {
    const asked: CreateVoiceRequest[] = []
    const dir = root()
    const result = await cloneVoice(
      join(dir, 'content-studio.json'),
      'mira',
      { title: '  Mira ', files: [file('a.wav'), file('b.wav')] },
      fishThat(async (request) => {
        asked.push(request)
        return aVoice('new1', 'Mira')
      }),
    )
    expect(result).toEqual({ ok: true, voice: { id: 'new1', name: 'Mira' } })
    expect(asked[0]?.title).toBe('Mira')
    expect(asked[0]?.files.length).toBe(2)
    // Nothing is written to the consumer.
    expect(readdirSync(dir).sort()).toEqual(['content-studio.json', 'tts'])
  })

  it('refuses no files, too many, and a blank name, without asking Fish', async () => {
    const never = fishThat(() => Promise.reject(new Error('asked')))
    const projectFile = join(root(), 'content-studio.json')
    const many = Array.from({ length: 21 }, (_, i) => file(`${i}.wav`))
    for (const [title, files] of [
      ['Mira', []],
      ['Mira', many],
      ['  ', [file('a.wav')]],
    ] as const) {
      expect(
        await cloneVoice(projectFile, 'mira', { title, files: [...files] }, never),
      ).toMatchObject({
        ok: false,
        reason: 'invalid',
      })
    }
  })

  it('says when there is no key', async () => {
    const projectFile = join(root(), 'content-studio.json')
    const result = await cloneVoice(
      projectFile,
      'mira',
      { title: 'Mira', files: [file('a.wav')] },
      async () => null,
    )
    expect(result).toMatchObject({ ok: false, reason: 'no-key' })
  })

  it('gives Fish’s own message when it refuses', async () => {
    const projectFile = join(root(), 'content-studio.json')
    const result = await cloneVoice(
      projectFile,
      'mira',
      { title: 'Mira', files: [file('a.wav')] },
      fishThat(() => Promise.reject(new FishError(400, 'Audio too short'))),
    )
    expect(result).toEqual({ ok: false, reason: 'fish', message: 'Audio too short' })
  })

  it('tells a failure that is not a refusal apart, as the voice may exist', async () => {
    const projectFile = join(root(), 'content-studio.json')
    const result = await cloneVoice(
      projectFile,
      'mira',
      { title: 'Mira', files: [file('a.wav')] },
      fishThat(() => Promise.reject(new Error('Fish Audio did not answer within 360 s'))),
    )
    expect(result).toEqual({
      ok: false,
      reason: 'failed',
      message: 'Fish Audio did not answer within 360 s',
    })
  })

  it('knows no character it was not asked about', async () => {
    const projectFile = join(root(), 'content-studio.json')
    expect(
      await cloneVoice(
        projectFile,
        'nobody',
        { title: 'x', files: [file('a.wav')] },
        async () => null,
      ),
    ).toBeNull()
  })
})

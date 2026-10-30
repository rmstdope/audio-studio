import { rm } from 'node:fs/promises'
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { ElevenAnswer } from '../core/setup'
import type { CreditResult } from './fish'
import { mfluxReady } from './images'
import { checkSetup, type Machine } from './setup'

const musicSection = {
  paths: {
    loops: 'tts/{part}/music.json',
    stingers: 'tts/stingers.json',
    briefs: 'music/briefs.json',
    lock: 'music/music.lock.json',
    clips: 'web/public/audio/music/generated',
    manifest: 'web/public/audio/music/generated/manifest.json',
  },
}
const credit = async (): Promise<CreditResult> => ({ ok: true, credit: 3 })
const mac: Machine = { which: () => true, platform: 'darwin', arch: 'arm64' }
const byId = (checks: { id: string; state: string }[]) =>
  Object.fromEntries(checks.map((c) => [c.id, c.state]))

describe('checkSetup', () => {
  it('asks Fish and ElevenLabs at the same time', async () => {
    let accountAsked!: () => void
    const asking = new Promise<void>((resolve) => (accountAsked = resolve))
    const root = tempRepo({
      'audio-studio.json': projectJson(),
      '.env': 'FISH_AUDIO_API_KEY=f\nELEVENLABS_API_KEY=k\n',
    })
    // Fish answers only once ElevenLabs has been asked: one after the other would never finish.
    const result = await checkSetup(
      join(root, 'audio-studio.json'),
      async () => {
        await asking
        return { ok: true, credit: 3 }
      },
      mac,
      {},
      undefined,
      async () => {
        accountAsked()
        return { ok: false, reason: 'elevenlabs', message: 'down' }
      },
    )
    if (!result.ok) throw new Error('expected checks')
    expect(byId(result.checks)).toMatchObject({ fish: 'ok', elevenlabs: 'problem' })
  }, 2000)

  it('asks ElevenLabs for the account only when its key is set', async () => {
    const asked: string[] = []
    const account = async (key: string): Promise<ElevenAnswer> => {
      asked.push(key)
      return {
        ok: true,
        account: {
          tier: 'starter',
          charactersUsed: 0,
          characterLimit: 30000,
          renewsAt: null,
          overage: 0,
          voiceSlots: { used: 0, limit: 10 },
        },
      }
    }
    const without = tempRepo({ 'audio-studio.json': projectJson() })
    const none = await checkSetup(
      join(without, 'audio-studio.json'),
      credit,
      mac,
      {},
      undefined,
      account,
    )
    if (!none.ok) throw new Error('expected checks')
    expect(asked).toEqual([])
    expect(byId(none.checks)).toMatchObject({ elevenlabsKey: 'off', elevenlabs: 'off' })
    const withKey = tempRepo({
      'audio-studio.json': projectJson(),
      '.env': 'ELEVENLABS_API_KEY=k\n',
    })
    const some = await checkSetup(
      join(withKey, 'audio-studio.json'),
      credit,
      mac,
      {},
      undefined,
      account,
    )
    if (!some.ok) throw new Error('expected checks')
    expect(asked).toEqual(['k'])
    expect(byId(some.checks)).toMatchObject({ elevenlabsKey: 'ok', elevenlabs: 'ok' })
  })

  it('finds the tools, the key in the env file, and asks Fish', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson(), '.env': 'FISH_AUDIO_API_KEY=k\n' })
    const result = await checkSetup(join(root, 'audio-studio.json'), credit, mac, {})
    if (!result.ok) throw new Error('expected checks')
    expect(result.checks.find((c) => c.id === 'fish')).toMatchObject({ credit: 3 })
    expect(byId(result.checks)).toEqual({
      ffmpeg: 'ok',
      whisper: 'ok',
      key: 'ok',
      fish: 'ok',
      requests: 'ok',
      refresh: 'off',
      music: 'off',
      stableAudio: 'off',
      imageModels: 'off',
      elevenlabsKey: 'off',
      elevenlabs: 'off',
    })
  })

  it('asks the machine for each tool, and Fish not at all without a key', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson() })
    let asked = 0
    const machine: Machine = { which: (c) => c === 'uv', platform: 'linux', arch: 'x64' }
    const result = await checkSetup(
      join(root, 'audio-studio.json'),
      async () => {
        asked++
        return { ok: true, credit: 3 }
      },
      machine,
      {},
    )
    if (!result.ok) throw new Error('expected checks')
    expect(byId(result.checks)).toEqual({
      ffmpeg: 'problem',
      whisper: 'problem',
      key: 'problem',
      fish: 'off',
      requests: 'off',
      refresh: 'off',
      music: 'off',
      stableAudio: 'off',
      imageModels: 'off',
      elevenlabsKey: 'off',
      elevenlabs: 'off',
    })
    expect(asked).toBe(0)
  })

  it('takes the key from the environment too, and reports Fish not answering', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson() })
    const silent = async (): Promise<CreditResult> => ({
      ok: false,
      reason: 'fish',
      message: 'Fish Audio answered 401',
    })
    const result = await checkSetup(join(root, 'audio-studio.json'), silent, mac, {
      FISH_AUDIO_API_KEY: 'k',
    })
    if (!result.ok) throw new Error('expected checks')
    expect(result.checks.find((c) => c.id === 'fish')).toMatchObject({
      state: 'problem',
      detail: expect.stringContaining('401'),
    })
  })

  it('says when the project file cannot be read', async () => {
    const root = tempRepo({ 'audio-studio.json': { name: 3 } })
    const result = await checkSetup(join(root, 'audio-studio.json'), credit, mac, {})
    expect(result.ok).toBe(false)
  })
})

describe('checkSetup, requests at once', () => {
  it('reads parallel and the tier from the project file', async () => {
    const quality = (q: Record<string, unknown>) =>
      projectJson({ narration: { ...(projectJson().narration as object), quality: q } })
    const states = async (project: Record<string, unknown>) => {
      const root = tempRepo({ 'audio-studio.json': project, '.env': 'FISH_AUDIO_API_KEY=k\n' })
      const result = await checkSetup(join(root, 'audio-studio.json'), credit, mac, {})
      if (!result.ok) throw new Error('expected checks')
      return result.checks.find((c) => c.id === 'requests')!
    }
    expect(await states(quality({ parallel: 8 }))).toMatchObject({
      state: 'problem',
      tier: { chosen: null },
    })
    expect(await states(quality({ parallel: 8, fishTier: '100' }))).toMatchObject({
      state: 'ok',
      tier: { chosen: '100' },
    })
    expect(await states(quality({ parallel: 8, fishTier: 'under-100' })).then((c) => c.fix)).toBe(
      'Set quality.parallel to 5 or less in the project file.',
    )
  })

  it('checks the music generator in a project with music, against the models folder', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson({ music: musicSection }),
      'models/acestep-v15-xl-turbo/.keep': '',
    })
    const run = async () => {
      const result = await checkSetup(join(root, 'audio-studio.json'), credit, mac, {
        ACESTEP_CHECKPOINTS: join(root, 'models'),
      })
      if (!result.ok) throw new Error('expected checks')
      return result.checks.find((c) => c.id === 'music')
    }
    expect(await run()).toMatchObject({
      state: 'problem',
      detail: expect.stringContaining('acestep-5Hz-lm-4B'),
    })
    await Bun.write(join(root, 'models/acestep-5Hz-lm-4B/.keep'), '')
    expect(await run()).toMatchObject({ state: 'ok' })
  })

  it('checks the model the project names, and says which one is missing', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson({ music: { ...musicSection, model: 'careful' } }),
      'models/acestep-v15-xl-turbo/.keep': '',
      'models/acestep-5Hz-lm-4B/.keep': '',
    })
    const result = await checkSetup(join(root, 'audio-studio.json'), credit, mac, {
      ACESTEP_CHECKPOINTS: join(root, 'models'),
    })
    if (!result.ok) throw new Error('expected checks')
    const check = result.checks.find((c) => c.id === 'music')
    expect(check).toMatchObject({
      state: 'problem',
      detail: `The project's music model, Careful, is not on this computer: acestep-v15-xl-sft is missing from ${join(root, 'models')}.`,
      fix: expect.stringContaining('acestep-v15-xl-sft and acestep-5Hz-lm-4B'),
    })
  })

  it('checks the Stable Audio models in their own folder, whatever else is set', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson({ music: musicSection }),
      'stable/stable-audio-open-1.0/.keep': '',
    })
    const run = async (model?: string) => {
      if (model) {
        await Bun.write(
          join(root, 'audio-studio.json'),
          JSON.stringify(projectJson({ music: { ...musicSection, model } })),
        )
      }
      const result = await checkSetup(
        join(root, 'audio-studio.json'),
        credit,
        mac,
        { ACESTEP_CHECKPOINTS: join(root, 'models') },
        join(root, 'stable'),
      )
      if (!result.ok) throw new Error('expected checks')
      return result.checks.find((c) => c.id === 'stableAudio')
    }
    expect(await run()).toMatchObject({
      state: 'off',
      label: 'Not set up',
      detail: 'Short is in place; Shortest is missing from ~/.cache/stable-audio.',
    })
    await Bun.write(join(root, 'stable/stable-audio-open-small/.keep'), '')
    expect(await run()).toMatchObject({ state: 'ok' })
    await rm(join(root, 'stable/stable-audio-open-1.0'), { recursive: true })
    expect(await run('short')).toMatchObject({ state: 'problem' })
  })
})

describe('checkSetup of the image models', () => {
  const imagesSection = {
    paths: {
      list: 'tts/{part}/images.json',
      style: 'images/style.json',
      prompts: 'images/prompts.json',
      lock: 'images/images.lock.json',
      clips: 'web/images',
      manifest: 'web/images/manifest.json',
    },
  }
  const noAccount = async (): Promise<ElevenAnswer> => ({
    ok: false,
    reason: 'no-key',
    message: 'no key',
  })
  const check = async (
    images: Record<string, unknown> | undefined,
    machine: Machine,
    here: (model: string) => boolean,
  ) => {
    const root = tempRepo({ 'audio-studio.json': projectJson(images ? { images } : {}) })
    const result = await checkSetup(
      join(root, 'audio-studio.json'),
      credit,
      machine,
      {},
      undefined,
      noAccount,
      { installed: here, ready: () => mfluxReady(machine) },
    )
    if (!result.ok) throw new Error('expected checks')
    return result.checks.find((c) => c.id === 'imageModels')!
  }

  it('finds which models are missing and whether mflux can run', async () => {
    expect(await check(imagesSection, mac, () => true)).toMatchObject({ state: 'ok' })
    expect(await check(imagesSection, mac, (m) => m === 'klein')).toMatchObject({
      state: 'off',
      label: 'Not set up',
    })
    expect(
      await check({ ...imagesSection, model: 'z-image-turbo' }, mac, (m) => m === 'klein'),
    ).toMatchObject({
      state: 'problem',
    })
    expect(await check(imagesSection, { ...mac, which: () => false }, () => true)).toMatchObject({
      state: 'problem',
      detail: "Images can't be made: mflux, which runs the image models, is not installed.",
    })
  })

  it('is not used without an images section', async () => {
    expect(await check(undefined, mac, () => true)).toMatchObject({ label: 'Not used' })
  })
})

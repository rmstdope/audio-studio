import { describe, expect, it } from 'bun:test'
import { setupChecks, type ElevenAccount, type SetupFacts } from './setup'

const ready: SetupFacts = {
  ffmpeg: true,
  uv: true,
  appleSilicon: true,
  transcriber: 'mlx-whisper',
  whisperModel: 'mlx-community/whisper-large-v3-turbo',
  envPath: '.env',
  key: true,
  fish: { ok: true, credit: 12.5 },
  refreshDialog: true,
  parallel: 4,
  fishTier: null,
  music: { ready: { ok: true }, checkpoints: '/models', model: 'balanced', stableAudioMissing: [] },
  images: { mflux: { ok: true }, model: 'klein', missing: [] },
  elevenlabs: { ok: false, reason: 'no-key', message: 'x' },
}

/** An ElevenLabs Starter account as `GET /v1/user/subscription` describes it. */
const starter: ElevenAccount = {
  tier: 'starter',
  charactersUsed: 2550,
  characterLimit: 30000,
  renewsAt: Date.UTC(2026, 10, 12, 9) / 1000,
  overage: 0,
  voiceSlots: { used: 3, limit: 10 },
}

const byId = (facts: SetupFacts) => Object.fromEntries(setupChecks(facts).map((c) => [c.id, c]))

describe('setupChecks', () => {
  it('finds everything in place on a ready machine', () => {
    const checks = setupChecks(ready)
    expect(checks.map((c) => c.id)).toEqual([
      'ffmpeg',
      'whisper',
      'key',
      'fish',
      'requests',
      'refresh',
      'music',
      'stableAudio',
      'imageModels',
      'elevenlabsKey',
      'elevenlabs',
    ])
    expect(checks.filter((c) => c.state !== 'ok').map((c) => c.id)).toEqual([
      'elevenlabsKey',
      'elevenlabs',
    ])
    expect(byId(ready).fish!.credit).toBe(12.5)
  })

  it('names what is missing, and how to put it right', () => {
    const checks = byId({ ...ready, ffmpeg: false, uv: false, key: false })
    expect(checks.ffmpeg).toMatchObject({
      state: 'problem',
      fix: expect.stringContaining('brew install ffmpeg'),
    })
    expect(checks.whisper).toMatchObject({
      state: 'problem',
      fix: expect.stringContaining('brew install uv'),
    })
    expect(checks.key).toMatchObject({
      state: 'problem',
      fix: expect.stringMatching(/FISH_AUDIO_API_KEY=.*\.env/),
    })
  })

  it('says Whisper needs Apple silicon, or that checking is off', () => {
    expect(byId({ ...ready, appleSilicon: false }).whisper).toMatchObject({
      state: 'problem',
      fix: expect.stringContaining('"none"'),
    })
    expect(byId({ ...ready, transcriber: 'none', uv: false }).whisper).toMatchObject({
      state: 'off',
    })
  })

  it('reports Fish not answering, and does not ask Fish without a key', () => {
    const silent = byId({
      ...ready,
      fish: { ok: false, reason: 'fish', message: 'Fish Audio answered 401: bad key' },
    })
    expect(silent.fish).toMatchObject({ state: 'problem', detail: expect.stringContaining('401') })
    const noKey = byId({
      ...ready,
      key: false,
      fish: { ok: false, reason: 'no-key', message: 'x' },
    })
    expect(noKey.fish!.state).toBe('off')
  })

  it('treats refreshDialog as optional', () => {
    expect(byId({ ...ready, refreshDialog: false }).refresh!.state).toBe('off')
  })
})

describe('the requests-at-once check', () => {
  const requests = (facts: Partial<SetupFacts>) => byId({ ...ready, ...facts }).requests!

  it('is ready with no tier when parallel is within what every account allows', () => {
    expect(requests({ parallel: 4 })).toMatchObject({
      title: 'Requests at once',
      state: 'ok',
      detail: 'Recording sends 4 at a time, which every Fish account allows.',
      tier: { chosen: null },
    })
    expect(requests({ parallel: 5 }).state).toBe('ok')
  })

  it('asks for the tier when parallel is above 5 and none is chosen', () => {
    expect(requests({ parallel: 8 })).toMatchObject({
      state: 'problem',
      detail:
        'Recording sends 8 at a time. Fish allows 5 at once unless you have paid it $100 or more in total; say which to check it.',
      tier: { chosen: null },
    })
    expect(requests({ parallel: 8 }).fix).toBeUndefined()
  })

  it('is ready when a chosen tier allows parallel', () => {
    expect(requests({ parallel: 8, fishTier: '100' })).toMatchObject({
      state: 'ok',
      detail: 'Recording sends 8 at a time; your account allows 15.',
      tier: { chosen: '100' },
    })
    expect(requests({ parallel: 15, fishTier: '100' }).state).toBe('ok')
  })

  it('warns, with the fix as text, when parallel is above the chosen tier', () => {
    expect(requests({ parallel: 8, fishTier: 'under-100' })).toMatchObject({
      state: 'problem',
      detail:
        'Recording sends 8 at a time, but your account allows 5. Fish will turn the extra requests away and recording will slow down while the studio waits and retries.',
      fix: 'Set quality.parallel to 5 or less in the project file.',
      tier: { chosen: 'under-100' },
    })
    expect(requests({ parallel: 60, fishTier: '1000' })).toMatchObject({
      state: 'problem',
      fix: 'Set quality.parallel to 50 or less in the project file.',
    })
  })

  it('is not used without a key, and shows no menu', () => {
    const check = requests({ key: false, parallel: 8, fishTier: '100' })
    expect(check).toMatchObject({ state: 'off', detail: 'Not checked: there is no key.' })
    expect(check.tier).toBeUndefined()
  })

  describe('the music generator', () => {
    it('is off in a project without music', () => {
      expect(byId({ ...ready, music: null }).music).toMatchObject({ state: 'off' })
    })

    it('is not needed while the project’s music model is Eleven Music, on any computer', () => {
      const music = {
        ready: {
          ok: false as const,
          message: 'ACE-Step runs on macOS with Apple silicon only.',
          fix: 'Music is made on a Mac with Apple silicon; there is nothing to install on this computer.',
        },
        checkpoints: '/models',
        model: 'eleven' as const,
        stableAudioMissing: [],
      }
      expect(byId({ ...ready, music }).music).toMatchObject({
        state: 'off',
        detail:
          "Not needed while the project's music model is Eleven Music, made by ElevenLabs in the cloud (its rows are below).",
      })
    })

    it('says what is missing and where the models go', () => {
      const music = {
        ready: {
          ok: false as const,
          message: 'The models are not in /models: acestep-5Hz-lm-4B.',
          fix: 'Put the models acestep-v15-xl-turbo and acestep-5Hz-lm-4B in /models.',
        },
        checkpoints: '/models',
        model: 'balanced' as const,
        stableAudioMissing: [],
      }
      expect(byId({ ...ready, music }).music).toMatchObject({
        title: 'Music generator (ACE-Step)',
        state: 'problem',
        detail: 'The models are not in /models: acestep-5Hz-lm-4B.',
        fix: expect.stringContaining('acestep-v15-xl-turbo'),
      })
      expect(byId({ ...ready, music }).music!.fix).toContain('/models')
    })

    it('says only the machine was checked when the project’s model is a Stable Audio one', () => {
      const music = { ...ready.music!, model: 'short' as const }
      expect(byId({ ...ready, music }).music).toMatchObject({
        state: 'ok',
        detail:
          "uv is in place. ACE-Step's models are not checked while the project's music model is a Stable Audio one.",
      })
    })

    it('gives the fix the generator found, whatever the problem is', () => {
      const music = {
        ready: { ok: false as const, message: 'uv is not on the PATH.', fix: 'brew install uv' },
        checkpoints: '/models',
        model: 'balanced' as const,
        stableAudioMissing: [],
      }
      expect(byId({ ...ready, music }).music).toMatchObject({ fix: 'brew install uv' })
    })
  })

  describe('the Stable Audio row', () => {
    const music = (
      stableAudioMissing: ('short' | 'shortest')[],
      model: 'balanced' | 'short' = 'balanced',
    ) => ({
      ...ready,
      music: { ready: { ok: true as const }, checkpoints: '/models', model, stableAudioMissing },
    })
    const row = (facts: SetupFacts) => byId(facts).stableAudio!

    it('is not used without a music section', () => {
      expect(row({ ...ready, music: null })).toMatchObject({
        title: 'Music generator (Stable Audio Open)',
        state: 'off',
        detail: 'The project has no music section.',
      })
      expect(row({ ...ready, music: null }).steps).toBeUndefined()
      expect(row({ ...ready, music: null }).label).toBeUndefined()
    })

    it('is ready when both models are in place', () => {
      expect(row(music([]))).toMatchObject({
        state: 'ok',
        detail: 'Short and Shortest are in place; they load on the first take.',
      })
      expect(row(music([])).steps).toBeUndefined()
    })

    it('is optional, so "Not set up" and not a problem, when neither is here', () => {
      expect(row(music(['short', 'shortest']))).toMatchObject({
        state: 'off',
        label: 'Not set up',
        detail: 'Optional: for stingers and short loops. Its models are not on this computer.',
      })
    })

    it('names the one missing, and where', () => {
      expect(row(music(['shortest']))).toMatchObject({
        state: 'off',
        label: 'Not set up',
        detail: 'Short is in place; Shortest is missing from ~/.cache/stable-audio.',
      })
      expect(row(music(['short'])).detail).toBe(
        'Shortest is in place; Short is missing from ~/.cache/stable-audio.',
      )
    })

    it('needs attention when the project’s own music model is the one missing', () => {
      expect(row(music(['short', 'shortest'], 'short'))).toMatchObject({
        state: 'problem',
        detail:
          "The project's music model, Short, is not on this computer: stable-audio-open-1.0 is missing from ~/.cache/stable-audio.",
      })
      // The other being missing is not a problem for a project that does not use it.
      expect(row(music(['shortest'], 'short')).state).toBe('off')
    })

    it('gives three numbered steps, the licence pages, the token page and the download', () => {
      const { steps } = row(music(['short', 'shortest']))
      expect(steps?.list).toHaveLength(3)
      expect(steps?.list[0]).toEqual({
        parts: [
          "Sign in to Hugging Face and accept Stability AI's Community Licence on ",
          {
            link: 'stabilityai/stable-audio-open-1.0',
            href: 'https://huggingface.co/stabilityai/stable-audio-open-1.0',
          },
          ' and ',
          {
            link: 'stabilityai/stable-audio-open-small',
            href: 'https://huggingface.co/stabilityai/stable-audio-open-small',
          },
          '.',
        ],
      })
      expect(steps?.list[1]).toEqual({
        parts: [
          'Make a read token at ',
          {
            link: 'huggingface.co/settings/tokens',
            href: 'https://huggingface.co/settings/tokens',
          },
          '.',
        ],
      })
      expect(steps?.list[2]).toEqual({
        parts: ['Download both into ~/.cache/stable-audio, where the studio looks for them:'],
        commands: [
          'HF_TOKEN=… uvx --from huggingface_hub hf download stabilityai/stable-audio-open-1.0 --local-dir ~/.cache/stable-audio/stable-audio-open-1.0',
          'HF_TOKEN=… uvx --from huggingface_hub hf download stabilityai/stable-audio-open-small --local-dir ~/.cache/stable-audio/stable-audio-open-small',
        ],
      })
      expect(steps?.note).toBe('The studio never asks for or keeps your token.')
    })
  })
})

describe('the ElevenLabs rows', () => {
  const rows = (elevenlabs: SetupFacts['elevenlabs']) => {
    const checks = byId({ ...ready, elevenlabs })
    return { key: checks.elevenlabsKey!, account: checks.elevenlabs! }
  }

  it('are optional, and say where the key goes, without one', () => {
    const { key, account } = rows({ ok: false, reason: 'no-key', message: 'x' })
    expect(key).toMatchObject({
      title: 'ElevenLabs API key',
      state: 'off',
      label: 'Not set up',
      detail:
        'Optional: for ElevenLabs voices and music. No ELEVENLABS_API_KEY in the environment or in .env.',
      fix: 'Put ELEVENLABS_API_KEY=... in .env (from elevenlabs.io, Developers, API keys), or export it.',
    })
    expect(account).toMatchObject({
      title: 'ElevenLabs',
      state: 'off',
      detail: 'Not asked: there is no key.',
    })
  })

  it('show the plan, the characters left and when they renew, the voice slots and the terms', () => {
    const { key, account } = rows({ ok: true, account: starter })
    expect(key).toMatchObject({ state: 'ok', detail: 'Found.' })
    expect(account).toMatchObject({
      state: 'ok',
      detail: 'Answers. Starter plan: 27,450 of 30,000 credits left, renewing 12 November 2026.',
      notes: [
        'Nothing is billed beyond them: ElevenLabs work stops when they run out.',
        'Voice slots: 3 of 10 used.',
        "Music made with ElevenLabs may be used in a game while the game has earned under $500,000 and you under $1,000,000 a year from games (ElevenLabs' music terms of 9 October 2026); beyond that it needs their Enterprise Music plan.",
      ],
    })
  })

  it('say what usage beyond the plan may cost', () => {
    const notes = (overage: ElevenAccount['overage']) =>
      rows({ ok: true, account: { ...starter, overage } }).account.notes![0]
    expect(notes(5000)).toBe('Up to 5,000 more credits may be used beyond them, billed in dollars.')
    expect(notes('unlimited')).toBe('Usage beyond them is billed in dollars, without limit.')
  })

  it('say that the Free plan makes no music and allows no commercial use', () => {
    const { account } = rows({
      ok: true,
      account: {
        ...starter,
        tier: 'free',
        characterLimit: 10000,
        charactersUsed: 0,
        renewsAt: null,
      },
    })
    expect(account.detail).toBe('Answers. Free plan: 10,000 of 10,000 credits left.')
    expect(account.notes).toContain(
      'On the Free plan ElevenLabs makes no music through the API, and nothing it makes may be used commercially.',
    )
  })

  it('name a plan with more than one word plainly', () => {
    const { account } = rows({ ok: true, account: { ...starter, tier: 'creator_tier' } })
    expect(account.detail).toStartWith('Answers. Creator tier plan:')
  })

  it('report ElevenLabs not answering, with what to check', () => {
    expect(
      rows({ ok: false, reason: 'elevenlabs', message: 'ElevenLabs answered 401: invalid key' })
        .account,
    ).toMatchObject({
      state: 'problem',
      detail: 'Did not answer: ElevenLabs answered 401: invalid key',
      fix: 'Check the key, and that api.elevenlabs.io can be reached.',
    })
  })
})

describe('the image models check', () => {
  const row = (images: SetupFacts['images']) => byId({ ...ready, images }).imageModels!
  const here = { ok: true } as const
  const noMflux = {
    ok: false,
    message: 'mflux is not on the PATH; it makes the image takes.',
    fix: 'uv tool install mflux',
  } as const

  it('is not used by a project with no images section', () => {
    expect(row(null)).toMatchObject({
      title: 'Image models',
      state: 'off',
      label: 'Not used',
      detail: 'The project has no images section.',
    })
  })

  it('is ready with both models here', () => {
    expect(row({ mflux: here, model: 'klein', missing: [] })).toMatchObject({
      state: 'ok',
      detail:
        'FLUX.2 klein 4B and Z-Image-Turbo are on this computer; a model loads on its first take.',
    })
  })

  it('is optional when only the other model is missing, saying how to get it', () => {
    const found = row({ mflux: here, model: 'klein', missing: ['z-image-turbo'] })
    expect(found).toMatchObject({
      state: 'off',
      label: 'Not set up',
      detail: 'Optional: Z-Image-Turbo is not on this computer. FLUX.2 klein 4B is in place.',
      steps: { note: 'Then press Check again.' },
    })
    expect(found.steps!.list).toEqual([
      {
        parts: ['Download it, once (about 31 GB):'],
        commands: ['uvx --from huggingface_hub hf download Tongyi-MAI/Z-Image-Turbo'],
      },
    ])
    expect(row({ mflux: here, model: 'z-image-turbo', missing: ['klein'] })).toMatchObject({
      state: 'off',
      detail: 'Optional: FLUX.2 klein 4B is not on this computer. Z-Image-Turbo is in place.',
    })
  })

  it('needs attention when the project’s model is missing and the other is here', () => {
    const found = row({ mflux: here, model: 'klein', missing: ['klein'] })
    expect(found).toMatchObject({
      state: 'problem',
      detail:
        "The project's image model, FLUX.2 klein 4B, is not on this computer. Z-Image-Turbo is in place: an image's takes can use it meanwhile.",
    })
    expect(found.steps!.list[0]).toEqual({
      parts: ['Download it, once (about 15 GB):'],
      commands: ['uvx --from huggingface_hub hf download black-forest-labs/FLUX.2-klein-4B'],
    })
  })

  it('says images can’t be made without mflux, with the steps to install it and get the models', () => {
    const found = row({ mflux: noMflux, model: 'klein', missing: ['klein', 'z-image-turbo'] })
    expect(found).toMatchObject({
      state: 'problem',
      detail: "Images can't be made: mflux, which runs the image models, is not installed.",
    })
    expect(found.steps!.list.map((step) => step.parts[0])).toEqual([
      'Install mflux:',
      'Download the models, once (about 15 GB and 31 GB):',
    ])
    expect(found.steps!.list[0]!.commands).toEqual(['uv tool install mflux'])
  })

  it('names the machine when mflux cannot run at all, and both missing models when mflux is here', () => {
    const noMac = {
      ok: false,
      message: 'Image takes are made on macOS with Apple silicon only.',
      fix: 'nothing to install',
    } as const
    expect(row({ mflux: noMac, model: 'klein', missing: [] })).toMatchObject({
      state: 'problem',
      detail: 'Image takes are made on macOS with Apple silicon only.',
    })
    expect(row({ mflux: here, model: 'klein', missing: ['klein', 'z-image-turbo'] })).toMatchObject(
      {
        state: 'problem',
        detail: "Images can't be made: neither image model is on this computer.",
      },
    )
  })
})

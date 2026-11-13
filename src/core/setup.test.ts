import { imageModel } from './imageModels'
import { describe, expect, it } from 'bun:test'
import {
  effectModelsRow,
  stableAudioRow,
  setupChecks,
  type EffectFamily,
  type EffectFamilyModel,
  type ElevenAccount,
  type SetupFacts,
} from './setup'

const ready: SetupFacts = {
  ffmpeg: true,
  uv: true,
  appleSilicon: true,
  transcriber: 'mlx-whisper',
  whisperModel: 'mlx-community/whisper-large-v3-turbo',
  envPath: '.env',
  key: true,
  fish: { ok: true, credit: 12.5 },
  refreshPart: true,
  parallel: 4,
  fishTier: null,
  music: { ready: { ok: true }, checkpoints: '/models', model: 'balanced', stableAudioMissing: [] },
  images: imageFacts({}),
  effects: effectFacts({}),
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

type EffectModelFact = SetupFacts['effects']['models']['small-sfx']

/** The sound-effect facts of a machine whose models are whole and well and whose game lists effects, with these changes. */
function effectFacts(change: {
  uv?: boolean
  listed?: boolean
  model?: 'small-sfx' | 'open-1'
  small?: Partial<EffectModelFact>
  open?: Partial<EffectModelFact>
}): SetupFacts['effects'] {
  const whole: EffectModelFact = { download: 'whole', failure: null }
  return {
    uv: change.uv ?? true,
    listed: change.listed ?? true,
    model: change.model ?? 'small-sfx',
    models: {
      'small-sfx': { ...whole, ...change.small },
      'open-1': { ...whole, ...change.open },
    },
  }
}

/** The image facts of a project whose models are whole and well, with these changes. */
function imageFacts(change: {
  mflux?: NonNullable<SetupFacts['images']>['mflux']
  model?: 'klein' | 'z-image-turbo' | 'qwen-image'
  klein?: Partial<NonNullable<SetupFacts['images']>['models']['klein']>
  'z-image-turbo'?: Partial<NonNullable<SetupFacts['images']>['models']['z-image-turbo']>
  'qwen-image'?: Partial<NonNullable<SetupFacts['images']>['models']['qwen-image']>
  patchModel?: NonNullable<SetupFacts['images']>['patchModel']
}): NonNullable<SetupFacts['images']> {
  return {
    mflux: change.mflux ?? { ok: true },
    model: change.model ?? 'klein',
    patchModel: change.patchModel ?? 'whole',
    models: {
      klein: { download: 'whole', failure: null, ...change.klein },
      'z-image-turbo': { download: 'whole', failure: null, ...change['z-image-turbo'] },
      'qwen-image': { download: 'whole', failure: null, ...change['qwen-image'] },
    },
  }
}

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
      'effectModels',
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

  it('treats refresh.part as optional', () => {
    expect(byId({ ...ready, refreshPart: false }).refresh!.state).toBe('off')
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
      fix: 'Set generate.parallel to 5 or less in the project file.',
      tier: { chosen: 'under-100' },
    })
    expect(requests({ parallel: 60, fishTier: '1000' })).toMatchObject({
      state: 'problem',
      fix: 'Set generate.parallel to 50 or less in the project file.',
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
    reason: 'mflux',
    message: 'mflux is not on the PATH; it makes the image takes.',
    fix: 'uv tool install mflux',
  } as const
  const bridge = { id: 'bridge', title: 'Bridge at dusk' }
  const KLEIN = 'uvx --from huggingface_hub hf download black-forest-labs/FLUX.2-klein-4B'
  const ZIMAGE = 'uvx --from huggingface_hub hf download Tongyi-MAI/Z-Image-Turbo'
  const failure = { error: 'FileNotFoundError: No safetensors', image: bridge }

  it('is not used by a project with no images section', () => {
    expect(row(null)).toMatchObject({
      title: 'Image models',
      state: 'off',
      label: 'Not used',
      detail: 'The project has no images section.',
    })
  })

  it('is ready with all three models whole and no failed take', () => {
    expect(row(imageFacts({}))).toMatchObject({
      state: 'ok',
      detail:
        'FLUX.2 klein 4B, Z-Image-Turbo and Qwen-Image are fully downloaded on this computer; a model loads on its first take.',
    })
  })

  const QWEN = 'uvx --from huggingface_hub hf download Qwen/Qwen-Image-Edit-2511'

  it('says nothing of the patch model while it is whole', () => {
    expect(row(imageFacts({}))).not.toHaveProperty('notes')
  })

  it('offers Qwen Image Edit as optional for patches, with its download command, without changing the state', () => {
    const absent = row(imageFacts({ patchModel: 'absent' }))
    expect(absent).toMatchObject({ state: 'ok' })
    expect(absent.notes).toEqual([
      'Optional: for patches. Qwen Image Edit is not on this computer.',
    ])
    expect(absent.steps).toEqual({
      list: [{ parts: ['Download it, once (about 58 GB):'], commands: [QWEN] }],
      note: 'Then press Check again.',
    })
    const partial = row(imageFacts({ patchModel: 'partial' }))
    expect(partial.notes).toEqual([
      "Optional: for patches. Qwen Image Edit's download is incomplete.",
    ])
    expect(partial.steps!.list[0]).toEqual({
      parts: ['Finish the download (it picks up where it stopped):'],
      commands: [QWEN],
    })
  })

  it('adds the patch model after the steps another model needs', () => {
    const both = row(imageFacts({ 'z-image-turbo': { download: 'absent' }, patchModel: 'absent' }))
    expect(both.steps!.list).toHaveLength(2)
    expect(both.steps!.list[1]!.commands).toEqual([QWEN])
  })

  it('does not offer it when mflux cannot run at all', () => {
    expect(row(imageFacts({ mflux: noMflux, patchModel: 'absent' }))).not.toHaveProperty('notes')
  })

  it('is optional when only the other model is missing or incomplete, saying how to get it', () => {
    const missing = row(imageFacts({ 'z-image-turbo': { download: 'absent' } }))
    expect(missing).toMatchObject({
      state: 'off',
      label: 'Not set up',
      detail:
        'Optional: Z-Image-Turbo is not on this computer. FLUX.2 klein 4B and Qwen-Image are in place.',
      steps: { note: 'Then press Check again.' },
    })
    expect(missing.steps!.list).toEqual([
      { parts: ['Download it, once (about 31 GB):'], commands: [ZIMAGE] },
    ])
    const partial = row(imageFacts({ 'z-image-turbo': { download: 'partial' } }))
    expect(partial).toMatchObject({
      state: 'off',
      label: 'Not set up',
      detail:
        "Optional: Z-Image-Turbo's download is incomplete, so it can't run. FLUX.2 klein 4B and Qwen-Image are in place.",
    })
    expect(partial.steps!.list).toEqual([
      { parts: ['Finish the download (it picks up where it stopped):'], commands: [ZIMAGE] },
    ])
    expect(
      row(imageFacts({ klein: { download: 'absent' }, model: 'z-image-turbo' })),
    ).toMatchObject({
      state: 'off',
      detail:
        'Optional: FLUX.2 klein 4B is not on this computer. Z-Image-Turbo and Qwen-Image are in place.',
    })
  })

  it('needs attention when the project’s model is missing or incomplete and the other is whole', () => {
    const missing = row(imageFacts({ klein: { download: 'absent' } }))
    expect(missing).toMatchObject({
      state: 'problem',
      detail:
        "The project's image model, FLUX.2 klein 4B, is not on this computer. Z-Image-Turbo and Qwen-Image are in place: an image's takes can use them meanwhile.",
    })
    expect(missing.steps!.list[0]).toEqual({
      parts: ['Download it, once (about 15 GB):'],
      commands: [KLEIN],
    })
    const partial = row(imageFacts({ klein: { download: 'partial' } }))
    expect(partial).toMatchObject({
      state: 'problem',
      detail:
        "The project's image model, FLUX.2 klein 4B, is only partly downloaded, so it can't run. Z-Image-Turbo and Qwen-Image are in place: an image's takes can use them meanwhile.",
    })
    expect(partial.steps!.list).toEqual([
      { parts: ['Finish the download (it picks up where it stopped):'], commands: [KLEIN] },
    ])
  })

  const noQwen = { download: 'absent' } as const
  const QWEN_IMAGE = 'uvx --from huggingface_hub hf download Qwen/Qwen-Image'
  const qwenGb = imageModel('qwen-image').gigabytes

  it('says images can’t be made when no model can run, naming each, with a step for the usual models and an Optional one for Qwen-Image', () => {
    const found = row(
      imageFacts({
        klein: { download: 'partial' },
        'z-image-turbo': { download: 'absent' },
        'qwen-image': noQwen,
      }),
    )
    expect(found).toMatchObject({
      state: 'problem',
      detail:
        "Images can't be made: FLUX.2 klein 4B's download is incomplete, Z-Image-Turbo is not on this computer and Qwen-Image is not on this computer.",
    })
    expect(found.steps!.list).toEqual([
      { parts: ['Finish the download (it picks up where it stopped):'], commands: [KLEIN] },
      { parts: ['Download it, once (about 31 GB):'], commands: [ZIMAGE] },
      {
        parts: [
          `Optional: for an image's takes. Qwen-Image is not on this computer. Download it, once (about ${qwenGb} GB):`,
        ],
        commands: [QWEN_IMAGE],
      },
    ])
    expect(
      row(
        imageFacts({
          klein: { download: 'partial' },
          'z-image-turbo': { download: 'partial' },
          'qwen-image': { download: 'partial' },
        }),
      ).detail,
    ).toBe(
      "Images can't be made: FLUX.2 klein 4B's download is incomplete, Z-Image-Turbo's download is incomplete and Qwen-Image's download is incomplete.",
    )
    const none = row(
      imageFacts({
        klein: { download: 'absent' },
        'z-image-turbo': { download: 'absent' },
        'qwen-image': noQwen,
      }),
    )
    expect(none).toMatchObject({
      state: 'problem',
      detail: "Images can't be made: no image model is on this computer.",
    })
    expect(none.steps!.list[0]).toEqual({
      parts: ['Download the models, once (about 15 GB and 31 GB):'],
      commands: [KLEIN, ZIMAGE],
    })
    expect(none.steps!.list).toHaveLength(2)
    expect(none).not.toHaveProperty('notes')
  })

  it('puts Qwen-Image in the main download step when it is the project’s model and nothing can run', () => {
    const none = row(
      imageFacts({
        model: 'qwen-image',
        klein: { download: 'absent' },
        'z-image-turbo': { download: 'absent' },
        'qwen-image': noQwen,
      }),
    )
    expect(none.detail).toBe("Images can't be made: no image model is on this computer.")
    expect(none.steps!.list).toEqual([
      {
        parts: [`Download the models, once (about 15 GB, 31 GB and ${qwenGb} GB):`],
        commands: [KLEIN, ZIMAGE, QWEN_IMAGE],
      },
    ])
  })

  it('does not say images can’t be made while Qwen-Image alone is whole', () => {
    const found = row(
      imageFacts({ klein: { download: 'absent' }, 'z-image-turbo': { download: 'absent' } }),
    )
    expect(found).toMatchObject({
      state: 'problem',
      detail:
        "The project's image model, FLUX.2 klein 4B, is not on this computer. Z-Image-Turbo is not on this computer. Qwen-Image is in place: an image's takes can use it meanwhile.",
    })
    expect(found.steps!.list).toEqual([
      {
        parts: ['Download the models, once (about 15 GB and 31 GB):'],
        commands: [KLEIN, ZIMAGE],
      },
    ])
    expect(found).not.toHaveProperty('notes')
  })

  it('offers Qwen-Image as optional while it is not the project’s model and not whole, without changing the state', () => {
    const absent = row(imageFacts({ 'qwen-image': noQwen }))
    expect(absent).toMatchObject({
      state: 'ok',
      detail:
        'FLUX.2 klein 4B and Z-Image-Turbo are fully downloaded on this computer; a model loads on its first take.',
      notes: ["Optional: for an image's takes. Qwen-Image is not on this computer."],
      steps: {
        list: [{ parts: [`Download it, once (about ${qwenGb} GB):`], commands: [QWEN_IMAGE] }],
        note: 'Then press Check again.',
      },
    })
    const partial = row(imageFacts({ 'qwen-image': { download: 'partial' } }))
    expect(partial).toMatchObject({
      state: 'ok',
      notes: ["Optional: for an image's takes. Qwen-Image's download is incomplete."],
      steps: {
        list: [
          {
            parts: ['Finish the download (it picks up where it stopped):'],
            commands: [QWEN_IMAGE],
          },
        ],
      },
    })
  })

  it('puts Qwen-Image’s Optional line above Qwen Image Edit’s, a step each', () => {
    const both = row(imageFacts({ 'qwen-image': noQwen, patchModel: 'absent' }))
    expect(both.notes).toEqual([
      "Optional: for an image's takes. Qwen-Image is not on this computer.",
      'Optional: for patches. Qwen Image Edit is not on this computer.',
    ])
    expect(both.steps!.list.map((step) => step.commands)).toEqual([[QWEN_IMAGE], [QWEN]])
  })

  it('keeps Qwen-Image’s Optional line beside another model’s trouble, after its step', () => {
    const found = row(imageFacts({ 'z-image-turbo': { download: 'absent' }, 'qwen-image': noQwen }))
    expect(found).toMatchObject({
      state: 'off',
      label: 'Not set up',
      detail: 'Optional: Z-Image-Turbo is not on this computer. FLUX.2 klein 4B is in place.',
      notes: ["Optional: for an image's takes. Qwen-Image is not on this computer."],
    })
    expect(found.steps!.list.map((step) => step.commands)).toEqual([[ZIMAGE], [QWEN_IMAGE]])
  })

  it('does not offer Qwen-Image when mflux cannot run', () => {
    expect(row(imageFacts({ mflux: noMflux, 'qwen-image': noQwen }))).not.toHaveProperty('notes')
  })

  it('needs attention when Qwen-Image is the project’s model and is missing or incomplete', () => {
    const missing = row(imageFacts({ model: 'qwen-image', 'qwen-image': noQwen }))
    expect(missing).toMatchObject({
      state: 'problem',
      detail:
        "The project's image model, Qwen-Image, is not on this computer. FLUX.2 klein 4B and Z-Image-Turbo are in place: an image's takes can use them meanwhile.",
    })
    expect(missing).not.toHaveProperty('notes')
    expect(missing.steps!.list).toEqual([
      { parts: [`Download it, once (about ${qwenGb} GB):`], commands: [QWEN_IMAGE] },
    ])
    expect(
      row(imageFacts({ model: 'qwen-image', 'qwen-image': { download: 'partial' } })).detail,
    ).toBe(
      "The project's image model, Qwen-Image, is only partly downloaded, so it can't run. FLUX.2 klein 4B and Z-Image-Turbo are in place: an image's takes can use them meanwhile.",
    )
  })

  it('treats Qwen-Image’s failed last take like another model’s', () => {
    const other = row(imageFacts({ 'qwen-image': { failure } }))
    expect(other).toMatchObject({ state: 'off', label: 'Not set up', detail: '' })
    expect(other.failures).toEqual([
      {
        sentence:
          'Optional: the last take with Qwen-Image failed on Bridge at dusk. FLUX.2 klein 4B and Z-Image-Turbo are in place.',
        error: 'FileNotFoundError: No safetensors',
        link: { text: 'Open Bridge at dusk', href: '#/images/items/bridge' },
        clears: 'This clears when a take with Qwen-Image works.',
      },
    ])
    const main = row(imageFacts({ model: 'qwen-image', 'qwen-image': { failure } }))
    expect(main.state).toBe('problem')
    expect(main.failures![0]!.sentence).toBe(
      "The last take with Qwen-Image, the project's image model, failed on Bridge at dusk. FLUX.2 klein 4B and Z-Image-Turbo are in place: an image's takes can use them meanwhile.",
    )
  })

  it('keeps Ready when a stale failure is remembered for a Qwen-Image that is not whole', () => {
    for (const download of ['absent', 'partial'] as const) {
      const found = row(imageFacts({ 'qwen-image': { download, failure } }))
      expect(found).toMatchObject({ state: 'ok' })
      expect(found.failures).toBeUndefined()
      expect(found.notes).toHaveLength(1)
    }
  })

  it('leads with the project’s model when it and another are missing', () => {
    const found = row(
      imageFacts({
        model: 'qwen-image',
        klein: { download: 'absent' },
        'qwen-image': { download: 'absent' },
      }),
    )
    expect(
      found.detail.startsWith("The project's image model, Qwen-Image, is not on this computer."),
    ).toBe(true)
  })

  it('says the incomplete download of Qwen-Image, not its failure', () => {
    const found = row(
      imageFacts({ model: 'qwen-image', 'qwen-image': { download: 'partial', failure } }),
    )
    expect(found.detail).toContain('only partly downloaded')
    expect(found.failures).toBeUndefined()
  })

  it('says the other model’s failed last take is optional, with the error, the link and what clears it', () => {
    const found = row(imageFacts({ 'z-image-turbo': { failure } }))
    expect(found).toMatchObject({ state: 'off', label: 'Not set up', detail: '' })
    expect(found.failures).toEqual([
      {
        sentence:
          'Optional: the last take with Z-Image-Turbo failed on Bridge at dusk. FLUX.2 klein 4B and Qwen-Image are in place.',
        error: 'FileNotFoundError: No safetensors',
        link: { text: 'Open Bridge at dusk', href: '#/images/items/bridge' },
        clears: 'This clears when a take with Z-Image-Turbo works.',
      },
    ])
    expect(found.steps).toBeUndefined()
  })

  it('needs attention when the main model’s last take failed', () => {
    const found = row(imageFacts({ klein: { failure } }))
    expect(found.state).toBe('problem')
    expect(found.failures).toEqual([
      {
        sentence:
          "The last take with FLUX.2 klein 4B, the project's image model, failed on Bridge at dusk. Z-Image-Turbo and Qwen-Image are in place: an image's takes can use them meanwhile.",
        error: 'FileNotFoundError: No safetensors',
        link: { text: 'Open Bridge at dusk', href: '#/images/items/bridge' },
        clears: 'This clears when a take with FLUX.2 klein 4B works.',
      },
    ])
  })

  it('names each model whose last take failed, one sentence each', () => {
    const found = row(
      imageFacts({ klein: { failure }, 'z-image-turbo': { failure: { ...failure, image: null } } }),
    )
    expect(found.state).toBe('problem')
    expect(found.failures!.map((f) => f.sentence)).toEqual([
      "The last take with FLUX.2 klein 4B, the project's image model, failed on Bridge at dusk.",
      'The last take with Z-Image-Turbo failed.',
    ])
    expect(found.failures![1]!.link).toBeUndefined()
    expect(found.failures!.map((f) => f.clears)).toEqual([
      'This clears when a take with FLUX.2 klein 4B works.',
      'This clears when a take with Z-Image-Turbo works.',
    ])
  })

  it('leaves out the image’s name and link once the image is gone', () => {
    const found = row(imageFacts({ 'z-image-turbo': { failure: { ...failure, image: null } } }))
    expect(found.failures![0]).toMatchObject({
      sentence:
        'Optional: the last take with Z-Image-Turbo failed. FLUX.2 klein 4B and Qwen-Image are in place.',
      error: 'FileNotFoundError: No safetensors',
    })
    expect(found.failures![0]!.link).toBeUndefined()
  })

  it('says the incomplete download, not the failure, for a model that is both', () => {
    const found = row(imageFacts({ klein: { download: 'partial', failure } }))
    expect(found.detail).toContain('only partly downloaded')
    expect(found.failures).toBeUndefined()
  })

  it('says an incomplete model and a failed one each', () => {
    const found = row(imageFacts({ klein: { download: 'partial' }, 'z-image-turbo': { failure } }))
    expect(found.state).toBe('problem')
    expect(found.detail).toBe(
      "The project's image model, FLUX.2 klein 4B, is only partly downloaded, so it can't run. Qwen-Image is in place: an image's takes can use it meanwhile.",
    )
    expect(found.failures!.map((f) => f.sentence)).toEqual([
      'The last take with Z-Image-Turbo failed on Bridge at dusk.',
    ])
    expect(found.steps!.list).toHaveLength(1)
  })

  it('says images can’t be made without mflux, with the steps to install it and get the models', () => {
    const found = row(
      imageFacts({
        mflux: noMflux,
        klein: { download: 'absent' },
        'z-image-turbo': { download: 'absent' },
      }),
    )
    expect(found).toMatchObject({
      state: 'problem',
      detail: "Images can't be made: mflux, which runs the image models, is not installed.",
    })
    expect(found.steps!.list.map((step) => step.parts[0])).toEqual([
      'Install mflux:',
      'Download the models, once (about 15 GB and 31 GB):',
    ])
    expect(found.steps!.list[0]!.commands).toEqual(['uv tool install --upgrade mflux'])
  })

  it('names the machine when mflux cannot run at all', () => {
    const noMac = {
      ok: false,
      reason: 'platform',
      message: 'Image takes are made on macOS with Apple silicon only.',
      fix: 'nothing to install',
    } as const
    expect(row(imageFacts({ mflux: noMac }))).toMatchObject({
      state: 'problem',
      detail: 'Image takes are made on macOS with Apple silicon only.',
    })
    void here
  })
})

describe('the Sound-effect models row', () => {
  const row = (effects: SetupFacts['effects']) => byId({ ...ready, effects }).effectModels!
  const opening = "Optional: for the game's sound effects."
  const smallCommand =
    'HF_TOKEN=… uvx --from huggingface_hub hf download stabilityai/stable-audio-3-small-sfx'
  const openCommand =
    'HF_TOKEN=… uvx --from huggingface_hub hf download stabilityai/stable-audio-open-1.0 --local-dir ~/.cache/stable-audio/stable-audio-open-1.0'
  const tokenStep = {
    parts: [
      'Make a read token at ',
      { link: 'huggingface.co/settings/tokens', href: 'https://huggingface.co/settings/tokens' },
      '.',
    ],
  }
  const licence = (repo: string) => ({
    parts: [
      "Sign in to Hugging Face and accept Stability AI's Community Licence on ",
      { link: repo, href: `https://huggingface.co/${repo}` },
      '.',
    ],
  })
  const chest = { id: 'chest-open', title: 'Chest open' }

  it('is ready with both models whole, uv there and no failed effect', () => {
    expect(row(effectFacts({}))).toMatchObject({
      title: 'Sound-effect models',
      state: 'ok',
      detail:
        'Stable Audio 3 Small SFX and Stable Audio Open 1.0 are fully downloaded on this computer; a model loads on its first effect.',
    })
  })

  it('calls the other model missing optional, with its own three steps', () => {
    const check = row(effectFacts({ open: { download: 'absent' } }))
    expect(check).toMatchObject({
      state: 'off',
      label: 'Not set up',
      detail:
        'Optional: Stable Audio Open 1.0 is not on this computer. Stable Audio 3 Small SFX is in place.',
      steps: {
        note: 'The studio never asks for or keeps your token. Then press Check again.',
        list: [
          licence('stabilityai/stable-audio-open-1.0'),
          tokenStep,
          {
            parts: ['Download it into ~/.cache/stable-audio, where the studio looks for it:'],
            commands: [openCommand],
          },
        ],
      },
    })
  })

  it('makes the project’s own model missing a problem, with Small SFX’s three steps', () => {
    const check = row(effectFacts({ small: { download: 'absent' } }))
    expect(check).toMatchObject({
      state: 'problem',
      detail:
        "The project's sound-effects model, Stable Audio 3 Small SFX, is not on this computer. Stable Audio Open 1.0 is in place: an effect's takes can use it meanwhile.",
    })
    expect(check.label).toBeUndefined()
    expect(check.steps?.list).toEqual([
      licence('stabilityai/stable-audio-3-small-sfx'),
      tokenStep,
      { parts: ['Download it, once (about 6.5 GB):'], commands: [smallCommand] },
    ])
  })

  it('makes the project’s model Open 1.0 missing a problem too', () => {
    expect(row(effectFacts({ model: 'open-1', open: { download: 'absent' } }))).toMatchObject({
      state: 'problem',
      detail:
        "The project's sound-effects model, Stable Audio Open 1.0, is not on this computer. Stable Audio 3 Small SFX is in place: an effect's takes can use it meanwhile.",
    })
  })

  it('tells an interrupted download of Small SFX from a missing one: one step', () => {
    expect(row(effectFacts({ small: { download: 'partial' } }))).toMatchObject({
      state: 'problem',
      detail:
        "The project's sound-effects model, Stable Audio 3 Small SFX, is only partly downloaded, so it can't run. Stable Audio Open 1.0 is in place: an effect's takes can use it meanwhile.",
      steps: {
        list: [
          {
            parts: ['Finish the download (it picks up where it stopped):'],
            commands: [smallCommand],
          },
        ],
        note: 'Then press Check again.',
      },
    })
    expect(row(effectFacts({ model: 'open-1', small: { download: 'partial' } }))).toMatchObject({
      state: 'off',
      label: 'Not set up',
      detail:
        "Optional: Stable Audio 3 Small SFX's download is incomplete, so it can't run. Stable Audio Open 1.0 is in place.",
    })
  })

  it('shows the project’s failed effect with its error, a link to the effect and what clears it', () => {
    const check = row(
      effectFacts({ small: { failure: { error: 'RuntimeError: boom', effect: chest } } }),
    )
    expect(check).toMatchObject({
      state: 'problem',
      detail: '',
      failures: [
        {
          sentence:
            "The last effect with Stable Audio 3 Small SFX, the project's sound-effects model, failed on Chest open. Stable Audio Open 1.0 is in place: an effect's takes can use it meanwhile.",
          error: 'RuntimeError: boom',
          link: { text: 'Open Chest open', href: '#/effects/items/chest-open' },
          clears: 'This clears once an effect made with Small SFX works.',
        },
      ],
    })
  })

  it('calls the other model’s failed effect optional', () => {
    expect(row(effectFacts({ open: { failure: { error: 'boom', effect: chest } } }))).toMatchObject(
      {
        state: 'off',
        label: 'Not set up',
        failures: [
          {
            sentence:
              'Optional: the last effect with Stable Audio Open 1.0 failed on Chest open. Stable Audio 3 Small SFX is in place.',
            link: { text: 'Open Chest open', href: '#/effects/items/chest-open' },
            clears: 'This clears once an effect made with Open 1.0 works.',
          },
        ],
      },
    )
  })

  it('drops the effect’s name and link when its takes were dropped', () => {
    const check = row(effectFacts({ open: { failure: { error: 'boom', effect: null } } }))
    expect(check.failures![0]!.sentence).toBe(
      'Optional: the last effect with Stable Audio Open 1.0 failed. Stable Audio 3 Small SFX is in place.',
    )
    expect(check.failures![0]).not.toHaveProperty('link')
  })

  it('says one sentence per model when both have something to say, the failed one after the download', () => {
    const check = row(
      effectFacts({
        small: { failure: { error: 'x', effect: chest } },
        open: { download: 'absent' },
      }),
    )
    expect(check).toMatchObject({
      state: 'problem',
      detail: 'Stable Audio Open 1.0 is not on this computer.',
      failures: [
        {
          sentence:
            "The last effect with Stable Audio 3 Small SFX, the project's sound-effects model, failed on Chest open.",
        },
      ],
    })
    const failed = row(
      effectFacts({
        small: { failure: { error: 'a', effect: chest } },
        open: { failure: { error: 'b', effect: null } },
      }),
    )
    expect(failed.failures!.map((f) => f.error)).toEqual(['a', 'b'])
    expect(failed.failures![1]!.sentence).toBe('The last effect with Stable Audio Open 1.0 failed.')
    expect(failed.state).toBe('problem')
  })

  it('says sound effects can’t be made when neither model can run, and gives a step for each', () => {
    const both = row(effectFacts({ small: { download: 'absent' }, open: { download: 'absent' } }))
    expect(both).toMatchObject({
      state: 'problem',
      detail:
        "Sound effects can't be made: Stable Audio 3 Small SFX and Stable Audio Open 1.0 are not on this computer.",
    })
    expect(both.steps?.list).toEqual([
      {
        parts: [
          "Sign in to Hugging Face and accept Stability AI's Community Licence on ",
          {
            link: 'stabilityai/stable-audio-3-small-sfx',
            href: 'https://huggingface.co/stabilityai/stable-audio-3-small-sfx',
          },
          ' and ',
          {
            link: 'stabilityai/stable-audio-open-1.0',
            href: 'https://huggingface.co/stabilityai/stable-audio-open-1.0',
          },
          '.',
        ],
      },
      tokenStep,
      {
        parts: ['Download Stable Audio 3 Small SFX, once (about 6.5 GB):'],
        commands: [smallCommand],
      },
      {
        parts: [
          'Download Stable Audio Open 1.0 into ~/.cache/stable-audio, where the studio looks for it:',
        ],
        commands: [openCommand],
      },
    ])
    const mixed = row(effectFacts({ small: { download: 'partial' }, open: { download: 'absent' } }))
    expect(mixed.detail).toBe(
      "Sound effects can't be made: Stable Audio 3 Small SFX's download is incomplete and Stable Audio Open 1.0 is not on this computer.",
    )
    expect(mixed.steps?.list.map((step) => step.commands)).toEqual([
      undefined,
      undefined,
      [smallCommand],
      [openCommand],
    ])
  })

  it('asks for uv first, whatever the models are', () => {
    const step = {
      parts: ['Install uv:'],
      commands: ['brew install uv'],
      after: '(then start the studio again if it is still not found)',
    }
    for (const small of [{}, { download: 'absent' as const }]) {
      expect(row(effectFacts({ uv: false, small }))).toMatchObject({
        state: 'problem',
        detail:
          "Sound effects can't be made: uv, which runs the sound-effects models, is not on the PATH.",
        steps: { list: [step], note: '' },
      })
    }
  })

  it('stays grey and optional while the game lists no sound effects', () => {
    const none = (change: Parameters<typeof effectFacts>[0]) =>
      row(effectFacts({ listed: false, ...change }))
    for (const check of [
      none({ small: { download: 'absent' } }),
      none({ small: { download: 'absent' }, open: { download: 'absent' } }),
      none({ uv: false }),
      none({ small: { failure: { error: 'x', effect: null } } }),
    ]) {
      expect(check).toMatchObject({ state: 'off', label: 'Not set up' })
      expect(check.detail + (check.failures?.[0]?.sentence ?? '')).toStartWith(opening)
    }
    expect(none({ uv: false }).detail).toBe(
      `${opening} uv, which runs the sound-effects models, is not on the PATH.`,
    )
    expect(none({ small: { download: 'absent' } }).detail).toBe(
      `${opening} The project's sound-effects model, Stable Audio 3 Small SFX, is not on this computer. Stable Audio Open 1.0 is in place: an effect's takes can use it meanwhile.`,
    )
    expect(none({}).state).toBe('ok')
  })
})

describe('the sound-effect models row for any number of models', () => {
  const model = (id: string, name: string, repo: string, gigabytes: number): EffectFamilyModel => ({
    id,
    name,
    short: name,
    repo,
    gigabytes,
    source: { kind: 'hub' },
  })
  const family: EffectFamily = {
    models: [
      model('a', 'Alpha', 'org/alpha', 1),
      model('b', 'Beta', 'org/beta', 2),
      model('c', 'Gamma', 'org/gamma', 3),
    ],
  }
  const whole = { download: 'whole' as const, failure: null }
  const facts = (
    main: string,
    models: Record<string, SetupFacts['effects']['models']['open-1']>,
  ) => ({
    uv: true,
    listed: true,
    model: main,
    models,
  })

  it('is ready with all three whole, naming each', () => {
    const check = effectModelsRow(facts('a', { a: whole, b: whole, c: whole }), family)
    expect(check).toMatchObject({
      state: 'ok',
      detail:
        'Alpha, Beta and Gamma are fully downloaded on this computer; a model loads on its first effect.',
    })
  })

  it('closes a sentence about one missing model with the two in place', () => {
    const check = effectModelsRow(
      facts('a', { a: { download: 'absent', failure: null }, b: whole, c: whole }),
      family,
    )
    expect(check.detail).toBe(
      "The project's sound-effects model, Alpha, is not on this computer. Beta and Gamma are in place: an effect's takes can use them meanwhile.",
    )
  })

  it('says one sentence each when two are missing, and a step for each', () => {
    const absent = { download: 'absent' as const, failure: null }
    const check = effectModelsRow(facts('a', { a: whole, b: absent, c: absent }), family)
    expect(check.detail).toBe('Beta is not on this computer. Gamma is not on this computer.')
    expect(check.steps?.list.map((s) => s.parts[0])).toEqual([
      "Sign in to Hugging Face and accept Stability AI's Community Licence on ",
      'Make a read token at ',
      'Download Beta, once (about 2 GB):',
      'Download Gamma, once (about 3 GB):',
    ])
  })

  it('lists three models when none can run', () => {
    const absent = { download: 'absent' as const, failure: null }
    const check = effectModelsRow(facts('a', { a: absent, b: absent, c: absent }), family)
    expect(check.detail).toBe(
      "Sound effects can't be made: Alpha, Beta and Gamma are not on this computer.",
    )
  })
})

describe('the Stable Audio row for any number of models', () => {
  const models = [
    { id: 'a', name: 'Alpha', folders: ['alpha'] },
    { id: 'b', name: 'Beta', folders: ['beta'] },
    { id: 'c', name: 'Gamma', folders: ['gamma'] },
  ]
  const row = (missing: string[], model = 'a') =>
    stableAudioRow({ model, stableAudioMissing: missing }, models)

  it('names all three when they are in place', () => {
    expect(row([])).toMatchObject({
      state: 'ok',
      detail: 'Alpha, Beta and Gamma are in place; they load on the first take.',
    })
  })

  it('says which of three are in place and which are missing', () => {
    expect(row(['b', 'c']).detail).toBe(
      'Alpha is in place; Beta and Gamma are missing from ~/.cache/stable-audio.',
    )
    expect(row(['c']).detail).toBe(
      'Alpha and Beta are in place; Gamma is missing from ~/.cache/stable-audio.',
    )
  })

  it('downloads all three from one licence step and one token step', () => {
    const steps = row(['a', 'b', 'c'], 'c').steps!.list
    expect(steps).toHaveLength(3)
    expect(steps[0]!.parts.filter((p) => typeof p === 'object')).toHaveLength(3)
    expect(steps[2]!.parts[0]).toBe(
      'Download all of them into ~/.cache/stable-audio, where the studio looks for them:',
    )
    expect(steps[2]!.commands).toHaveLength(3)
  })
})

import { describe, expect, it } from 'bun:test'
import { setupChecks, type SetupFacts } from './setup'

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
    ])
    expect(checks.every((c) => c.state === 'ok')).toBe(true)
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

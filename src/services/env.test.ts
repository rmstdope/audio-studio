import { describe, expect, it } from 'bun:test'
import { projectJson, tempRepo } from '../../test/helpers'
import { elevenLabsApiKey, fishApiKey, forgetLoadedKeys, parseEnv } from './env'

describe('parseEnv', () => {
  it('reads KEY=value lines, without quotes, comments or export', () => {
    expect(
      parseEnv('# comment\nA=1\nexport B="two words"\nC = \'3\'\n\nnot a line\nD=x=y\n'),
    ).toEqual({ A: '1', B: 'two words', C: '3', D: 'x=y' })
  })
})

describe('fishApiKey', () => {
  it('prefers the environment', async () => {
    const root = tempRepo({ '.env': 'FISH_AUDIO_API_KEY=from-file' })
    expect(await fishApiKey(root, '.env', { FISH_AUDIO_API_KEY: 'from-env' })).toBe('from-env')
  })

  it('falls back to the project’s env file', async () => {
    const root = tempRepo({
      '.env': 'FISH_AUDIO_API_KEY=from-file\n',
      'audio-studio.json': projectJson(),
    })
    expect(await fishApiKey(root, '.env', {})).toBe('from-file')
  })

  it('is null when neither has it', async () => {
    expect(await fishApiKey(tempRepo({}), '.env', {})).toBeNull()
  })
})

describe('elevenLabsApiKey', () => {
  it('reads ELEVENLABS_API_KEY as the Fish key is read: the environment, else the env file', async () => {
    const root = tempRepo({ '.env': 'FISH_AUDIO_API_KEY=fish\nELEVENLABS_API_KEY=from-file\n' })
    expect(await elevenLabsApiKey(root, '.env', { ELEVENLABS_API_KEY: 'from-env' })).toBe(
      'from-env',
    )
    expect(await elevenLabsApiKey(root, '.env', {})).toBe('from-file')
    expect(
      await elevenLabsApiKey(tempRepo({ '.env': 'FISH_AUDIO_API_KEY=fish\n' }), '.env', {}),
    ).toBeNull()
  })
})

describe('forgetLoadedKeys', () => {
  it('forgets the keys Bun loaded from the folder’s env files, so the project’s file is read live', () => {
    const dir = tempRepo({
      '.env': 'FISH_AUDIO_API_KEY=from-file\nELEVENLABS_API_KEY="eleven-file"\n',
      '.env.local': 'ELEVENLABS_API_KEY=eleven-local\n',
    })
    const environment: Record<string, string | undefined> = {
      FISH_AUDIO_API_KEY: 'from-file',
      ELEVENLABS_API_KEY: 'eleven-local',
      OTHER: 'kept',
    }
    forgetLoadedKeys(dir, environment)
    expect(environment).toEqual({ OTHER: 'kept' })
  })

  it('keeps a key exported with another value, and does nothing without env files', () => {
    const dir = tempRepo({ '.env': 'FISH_AUDIO_API_KEY=from-file\n' })
    const environment: Record<string, string | undefined> = { FISH_AUDIO_API_KEY: 'exported' }
    forgetLoadedKeys(dir, environment)
    expect(environment).toEqual({ FISH_AUDIO_API_KEY: 'exported' })
    const none: Record<string, string | undefined> = { ELEVENLABS_API_KEY: 'x' }
    forgetLoadedKeys(tempRepo({}), none)
    expect(none).toEqual({ ELEVENLABS_API_KEY: 'x' })
  })
})

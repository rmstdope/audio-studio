import { describe, expect, it } from 'bun:test'
import { projectJson, tempRepo } from '../../test/helpers'
import { elevenLabsApiKey, fishApiKey, parseEnv } from './env'

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

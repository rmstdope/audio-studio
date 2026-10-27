import { describe, expect, it } from 'bun:test'
import { providerWords, voiceIdFrom, voiceUrl } from './voiceId'

describe('voiceIdFrom', () => {
  it('takes a bare id', () => {
    expect(voiceIdFrom('  e48a228e21a443d6a4302dc6238c8128 ')).toBe(
      'e48a228e21a443d6a4302dc6238c8128',
    )
  })

  it('takes the last part of a URL, with or without a trailing slash, query or hash', () => {
    for (const url of [
      'https://fish.audio/m/abc123/',
      'https://fish.audio/m/abc123',
      'https://fish.audio/m/abc123?ref=x',
      'https://fish.audio/m/abc123/#play',
    ]) {
      expect(voiceIdFrom(url)).toBe('abc123')
    }
  })

  it('takes a URL typed without its scheme, and the id after /m/', () => {
    expect(voiceIdFrom('fish.audio/m/abc123')).toBe('abc123')
    expect(voiceIdFrom('www.fish.audio/m/abc123/')).toBe('abc123')
    expect(voiceIdFrom('https://fish.audio/m/abc123/samples')).toBe('abc123')
    expect(voiceIdFrom('https://fish.audio/m/')).toBeNull()
  })

  it('is null for something that is not an id', () => {
    expect(voiceIdFrom('')).toBeNull()
    expect(voiceIdFrom('not an id!')).toBeNull()
    expect(voiceIdFrom('https://fish.audio/')).toBeNull()
  })
})

describe('voiceIdFrom, for ElevenLabs', () => {
  it('takes a bare id as an ElevenLabs voice, also one given with its mark', () => {
    expect(voiceIdFrom(' JBFqnCBsd6RMkjVDRZzb ', 'elevenlabs')).toBe('eleven:JBFqnCBsd6RMkjVDRZzb')
    expect(voiceIdFrom('eleven:JBFqnCBsd6RMkjVDRZzb', 'elevenlabs')).toBe(
      'eleven:JBFqnCBsd6RMkjVDRZzb',
    )
  })

  it('is null for something that is not an id', () => {
    expect(voiceIdFrom('', 'elevenlabs')).toBeNull()
    expect(voiceIdFrom('not an id!', 'elevenlabs')).toBeNull()
    expect(voiceIdFrom('https://elevenlabs.io/app/voice-lab', 'elevenlabs')).toBeNull()
  })

  it('takes no ElevenLabs voice for Fish', () => {
    expect(voiceIdFrom('eleven:JBFqnCBsd6RMkjVDRZzb')).toBeNull()
  })
})

describe('voiceUrl', () => {
  it('gives the voice’s page on Fish Audio, which reads back as its id', () => {
    expect(voiceUrl('e48a228e21a4')).toBe('https://fish.audio/m/e48a228e21a4/')
    expect(voiceIdFrom(voiceUrl('e48a228e21a4')!)).toBe('e48a228e21a4')
  })

  it('is none for an ElevenLabs voice, which has no public page', () => {
    expect(voiceUrl('eleven:21m00Tcm4TlvDq8ikWAM')).toBeNull()
  })
})

describe('providerWords', () => {
  it('names Fish and its sample for a Fish voice, ElevenLabs and its preview for one of its', () => {
    expect(providerWords('abc')).toEqual({
      name: 'Fish Audio',
      sample: 'Fish sample',
      noSample: 'No sample from Fish',
      play: 'Play Fish’s sample',
      ownClip: 'Fish’s own clip',
      none: 'None from Fish',
    })
    expect(providerWords('eleven:g1')).toEqual({
      name: 'ElevenLabs',
      sample: 'ElevenLabs preview',
      noSample: 'No preview from ElevenLabs',
      play: 'Play ElevenLabs’ preview',
      ownClip: 'ElevenLabs’ own clip',
      none: 'None from ElevenLabs',
    })
  })
})

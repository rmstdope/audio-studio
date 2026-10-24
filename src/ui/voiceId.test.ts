import { describe, expect, it } from 'bun:test'
import { voiceIdFrom, voiceUrl } from './voiceId'

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

describe('voiceUrl', () => {
  it('gives the voice’s page on Fish Audio, which reads back as its id', () => {
    expect(voiceUrl('e48a228e21a4')).toBe('https://fish.audio/m/e48a228e21a4/')
    expect(voiceIdFrom(voiceUrl('e48a228e21a4'))).toBe('e48a228e21a4')
  })
})

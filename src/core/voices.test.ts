import { describe, expect, it } from 'bun:test'
import { elevenVoice, providerId, providerOf, VOICE_ID } from './voices'

describe('whose a voice is', () => {
  it('is ElevenLabs’ for an eleven: id, and Fish’s for a bare one, as every file made so far has', () => {
    expect(providerOf('eleven:21m00Tcm4TlvDq8ikWAM')).toBe('elevenlabs')
    expect(providerOf('e48a228e21a4')).toBe('fish')
  })

  it('gives the id the provider itself knows', () => {
    expect(providerId('eleven:21m00Tcm4TlvDq8ikWAM')).toBe('21m00Tcm4TlvDq8ikWAM')
    expect(providerId('e48a228e21a4')).toBe('e48a228e21a4')
    expect(elevenVoice('21m00Tcm4TlvDq8ikWAM')).toBe('eleven:21m00Tcm4TlvDq8ikWAM')
  })

  it('takes either kind of id, and nothing else', () => {
    for (const id of ['e48a228e21a4', 'a_b-c', 'eleven:21m00Tcm4TlvDq8ikWAM'])
      expect(VOICE_ID.test(id)).toBe(true)
    for (const id of ['', 'a b', 'eleven:', 'fish:abc', 'eleven:a/b', 'x'.repeat(65)])
      expect(VOICE_ID.test(id)).toBe(false)
  })
})

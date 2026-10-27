import {
  elevenVoice,
  FISH_VOICE_ID,
  providerId,
  providerOf,
  type VoiceProvider,
} from '../core/voices'

/**
 * The voice id in what the user typed. For Fish: a bare id, or a voice's URL, with or without its
 * scheme (a trailing slash, query or hash is fine): the part after `/m/`, else the last part. For
 * ElevenLabs: a bare id (also with its `eleven:`), as the studio's id. Null when there is none.
 */
export function voiceIdFrom(input: string, provider: VoiceProvider = 'fish'): string | null {
  let text = input.trim()
  if (provider === 'elevenlabs') {
    const id = providerId(text)
    return FISH_VOICE_ID.test(id) ? elevenVoice(id) : null
  }
  if (!/^https?:\/\//i.test(text) && /^[\w-]+(\.[\w-]+)+\//.test(text)) text = `https://${text}`
  if (!/^https?:\/\//i.test(text)) return FISH_VOICE_ID.test(text) ? text : null
  try {
    const parts = new URL(text).pathname.split('/').filter(Boolean)
    const after = parts.indexOf('m')
    const id = after >= 0 ? parts[after + 1] : parts.at(-1)
    return id && FISH_VOICE_ID.test(id) ? id : null
  } catch {
    return null
  }
}

/** The voice's page on Fish Audio; none for an ElevenLabs voice, which has no public page. */
export function voiceUrl(id: string): string | null {
  if (providerOf(id) !== 'fish') return null
  return `https://fish.audio/m/${encodeURIComponent(id)}/`
}

/** What the page calls a voice's provider and the provider's own clip of it, by whose it is. */
export function providerWords(id: string): {
  name: string
  sample: string
  noSample: string
  play: string
} {
  return providerOf(id) === 'elevenlabs'
    ? {
        name: 'ElevenLabs',
        sample: 'ElevenLabs preview',
        noSample: 'No preview from ElevenLabs',
        play: 'Play ElevenLabs’ preview',
      }
    : {
        name: 'Fish Audio',
        sample: 'Fish sample',
        noSample: 'No sample from Fish',
        play: 'Play Fish’s sample',
      }
}

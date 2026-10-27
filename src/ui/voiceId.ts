import { FISH_VOICE_ID, providerOf } from '../core/voices'

/**
 * The Fish voice id in what the user typed: a bare id, or a voice's URL, with or without its
 * scheme (a trailing slash, query or hash is fine): the part after `/m/`, else the last part.
 * Null when there is none.
 */
export function voiceIdFrom(input: string): string | null {
  let text = input.trim()
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

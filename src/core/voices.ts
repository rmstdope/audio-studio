/** Who a voice belongs to, which says who speaks with it. */
export type VoiceProvider = 'fish' | 'elevenlabs'

/** What an ElevenLabs voice's id begins with, in the cast and every file that names a voice. */
const ELEVENLABS_PREFIX = 'eleven:'

/** What a Fish voice id looks like: letters, digits, `_` and `-`. */
export const FISH_VOICE_ID = /^[\w-]{1,64}$/

/** What any voice id may look like: Fish's, or the same after `eleven:` for an ElevenLabs voice. */
export const VOICE_ID = new RegExp(`^(${ELEVENLABS_PREFIX})?${FISH_VOICE_ID.source.slice(1)}`)

/** Whose a voice is: ElevenLabs' for an `eleven:` id, else Fish's, as every voice was before. */
export function providerOf(voice: string): VoiceProvider {
  return voice.startsWith(ELEVENLABS_PREFIX) ? 'elevenlabs' : 'fish'
}

/** The id the voice's provider knows it by: without `eleven:`. */
export function providerId(voice: string): string {
  return providerOf(voice) === 'elevenlabs' ? voice.slice(ELEVENLABS_PREFIX.length) : voice
}

/** The studio's id of the ElevenLabs voice ElevenLabs knows as `id`. */
export function elevenVoice(id: string): string {
  return `${ELEVENLABS_PREFIX}${id}`
}

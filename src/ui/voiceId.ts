/** What a Fish voice id looks like. */
const VOICE_ID = /^[\w-]{1,64}$/

/**
 * The Fish voice id in what the user typed: a bare id, or the last part of a voice's URL (a
 * trailing slash, query or hash is fine). Null when there is none.
 */
export function voiceIdFrom(input: string): string | null {
  const text = input.trim()
  if (/^https?:\/\//i.test(text)) {
    try {
      const last = new URL(text).pathname.split('/').filter(Boolean).pop()
      return last && VOICE_ID.test(last) ? last : null
    } catch {
      return null
    }
  }
  return VOICE_ID.test(text) ? text : null
}

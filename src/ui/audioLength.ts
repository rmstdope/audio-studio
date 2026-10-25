/**
 * The length of an audio file in seconds, as the browser decodes it, or null when the browser
 * cannot read it as audio (a text file, a broken or unsupported recording).
 */
export async function audioSeconds(file: File): Promise<number | null> {
  try {
    const context = new OfflineAudioContext(1, 1, 44100)
    const decoded = await context.decodeAudioData(await file.arrayBuffer())
    return decoded.duration
  } catch {
    return null
  }
}

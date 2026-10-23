/** The format of PCM audio in a WAV file. */
export interface WavFormat {
  channels: number
  sampleRate: number
  bitsPerSample: number
}

/** A WAV file's format and its audio bytes. */
export interface Wav {
  format: WavFormat
  data: Uint8Array
}

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4))
}

/**
 * The format and audio of a WAV file. The data chunk's declared length is a placeholder in
 * Fish's streamed WAVs, so the audio is what is actually there, up to that length.
 */
export function readWav(bytes: Uint8Array): Wav {
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    throw new Error('not a WAV file')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let format: WavFormat | null = null
  let at = 12
  while (at + 8 <= bytes.length) {
    const id = tag(bytes, at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') {
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      if (!format) throw new Error('not a WAV file: audio before its format')
      const end = Math.min(bytes.length, body + size)
      const frame = (format.bitsPerSample / 8) * format.channels
      // Whole frames only: a cut-off stream may end mid-frame.
      return { format, data: bytes.subarray(body, end - ((end - body) % frame)) }
    }
    at = body + size + (size % 2)
  }
  throw new Error('not a WAV file: no audio')
}

/** A 16-byte-format PCM WAV file holding `data`. */
export function writeWav({ format, data }: Wav): Uint8Array {
  const bytes = new Uint8Array(44 + data.length)
  const view = new DataView(bytes.buffer)
  const put = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  const frame = (format.bitsPerSample / 8) * format.channels
  put(0, 'RIFF')
  view.setUint32(4, 36 + data.length, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, format.channels, true)
  view.setUint32(24, format.sampleRate, true)
  view.setUint32(28, format.sampleRate * frame, true)
  view.setUint16(32, frame, true)
  view.setUint16(34, format.bitsPerSample, true)
  put(36, 'data')
  view.setUint32(40, data.length, true)
  bytes.set(data, 44)
  return bytes
}

/**
 * One WAV from the pieces of a line, `gapSeconds` of silence between them, and its length in
 * seconds, measured from the audio read (as RetroQuest's narrate.py `_join` does).
 */
export function joinWavs(
  pieces: Uint8Array[],
  gapSeconds: number,
): { wav: Uint8Array; seconds: number } {
  const read = pieces.map(readWav)
  const first = read[0]
  if (!first) throw new Error('no audio to join')
  const { format } = first
  const same = (f: WavFormat) =>
    f.channels === format.channels &&
    f.sampleRate === format.sampleRate &&
    f.bitsPerSample === format.bitsPerSample
  if (!read.every((r) => same(r.format))) throw new Error('the pieces are in different formats')
  const frame = (format.bitsPerSample / 8) * format.channels
  const gap = new Uint8Array(Math.round(gapSeconds * format.sampleRate) * frame)
  const parts = read.flatMap((r, i) => (i ? [gap, r.data] : [r.data]))
  const data = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let at = 0
  for (const part of parts) {
    data.set(part, at)
    at += part.length
  }
  return { wav: writeWav({ format, data }), seconds: data.length / frame / format.sampleRate }
}

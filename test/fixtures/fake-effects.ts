/**
 * A stand-in for worker/effects.py in tests: writes a stereo 16-bit WAV (1000 Hz) as long as the
 * request's `seconds`, a tone for its first half and silence after it, as Small SFX's one-shots
 * end, and answers with the seed it was given. A prompt that says "fail" gets an error.
 */
import { writeFileSync } from 'node:fs'
import { writeWav } from '../../src/core/wav'

for await (const line of console) {
  if (!line.trim()) continue
  const request = JSON.parse(line) as {
    id: string
    prompt: string
    seconds: number
    seed: number
    out: string
  }
  if (process.env.FAKE_EFFECTS_LOG) writeFileSync(process.env.FAKE_EFFECTS_LOG, line)
  if (request.prompt.includes('fail')) {
    console.log(JSON.stringify({ id: request.id, error: 'out of memory' }))
    continue
  }
  const rate = 1000
  const frames = Math.round(request.seconds * rate)
  const samples = new Int16Array(frames * 2)
  for (let i = 0; i < (frames / 2) * 2; i++) samples[i] = Math.round(8000 * Math.sin(i / 20))
  writeFileSync(
    request.out,
    writeWav({
      format: { channels: 2, sampleRate: rate, bitsPerSample: 16 },
      data: new Uint8Array(samples.buffer),
    }),
  )
  console.log(JSON.stringify({ id: request.id, seed: request.seed }))
}

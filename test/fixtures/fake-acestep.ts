/**
 * A stand-in for worker/music.py in tests: writes a mono 16-bit WAV (1000 Hz, a tone) as long as
 * the request's `seconds` to the request's `out`, and answers with the seed it was given (or 7).
 * A brief that says "fail" gets an error, "crash" makes it exit without answering, "hang" is never
 * answered, and "killed" logs a line and is killed by the system (SIGKILL, as macOS does when
 * memory runs out).
 */
import { writeFileSync } from 'node:fs'
import { writeWav } from '../../src/core/wav'

for await (const line of console) {
  if (!line.trim()) continue
  const request = JSON.parse(line) as {
    id: string
    brief: string
    seconds: number
    seed?: number
    out: string
  }
  if (process.env.FAKE_ACESTEP_LOG) writeFileSync(process.env.FAKE_ACESTEP_LOG, line)
  if (request.brief.includes('crash')) process.exit(3)
  if (request.brief.includes('killed')) {
    console.error('2026-10-26 | INFO | acestep resource_tracker: leaked semaphore objects')
    await Bun.sleep(50)
    process.kill(process.pid, 'SIGKILL')
  }
  if (request.brief.includes('hang')) continue
  if (request.brief.includes('fail')) {
    console.log(JSON.stringify({ id: request.id, error: 'out of memory' }))
    continue
  }
  const rate = 1000
  const samples = new Int16Array(Math.round(request.seconds * rate))
  samples.forEach((_, i) => (samples[i] = Math.round(8000 * Math.sin(i / 20))))
  writeFileSync(
    request.out,
    writeWav({
      format: { channels: 1, sampleRate: rate, bitsPerSample: 16 },
      data: new Uint8Array(samples.buffer),
    }),
  )
  console.log(JSON.stringify({ id: request.id, seed: request.seed ?? 7 }))
}

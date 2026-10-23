/**
 * A stand-in for worker/transcribe.py in tests: answers each request with one segment whose
 * words are the file name's parts ("she-stops.wav" → "she", "stops"), an error for "fail.wav",
 * and exits without answering for "crash.wav".
 */
import { basename } from 'node:path'

for await (const line of console) {
  if (!line.trim()) continue
  const { id, path } = JSON.parse(line) as { id: string; path: string }
  const name = basename(path).replace(/\.wav$/, '')
  if (name === 'crash') process.exit(3)
  if (name === 'fail') {
    console.log(JSON.stringify({ id, error: 'RuntimeError: bad audio' }))
    continue
  }
  const words = name.split('-').map((word, i) => ({ word, start: i, end: i + 0.5 }))
  console.log(JSON.stringify({ id, segments: [{ start: 0, end: words.length, words }] }))
}

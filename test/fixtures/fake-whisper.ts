/**
 * A stand-in for worker/transcribe.py in tests: answers each request with one segment whose
 * words are the file name's parts ("she-stops.wav" → "she", "stops"), an error for "fail.wav",
 * exits without answering for "crash.wav", never answers "hang.wav", and for "language.wav" says
 * the language it was asked to hear ("none" when it was not told).
 */
import { basename } from 'node:path'

for await (const line of console) {
  if (!line.trim()) continue
  const { id, path, language } = JSON.parse(line) as {
    id: string
    path: string
    language?: string
  }
  const name = basename(path).replace(/\.wav$/, '')
  if (name === 'crash') process.exit(3)
  if (name === 'hang') {
    await new Promise(() => {})
  }
  if (name === 'fail') {
    console.log(JSON.stringify({ id, error: 'RuntimeError: bad audio' }))
    continue
  }
  if (name === 'language') {
    const said = [{ word: language ?? 'none', start: 0, end: 0.5 }]
    console.log(JSON.stringify({ id, segments: [{ start: 0, end: 1, words: said }] }))
    continue
  }
  const words = name.split('-').map((word, i) => ({ word, start: i, end: i + 0.5 }))
  console.log(JSON.stringify({ id, segments: [{ start: 0, end: words.length, words }] }))
}

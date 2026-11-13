import { afterAll } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeWav } from '../core/wav'
import { projectJson, tempRepo } from '../../test/helpers'
import type { FishClient } from '../services/fish'
import { startServer } from './index'

/** A Fish client that answers from memory, so no test reaches the network. */
export const fish: FishClient = {
  async listOwnVoices() {
    return []
  },
  createVoice: () => Promise.reject(new Error('not used')),
  designVoice: () => Promise.reject(new Error('not used')),
  async credit() {
    return 25
  },
  async listVoices() {
    return {
      total: 1,
      items: [
        {
          id: 'w1',
          title: 'Warm',
          description: '',
          tags: [],
          languages: ['en'],
          uses: 1,
          likes: 0,
          author: '',
          sample: null,
        },
      ],
    }
  },
  async getVoice() {
    throw new Error('not used')
  },
  async tts(request) {
    if (request.format !== 'wav') return new Uint8Array([0x49, 0x44, 0x33])
    return writeWav({
      format: { channels: 1, sampleRate: 1000, bitsPerSample: 16 },
      data: new Uint8Array(2000),
    })
  },
}

/** An encoder that keeps the WAV, so the tests need no ffmpeg. */
export const encode = async (wav: Uint8Array, file: string) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, wav)
}

/**
 * Starts the studio on a temporary repository with one narrated part, for the tests of one file;
 * the server stops when that file's tests are done.
 */
export function startBase() {
  const root = tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
    'audio/act1/manifest.json': { a: { file: 'a.mp3' } },
    'audio/act1/a.mp3': 'ID3-not-really-audio',
  })
  const server = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    // No ElevenLabs, so Setup never asks it, even with ELEVENLABS_API_KEY exported.
    elevenlabs: null,
  })
  afterAll(() => server.stop(true))
  const url = (path: string) => new URL(path, server.url)
  const post = (path: string, origin: string | null = server.url.origin) =>
    fetch(url(path), { method: 'POST', headers: origin ? { origin } : {} })
  return { root, server, url, post }
}

/** A promise and the function that settles it: lets a test hold a fake's call until it says so. */
export function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { open, opened }
}

/** Waits until `check` holds, looking every few milliseconds; fails after two seconds. */
export async function until(check: () => boolean) {
  const giveUp = Date.now() + 2000
  while (!check()) {
    if (Date.now() > giveUp) throw new Error('waited in vain')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

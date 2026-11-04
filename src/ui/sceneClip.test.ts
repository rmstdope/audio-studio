import { describe, expect, it } from 'bun:test'
import type { LoopContext } from './loopAudio'
import { createSceneClip } from './sceneClip'

/** A Web Audio context that records the sources and gains it makes. */
function fakeContext() {
  const runs: {
    loop: boolean
    gain: number
    stopped: boolean
    end: () => void
  }[] = []
  const context: LoopContext = {
    currentTime: 0,
    destination: {},
    async decodeAudioData() {
      return { duration: 4 }
    },
    createGain() {
      return { gain: { value: 1 }, connect: (node: unknown) => node }
    },
    createBufferSource() {
      const source = {
        buffer: null as { duration: number } | null,
        loop: false,
        onended: null as ((event: Event) => void) | null,
        connect(node: unknown) {
          const gain = (node as { gain: { value: number } }).gain
          const run = {
            loop: false,
            get gain() {
              return gain.value
            },
            stopped: false,
            end: () => source.onended?.(new Event('ended')),
          }
          runs.push(run)
          return node
        },
        start() {
          runs.at(-1)!.loop = source.loop
        },
        stop() {
          runs.at(-1)!.stopped = true
        },
      }
      return source
    },
  }
  return { context, runs }
}

function setup(load: (url: string) => Promise<ArrayBuffer> = async () => new ArrayBuffer(1)) {
  const { context, runs } = fakeContext()
  const states: (string | null)[] = []
  const clip = createSceneClip({ context: () => context, load }, (id) => states.push(id))
  return { clip, runs, states, loaded: () => new Promise((r) => setTimeout(r, 0)) }
}

describe('a scene clip', () => {
  it('plays at its level, which may be above 1, and is playing at once', async () => {
    const { clip, runs, states, loaded } = setup()
    clip.toggle('music', '/a.mp3', { level: 2.5, loop: true })
    expect(states).toEqual(['music'])
    await loaded()
    expect(runs.map((r) => [r.gain, r.loop])).toEqual([[2.5, true]])
  })

  it('stops when pressed again', async () => {
    const { clip, runs, states, loaded } = setup()
    clip.toggle('a', '/a.mp3', { level: 1 })
    await loaded()
    clip.toggle('a', '/a.mp3', { level: 1 })
    expect(states).toEqual(['a', null])
    expect(runs[0]!.stopped).toBe(true)
  })

  it('stops the first when another starts', async () => {
    const { clip, runs, states, loaded } = setup()
    clip.toggle('a', '/a.mp3', { level: 1 })
    await loaded()
    clip.toggle('b', '/b.mp3', { level: 0.5 })
    await loaded()
    expect(states).toEqual(['a', 'b'])
    expect(runs.map((r) => r.stopped)).toEqual([true, false])
  })

  it('is idle again when the clip ends', async () => {
    const { clip, runs, states, loaded } = setup()
    clip.toggle('a', '/a.mp3', { level: 1 })
    await loaded()
    runs[0]!.end()
    expect(states).toEqual(['a', null])
  })

  it('does not start a clip stopped while it was loading', async () => {
    const { clip, runs, states, loaded } = setup()
    clip.toggle('a', '/a.mp3', { level: 1 })
    clip.stop()
    await loaded()
    expect(runs).toEqual([])
    expect(states).toEqual(['a', null])
  })

  it('is idle again when the clip cannot be loaded', async () => {
    const { clip, states, loaded } = setup(async () => {
      throw new Error('gone')
    })
    clip.toggle('a', '/a.mp3', { level: 1 })
    await loaded()
    expect(states).toEqual(['a', null])
  })
})

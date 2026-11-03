import { describe, expect, it } from 'bun:test'
import { createClipAudio, loopTime, type LoopContext } from './loopAudio'

/** An audio element that records what it is told. */
function fakeElement() {
  const element = {
    src: '',
    currentTime: 0,
    volume: 1,
    duration: 7,
    paused: true,
    play() {
      element.paused = false
      return Promise.resolve()
    },
    pause() {
      element.paused = true
    },
  }
  return element
}

/** A Web Audio context whose clock the test moves, recording the sources it starts. */
function fakeContext() {
  const started: {
    offset: number
    loop: boolean
    stopped: boolean
    stopAt: number | null
    duration: number
    end: () => void
  }[] = []
  const gains: { gain: { value: number } }[] = []
  const context = {
    currentTime: 100,
    destination: {},
    decoded: 0,
    async decodeAudioData() {
      context.decoded++
      return { duration: 10 }
    },
    createBufferSource() {
      const source = {
        buffer: null as { duration: number } | null,
        loop: false,
        onended: null as ((event: Event) => void) | null,
        connect: (node: unknown) => node,
        start(_when: number, offset: number) {
          started.push({
            offset,
            loop: source.loop,
            stopped: false,
            stopAt: null,
            duration: source.buffer!.duration,
            end: () => source.onended?.(new Event('ended')),
          })
        },
        stop(when?: number) {
          const run = started.at(-1)!
          if (when === undefined) run.stopped = true
          else run.stopAt = when
        },
      }
      return source
    },
    createGain() {
      const gain = { gain: { value: 1 }, connect: (node: unknown) => node }
      gains.push(gain)
      return gain
    },
  }
  return { context, started, gains }
}

function setUp() {
  const element = fakeElement()
  const { context, started, gains } = fakeContext()
  const loaded: string[] = []
  let playing = 0
  let ended = 0
  const audio = createClipAudio(element, {
    context: () => context as unknown as LoopContext,
    load: async (url) => {
      loaded.push(url)
      return new ArrayBuffer(8)
    },
    playing: () => playing++,
    ended: () => ended++,
  })
  return {
    audio,
    element,
    context,
    started,
    gains,
    loaded,
    playing: () => playing,
    ended: () => ended,
  }
}

describe('loopTime', () => {
  it('is how far into the clip the playhead is, coming round at its length', () => {
    expect(loopTime(103, 100, 0, 10)).toBe(3)
    expect(loopTime(113, 100, 0, 10)).toBe(3)
    expect(loopTime(101, 100, 4, 10)).toBe(5)
  })
})

describe('createClipAudio', () => {
  it('plays a clip that does not loop on the audio element', async () => {
    const { audio, element, started } = setUp()
    audio.src = '/a.mp3'
    audio.currentTime = 0
    audio.volume = 0.5
    await audio.play()
    expect([element.src, element.paused, element.volume]).toEqual(['/a.mp3', false, 0.5])
    expect(started).toEqual([])
    expect(audio.duration).toBe(7)
  })

  it('plays a loop round and round on Web Audio, with no gap where it comes round', async () => {
    const { audio, element, started, playing } = setUp()
    audio.src = '/loop.wav'
    audio.loop = true
    audio.currentTime = 0
    await audio.play()
    expect(started).toMatchObject([{ offset: 0, loop: true, stopped: false, duration: 10 }])
    expect(element.paused).toBe(true)
    expect(playing()).toBe(1)
  })

  it('says where in the loop it is, back at the start as it comes round', async () => {
    const { audio, context } = setUp()
    audio.src = '/loop.wav'
    audio.loop = true
    await audio.play()
    context.currentTime = 104
    expect(audio.currentTime).toBe(4)
    context.currentTime = 112.5
    expect(audio.currentTime).toBe(2.5)
    expect(audio.duration).toBe(10)
  })

  it('sets the loop’s volume, and stops it on pause', async () => {
    const { audio, started, gains } = setUp()
    audio.src = '/loop.wav'
    audio.loop = true
    audio.volume = 0
    await audio.play()
    expect(gains.at(-1)!.gain.value).toBe(0)
    audio.volume = 0.7
    expect(gains.at(-1)!.gain.value).toBe(0.7)
    audio.pause()
    expect(started.at(-1)!.stopped).toBe(true)
  })

  it('does not start a loop paused while it was still loading', async () => {
    const { audio, started } = setUp()
    audio.src = '/loop.wav'
    audio.loop = true
    const play = audio.play()
    audio.pause()
    await play
    expect(started).toEqual([])
  })

  it('decodes a loop once, and stops it when a clip that does not loop is played', async () => {
    const { audio, element, context, started, loaded } = setUp()
    audio.src = '/loop.wav'
    audio.loop = true
    await audio.play()
    audio.pause()
    await audio.play()
    expect([loaded, context.decoded]).toEqual([['/loop.wav'], 1])
    audio.src = '/a.mp3'
    audio.loop = false
    await audio.play()
    expect(started.every((s) => s.stopped)).toBe(true)
    expect(element.src).toBe('/a.mp3')
  })

  it('refuses a loop that cannot be loaded, as the element refuses a clip', async () => {
    const element = fakeElement()
    const { context } = fakeContext()
    const audio = createClipAudio(element, {
      context: () => context as unknown as LoopContext,
      load: async () => {
        throw new Error('gone')
      },
      playing: () => {},
      ended: () => {},
    })
    audio.src = '/loop.wav'
    audio.loop = true
    expect(audio.play()).rejects.toThrow('gone')
  })
})

describe('createClipAudio, a loop of a number of rounds', () => {
  it('stops after the rounds on the audio clock, and says it ended', async () => {
    const { audio, started, ended } = setUp()
    audio.src = '/loop.wav'
    audio.loop = true
    audio.rounds = 2
    await audio.play()
    expect(started[0]).toMatchObject({ loop: true, stopAt: 120 })
    started[0]!.end()
    expect(ended()).toBe(1)
  })

  it('counts the rounds from where it begins, and plays round for ever without a number', async () => {
    const { audio, started } = setUp()
    audio.src = '/loop.wav'
    audio.loop = true
    audio.rounds = 2
    audio.currentTime = 4
    await audio.play()
    expect(started[0]).toMatchObject({ offset: 4, stopAt: 116 })
    audio.rounds = undefined
    await audio.play()
    expect(started[1]!.stopAt).toBeNull()
  })

  it('does not say it ended when it is stopped', async () => {
    const { audio, started, ended } = setUp()
    audio.src = '/loop.wav'
    audio.loop = true
    audio.rounds = 2
    await audio.play()
    audio.pause()
    started[0]!.end()
    expect(ended()).toBe(0)
  })
})

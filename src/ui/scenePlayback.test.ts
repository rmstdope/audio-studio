import { describe, expect, test } from 'bun:test'
import {
  createScenePlayback,
  MUSIC_KEY,
  rowKey,
  TICK_MS,
  type PlaybackView,
  type PlayScene,
} from './scenePlayback'

/** A fake Web Audio context and clock: sources and gains are recorded, time moves when told. */
function rig(failing: string[] = []) {
  const log: string[] = []
  const gains: { name: string; value: number; effective: number; ramps: [number, number][] }[] = []
  let time = 0
  let tick: (() => void) | null = null
  let release: (() => void) | null = null
  let gate: Promise<void> | null = null
  const ctx = {
    get currentTime() {
      return time
    },
    destination: 'out',
    resume: async () => {},
    decodeAudioData: async () => ({ duration: 2 }),
    createGain: () => {
      const entry = {
        name: `g${gains.length}`,
        value: 1,
        // Where the gain ends up: the last thing set or ramped to, as a real AudioParam would.
        effective: 1,
        ramps: [] as [number, number][],
      }
      gains.push(entry)
      return {
        gain: {
          get value() {
            return entry.value
          },
          set value(v: number) {
            entry.value = v
            entry.effective = v
          },
          setValueAtTime: (v: number) => {
            entry.effective = v
          },
          linearRampToValueAtTime: (v: number, when: number) => {
            entry.effective = v
            return entry.ramps.push([v, when])
          },
        },
        connect: (n: unknown) => n,
      }
    },
    createBufferSource: () => {
      const source = {
        buffer: null as { duration: number } | null,
        loop: false,
        onended: null,
        connect: (n: unknown) => n,
        start: () => log.push(`start${source.loop ? ' loop' : ''}`),
        stop: (when?: number) => log.push(`stop${when === undefined ? '' : ` ${when}`}`),
      }
      return source
    },
  }
  const views: PlaybackView[] = []
  const playback = createScenePlayback(
    {
      context: () => ctx,
      load: async (url) => {
        await gate
        if (failing.includes(url)) throw new Error('no')
        return new ArrayBuffer(1)
      },
      random: () => 0,
      every: (fn) => {
        tick = fn
        return () => (tick = null)
      },
    },
    (view) => views.push(view),
  )
  return {
    playback,
    log,
    gains,
    views,
    last: () => views[views.length - 1]!,
    at: async (seconds: number) => {
      time = seconds
      tick?.()
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    },
    hold: () => {
      gate = new Promise((r) => (release = r))
    },
    open: () => release?.(),
  }
}

const scene = (over: Partial<PlayScene> = {}): PlayScene => ({
  music: { url: '/music', level: 1 },
  state: 'plain',
  rows: [
    { id: 'wind', play: { mode: 'loop' }, state: null, level: 0.5, url: '/wind' },
    { id: 'bell', play: { mode: 'once', afterSeconds: 3 }, state: null, level: 1, url: '/bell' },
  ],
  ...over,
})
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('playing a scene', () => {
  test('starts only when every clip is loaded, and shows Loading until then', async () => {
    const r = rig()
    r.hold()
    void r.playback.start(scene())
    await settle()
    expect(r.last().phase).toBe('loading')
    expect(r.log).toEqual([])
    r.open()
    await settle()
    expect(r.last().phase).toBe('playing')
    // The music and the wind loop.
    expect(r.log).toEqual(['start loop', 'start loop'])
    expect(r.last().rows[0]).toEqual({ kind: 'playing' })
    expect(r.last().rows[1]).toEqual({ kind: 'in', seconds: 3 })
  })

  test('stopping while it loads cancels the start', async () => {
    const r = rig()
    r.hold()
    void r.playback.start(scene())
    await settle()
    r.playback.stop()
    r.open()
    await settle()
    expect(r.last().phase).toBe('stopped')
    expect(r.log).toEqual([])
  })

  test('a once row sounds on its tick, and stopping fades everything out over 0.3 s', async () => {
    const r = rig()
    await r.playback.start(scene())
    await settle()
    await r.at(TICK_MS / 1000)
    expect(r.log.filter((l) => l === 'start')).toHaveLength(0)
    await r.at(3)
    expect(r.log.filter((l) => l === 'start')).toHaveLength(1)
    r.playback.stop()
    expect(r.log.filter((l) => l.startsWith('stop 3.3'))).toHaveLength(3)
    expect(r.last()).toMatchObject({ phase: 'stopped', rows: [] })
  })

  test('a clip that cannot be loaded is reported and the rest plays on', async () => {
    const r = rig(['/bell'])
    await r.playback.start(scene())
    await settle()
    expect(r.last().phase).toBe('playing')
    expect(r.last().failed.has('/bell')).toBe(true)
    expect(r.log).toEqual(['start loop', 'start loop'])
  })

  test('mute and solo fade a sound to silence and back, solo winning; a level is heard at once', async () => {
    const r = rig()
    await r.playback.start(scene())
    await settle()
    const levelOf = (value: number) => r.gains.find((g) => g.value === value)!
    const windLevel = levelOf(0.5)
    r.playback.setMix({ muted: new Set([rowKey(0)]), soloed: new Set() })
    expect(windLevel.ramps.at(-1)).toEqual([0, 0.3])
    r.playback.setMix({ muted: new Set([rowKey(0)]), soloed: new Set([rowKey(0)]) })
    expect(windLevel.ramps.at(-1)).toEqual([0.5, 0.3])
    r.playback.setMix({ muted: new Set(), soloed: new Set([MUSIC_KEY]) })
    expect(windLevel.ramps.at(-1)).toEqual([0, 0.3])
  })

  test('another music track crossfades over a second', async () => {
    const r = rig()
    await r.playback.start(scene())
    await settle()
    await r.playback.update(scene({ music: { url: '/other', level: 1 } }))
    await settle()
    expect(r.log.filter((l) => l === 'stop 1')).toHaveLength(1)
    expect(r.log.filter((l) => l === 'start loop')).toHaveLength(3)
  })

  test('a row removed while playing fades out; a state switch is heard', async () => {
    const r = rig()
    await r.playback.start(
      scene({
        rows: [{ id: 'purr', play: { mode: 'loop' }, state: 'cat', level: 1, url: '/purr' }],
      }),
    )
    await settle()
    expect(r.last().rows[0]).toEqual({ kind: 'otherState' })
    r.playback.setState('cat')
    await settle()
    expect(r.last().rows[0]).toEqual({ kind: 'playing' })
    await r.playback.update(scene({ state: 'cat', rows: [] }))
    await settle()
    expect(r.log.filter((l) => l === 'stop 0.3').length).toBeGreaterThan(0)
  })

  test('a trigger fired plays its row at once', async () => {
    const r = rig()
    await r.playback.start(
      scene({
        rows: [
          {
            id: 'door',
            play: { mode: 'trigger', trigger: 'door-opens' },
            state: null,
            level: 1,
            url: '/door',
          },
        ],
      }),
    )
    await settle()
    r.playback.fire('door-opens')
    await settle()
    expect(r.log.filter((l) => l === 'start')).toHaveLength(1)
  })

  test('a row once plays a clip over the scene, whatever mute says', async () => {
    const r = rig()
    await r.playback.start(scene())
    await settle()
    await r.playback.once('/wind', 0.7)
    expect(r.log.filter((l) => l === 'start')).toHaveLength(1)
  })

  test('a level changed while playing is heard at once, with no ramp', async () => {
    const r = rig()
    await r.playback.start(scene())
    await settle()
    const windLevel = r.gains.find((g) => g.value === 0.5)!
    const changed = scene()
    changed.rows[0]!.level = 0.8
    await r.playback.update(changed)
    expect(windLevel.value).toBe(0.8)
    expect(windLevel.ramps).toEqual([])
  })

  test('removing a row while playing leaves the rows after it at their own levels', async () => {
    const r = rig()
    const two = scene({
      rows: [
        { id: 'a', play: { mode: 'loop' }, state: null, level: 1, url: '/a' },
        { id: 'b', play: { mode: 'loop' }, state: null, level: 0.5, url: '/b' },
      ],
    })
    await r.playback.start(two)
    await settle()
    const bLevel = r.gains.find((g) => g.value === 0.5)!
    // The page shifts the keys and sends the new rows in the same commit.
    r.playback.setMix({ muted: new Set(), soloed: new Set() })
    const update = r.playback.update(scene({ rows: [two.rows[1]!] }))
    r.playback.setMix({ muted: new Set(), soloed: new Set() })
    await update
    expect(bLevel.effective).toBe(0.5)
  })

  test('a level dragged while a mute ramp is pending wins', async () => {
    const r = rig()
    await r.playback.start(scene())
    await settle()
    const wind = r.gains.find((g) => g.value === 0.5)!
    r.playback.setMix({ muted: new Set([rowKey(0)]), soloed: new Set() })
    r.playback.setMix({ muted: new Set(), soloed: new Set() })
    const louder = scene()
    louder.rows[0]!.level = 0.9
    await r.playback.update(louder)
    expect(wind.effective).toBe(0.9)
  })

  test('a trigger fired twice while sounding leaves no voice that stop misses', async () => {
    const r = rig()
    const door = scene({
      music: { url: null, level: 1 },
      rows: [
        {
          id: 'door',
          play: { mode: 'trigger', trigger: 'go' },
          state: null,
          level: 1,
          url: '/door',
        },
      ],
    })
    await r.playback.start(door)
    await settle()
    r.playback.fire('go')
    r.playback.fire('go')
    r.playback.stop()
    expect(r.log.filter((l) => l === 'start')).toHaveLength(2)
    expect(r.log.filter((l) => l.startsWith('stop'))).toHaveLength(2)
  })

  test('a clip played over the scene ends with stop', async () => {
    const r = rig()
    await r.playback.start(scene({ music: { url: null, level: 1 }, rows: [] }))
    await settle()
    await r.playback.once('/wind', 1)
    r.playback.stop()
    expect(r.log.filter((l) => l.startsWith('stop'))).toHaveLength(1)
  })

  test('an edit made while loading is loaded and played', async () => {
    const r = rig()
    r.hold()
    void r.playback.start(scene({ rows: [] }))
    await settle()
    void r.playback.update(scene())
    r.open()
    await settle()
    await settle()
    expect(r.last().rows).toHaveLength(2)
    expect(r.log.filter((l) => l === 'start loop')).toHaveLength(2)
  })
})

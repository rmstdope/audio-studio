import { describe, expect, it } from 'bun:test'
import { createPlayer, type AudioLike, type PlayerState } from './player'

/** A fake audio element whose `play()` the test settles. */
function fakeAudio() {
  const plays: { src: string; resolve: () => void; reject: (e: unknown) => void }[] = []
  const element: AudioLike & { paused: boolean } = {
    src: '',
    currentTime: 0,
    paused: true,
    play() {
      element.paused = false
      return new Promise<void>((resolve, reject) =>
        plays.push({ src: element.src, resolve, reject }),
      )
    },
    pause() {
      element.paused = true
    },
  }
  return { element, plays }
}

function setUp() {
  const { element, plays } = fakeAudio()
  const states: PlayerState[] = []
  const player = createPlayer(element, (s) => states.push(s))
  const last = () => states.at(-1)
  return { element, plays, player, last }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const clips = [
  { id: 'a', url: '/a.mp3' },
  { id: 'b', url: '/b.mp3' },
  { id: 'c', url: '/c.mp3' },
]

describe('createPlayer', () => {
  it('plays one clip, and stops it when toggled again', () => {
    const { element, player, last } = setUp()
    player.toggle('a', '/a.mp3')
    expect([element.src, last()]).toEqual(['/a.mp3', { playing: 'a', inTurn: false }])
    player.toggle('a', '/a.mp3')
    expect([element.paused, last()]).toEqual([true, { playing: null, inTurn: false }])
  })

  it('stops after a single clip ends or fails', () => {
    const { player, last } = setUp()
    player.toggle('a', '/a.mp3')
    player.ended()
    expect(last()).toEqual({ playing: null, inTurn: false })
    player.toggle('b', '/b.mp3')
    player.failed()
    expect(last()).toEqual({ playing: null, inTurn: false })
  })

  it('plays a list in turn, and is done after the last', () => {
    const { element, player, last } = setUp()
    player.playInTurn(clips)
    expect(last()).toEqual({ playing: 'a', inTurn: true })
    player.ended()
    expect([element.src, last()]).toEqual(['/b.mp3', { playing: 'b', inTurn: true }])
    player.ended()
    player.ended()
    expect(last()).toEqual({ playing: null, inTurn: false })
  })

  it('skips a clip that fails once, though the failure is told twice (error, then rejection)', async () => {
    const { element, plays, player, last } = setUp()
    player.playInTurn(clips)
    player.failed()
    plays[0]!.reject(new DOMException('no source', 'NotSupportedError'))
    await flush()
    expect([element.src, last()]).toEqual(['/b.mp3', { playing: 'b', inTurn: true }])
    player.ended()
    expect(last()).toEqual({ playing: 'c', inTurn: true })
  })

  it('skips a clip whose play is refused, without an error event', async () => {
    const { element, plays, player } = setUp()
    player.playInTurn(clips)
    plays[0]!.reject(new Error('refused'))
    await flush()
    expect(element.src).toBe('/b.mp3')
  })

  it('ignores the rejection of a play it has moved on from', async () => {
    const { plays, player, last } = setUp()
    player.playInTurn(clips)
    player.toggle('x', '/x.mp3')
    plays[0]!.reject(new DOMException('interrupted', 'AbortError'))
    await flush()
    expect(last()).toEqual({ playing: 'x', inTurn: false })
  })

  it('stops a list on stop, or when another clip is played on its own', () => {
    const { player, last } = setUp()
    player.playInTurn(clips)
    player.stop()
    expect(last()).toEqual({ playing: null, inTurn: false })
    player.playInTurn(clips)
    player.toggle('x', '/x.mp3')
    player.ended()
    expect(last()).toEqual({ playing: null, inTurn: false })
  })

  it('starts nothing once disposed, whatever the element says after', async () => {
    const { element, plays, player, last } = setUp()
    player.playInTurn(clips)
    player.dispose()
    expect([element.paused, last()]).toEqual([true, { playing: null, inTurn: false }])
    plays[0]!.reject(new DOMException('paused', 'AbortError'))
    await flush()
    player.ended()
    player.failed()
    player.toggle('x', '/x.mp3')
    player.playInTurn(clips)
    expect(element.src).toBe('/a.mp3')
    expect(plays).toHaveLength(1)
  })
})

describe('createPlayer, telling a failure', () => {
  it('names the clip that failed once, though the failure is told twice', async () => {
    const { element, plays } = fakeAudio()
    const failed: string[] = []
    const player = createPlayer(
      element,
      () => {},
      (id) => failed.push(id),
    )
    player.toggle('a', '/a.mp3')
    player.failed()
    plays[0]!.reject(new Error('no'))
    await flush()
    expect(failed).toEqual(['a'])
  })

  it('does not name a clip that was stopped or replaced before it failed', async () => {
    const { element, plays } = fakeAudio()
    const failed: string[] = []
    const player = createPlayer(
      element,
      () => {},
      (id) => failed.push(id),
    )
    player.toggle('a', '/a.mp3')
    player.toggle('b', '/b.mp3')
    plays[0]!.reject(new Error('no'))
    await flush()
    expect(failed).toEqual([])
  })
})

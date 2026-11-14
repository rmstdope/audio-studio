import { describe, expect, it } from 'bun:test'
import { createTakeEngine, type BoardAccess, type TakeBoard, type TakeEntry } from './takeEngine'
import { createSerial } from './serial'
import { WriteRefused } from './files'
import { tempRepo } from '../../test/helpers'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let slots = 0

/** An engine over an in-memory board, standing for any medium. */
function setup() {
  let text = JSON.stringify({ next: 1, takes: [] })
  const writes: string[] = []
  const access: BoardAccess<TakeBoard> = {
    read: async () => JSON.parse(text) as TakeBoard,
    write: async (next) => {
      writes.push(next)
      text = next
    },
  }
  const engine = createTakeEngine<TakeEntry, TakeBoard>({
    slot: `testTakes${slots++}`,
    boards: createSerial(),
    now: () => 0,
  })
  const entry = (n: number, hash = 'a'): TakeEntry => ({
    n,
    state: 'waiting',
    startedAt: 0,
    message: '',
    hash,
  })
  return { engine, access, writes, entry }
}

describe('the take engine', () => {
  it('numbers the takes of one press one after another and never reuses a number', async () => {
    const { engine, access, entry } = setup()
    const first = await engine.reserve('p', 'x', access, 3, entry)
    expect(first).toEqual([entry(1), entry(2), entry(3)])
    // Take 2 is stopped, take 3 fails: the next press still starts at 4.
    engine.stop('p', 'x')
    const second = await engine.reserve('p', 'x', access, 2, entry)
    expect(Array.isArray(second) && second.map((e) => e.n)).toEqual([4, 5])
  })

  it('shows the takes of two presses made at once on an id with none yet', async () => {
    const { engine, access, entry } = setup()
    const both = await Promise.all([
      engine.reserve('p', 'x', access, 1, entry),
      engine.reserve('p', 'x', access, 1, entry),
    ])
    expect(both.map((made) => (Array.isArray(made) ? made[0]!.n : null))).toEqual([1, 2])
    expect(engine.entriesOf('p', 'x').map((e) => e.n)).toEqual([1, 2])
  })

  it('keeps a failed take shown when the inputs change, and Try again files it under the new ones', async () => {
    const { engine, access, entry } = setup()
    const [take] = (await engine.reserve('p', 'x', access, 1, entry)) as TakeEntry[]
    await engine.run('p', 'x', take!, {
      job: async () => {
        throw new Error('The model stopped')
      },
    })
    expect(take!.state).toBe('failed')
    expect(take!.message).toBe('The model stopped.')
    // The words changed: the failed take is still there, under its old hash, until retried.
    expect(engine.entriesOf('p', 'x').map((e) => [e.n, e.state, e.hash])).toEqual([
      [1, 'failed', 'a'],
    ])
    expect(engine.retry('p', 'x', 1, 'b')).toBe(take!)
    expect([take!.state, take!.hash]).toEqual(['waiting', 'b'])
    expect(engine.retry('p', 'x', 1, 'c')).toBeNull()
  })

  it('removes a take that finished, and runs it only once', async () => {
    const { engine, access, entry } = setup()
    const [take] = (await engine.reserve('p', 'x', access, 1, entry)) as TakeEntry[]
    let runs = 0
    const job = async () => {
      runs++
    }
    await engine.run('p', 'x', take!, { job })
    await engine.run('p', 'x', take!, { job })
    expect(runs).toBe(1)
    expect(engine.entriesOf('p', 'x')).toEqual([])
  })

  it('stops the take being made and the ones waiting, keeps failed ones, and says which were stopped', async () => {
    const { engine, access, entry } = setup()
    const [making, waiting, failed] = (await engine.reserve(
      'p',
      'x',
      access,
      3,
      entry,
    )) as TakeEntry[]
    failed!.state = 'failed'
    let signal: AbortSignal | undefined
    const running = engine.run('p', 'x', making!, {
      job: (s) =>
        new Promise<void>((resolve) => {
          signal = s
          s.addEventListener('abort', () => resolve())
        }),
    })
    const stopped: number[] = []
    expect(engine.stop('p', 'x', (e) => stopped.push(e.n))).toBe(2)
    await running
    expect(signal?.aborted).toBe(true)
    expect(stopped).toEqual([1, 2])
    expect(waiting!.n).toBe(2)
    expect(engine.entriesOf('p', 'x').map((e) => e.n)).toEqual([3])
    // A stopped take is not made later.
    let ran = false
    await engine.run('p', 'x', waiting!, { job: async () => void (ran = true) })
    expect(ran).toBe(false)
  })

  it('stops only the named takes that are waiting or being made, and says how many', async () => {
    const { engine, access, entry } = setup()
    const [one, two, three] = (await engine.reserve('p', 'x', access, 3, entry)) as TakeEntry[]
    three!.state = 'failed'
    expect(engine.stopTakes('p', 'x', [2, 3, 9])).toBe(1)
    expect(engine.entriesOf('p', 'x').map((e) => e.n)).toEqual([1, 3])
    expect(one!.n).toBe(1)
    expect(two!.n).toBe(2)
  })

  it('discards the named takes whatever their state, failed ones too, and says how many', async () => {
    const { engine, access, entry } = setup()
    const [, , three] = (await engine.reserve('p', 'x', access, 3, entry)) as TakeEntry[]
    three!.state = 'failed'
    expect(engine.discardTakes('p', 'x', [1, 3, 9])).toBe(2)
    expect(engine.entriesOf('p', 'x').map((e) => e.n)).toEqual([2])
  })

  it('stops every list of one project and no other project', async () => {
    const { engine, access, entry } = setup()
    await engine.reserve('p', 'x', access, 1, entry)
    await engine.reserve('p', 'y', access, 2, entry)
    await engine.reserve('q', 'x', access, 1, entry)
    const seen: string[] = []
    expect(engine.stopIn('p', (id, e) => seen.push(`${id}${e.n}`))).toBe(3)
    expect(engine.entriesOf('q', 'x')).toHaveLength(1)
    expect(seen.length).toBe(3)
  })

  it('summarises what is being made per id, leaving out ids with nothing to say', async () => {
    const { engine, access, entry } = setup()
    await engine.reserve('p', 'x', access, 2, entry)
    await engine.reserve('p', 'y', access, 1, entry)
    engine.entriesOf('p', 'y')[0]!.state = 'failed'
    const summary = engine.making('p', (entries) => {
      const takes = entries.filter((e) => e.state !== 'failed').length
      return takes ? { takes } : null
    })
    expect(summary).toEqual({ x: { takes: 2 } })
  })

  it('splits the entries a view shows: those not yet on the board are being made, failed ones are failed', () => {
    const { engine, entry } = setup()
    const failed = { ...entry(3), state: 'failed' as const }
    const entries = [entry(1), { ...entry(2), state: 'making' as const }, failed]
    const split = engine.split(entries, [{ n: 1 }])
    expect(split.pending.map((e) => e.n)).toEqual([2])
    expect(split.failed).toEqual([failed])
  })

  it('writes the board only when the change changed it, and takes the change back when the write fails', async () => {
    const { engine, access, writes } = setup()
    expect(await engine.changeBoard('p', 'x', access, () => 'same')).toBe('same')
    expect(writes).toEqual([])
    await engine.changeBoard('p', 'x', access, (board) => void (board.next = 9))
    expect(writes).toHaveLength(1)
    const broken: BoardAccess<TakeBoard> = {
      read: access.read,
      write: async () => {
        throw new Error('disk full')
      },
    }
    let undone = false
    await expect(
      engine.changeBoard(
        'p',
        'x',
        broken,
        (board) => void (board.next = 10),
        async () => void (undone = true),
      ),
    ).rejects.toThrow('disk full')
    expect(undone).toBe(true)
  })

  it('does one change to a board at a time, in the order asked', async () => {
    const { engine, access } = setup()
    const order: string[] = []
    const slow = engine.changeBoard('p', 'x', access, async () => {
      await Bun.sleep(10)
      order.push('slow')
    })
    const fast = engine.changeBoard('p', 'x', access, () => void order.push('fast'))
    await Promise.all([slow, fast])
    expect(order).toEqual(['slow', 'fast'])
  })

  it('returns the board read failure instead of changing anything', async () => {
    const { engine } = setup()
    const failure = { ok: false as const, file: 'f', problems: [] }
    const access: BoardAccess<TakeBoard> = {
      read: async () => failure,
      write: async () => {},
    }
    expect(await engine.changeBoard('p', 'x', access, () => 1)).toBe(failure)
    expect(await engine.reserve('p', 'x', access, 1, () => ({}) as TakeEntry)).toBe(failure)
  })

  it('is making from its first line unless the job is queued, and a queued one waits until it says it began', async () => {
    let clock = 0
    const engine = createTakeEngine<TakeEntry, TakeBoard>({
      slot: `testTakes${slots++}`,
      boards: createSerial(),
      now: () => ++clock,
    })
    const access: BoardAccess<TakeBoard> = {
      read: async () => ({ next: 1, takes: [] }),
      write: async () => {},
    }
    const entry = (n: number): TakeEntry => ({
      n,
      state: 'waiting',
      startedAt: 0,
      message: '',
      hash: '',
    })
    const [now, later] = (await engine.reserve('p', 'x', access, 2, entry)) as TakeEntry[]
    await engine.run('p', 'x', now!, { job: async () => expect(now!.state).toBe('making') })
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const running = engine.run('p', 'x', later!, {
      queued: true,
      job: async (_stop, began) => {
        expect([later!.state, later!.startedAt]).toEqual(['waiting', 0])
        await gate
        began()
        expect(later!.state).toBe('making')
        expect(later!.startedAt).toBeGreaterThan(0)
      },
    })
    release()
    await running
    expect(engine.entriesOf('p', 'x')).toEqual([])
  })

  it('discards one take in any state, stopping it if it is being made, and never makes it later', async () => {
    const { engine, access, entry } = setup()
    const [making, waiting, failed] = (await engine.reserve(
      'p',
      'x',
      access,
      3,
      entry,
    )) as TakeEntry[]
    failed!.state = 'failed'
    let signal: AbortSignal | undefined
    const running = engine.run('p', 'x', making!, {
      job: (s) =>
        new Promise<void>((resolve) => {
          signal = s
          s.addEventListener('abort', () => resolve())
        }),
    })
    expect(engine.discard('p', 'x', 1)).toBe(true)
    await running
    expect(signal?.aborted).toBe(true)
    expect(engine.discard('p', 'x', 2)).toBe(true)
    expect(engine.discard('p', 'x', 3)).toBe(true)
    expect(engine.discard('p', 'x', 3)).toBe(false)
    expect(engine.entriesOf('p', 'x')).toEqual([])
    let ran = false
    await engine.run('p', 'x', waiting!, { job: async () => void (ran = true) })
    expect(ran).toBe(false)
  })

  describe('saving a made take', () => {
    /** An engine with a folder for the take's file, standing for any medium. */
    function saving() {
      const root = tempRepo({})
      mkdirSync(join(root, 'takes'), { recursive: true })
      return { root, ...setup() }
    }
    const file = (root: string) => join(root, 'takes/1.wav')

    it('writes the file, then changes the board, and answers true', async () => {
      const { root, engine, access, writes } = saving()
      const saved = await engine.save('p', 'x', access, {
        root,
        path: 'takes/1.wav',
        bytes: new Uint8Array([1]),
        stop: new AbortController().signal,
        change: (board) => void (board.next = 7),
      })
      expect(saved).toBe(true)
      expect(existsSync(file(root))).toBe(true)
      expect(JSON.parse(writes[0]!).next).toBe(7)
    })

    it('removes the file and throws BoardUnusable naming the board when the board cannot be read', async () => {
      const { root, engine } = saving()
      const broken: BoardAccess<TakeBoard> = {
        read: async () => ({ ok: false, file: 'boards/x.json', problems: [] }),
        write: async () => {},
      }
      let cleaned = 0
      await expect(
        engine.save('p', 'x', broken, {
          root,
          path: 'takes/1.wav',
          bytes: new Uint8Array([1]),
          stop: new AbortController().signal,
          change: () => {},
          cleanup: () => void cleaned++,
        }),
      ).rejects.toThrow('boards/x.json cannot be used')
      expect(existsSync(file(root))).toBe(false)
      expect(cleaned).toBe(1)
    })

    it('removes the file and rethrows the refusal when the board cannot be written', async () => {
      const { root, engine, access } = saving()
      const refusing: BoardAccess<TakeBoard> = {
        read: access.read,
        write: async () => {
          throw new WriteRefused('boards/x.json', 'permission denied', null)
        },
      }
      await expect(
        engine.save('p', 'x', refusing, {
          root,
          path: 'takes/1.wav',
          bytes: new Uint8Array([1]),
          stop: new AbortController().signal,
          change: (board) => void board.next++,
        }),
      ).rejects.toBeInstanceOf(WriteRefused)
      expect(existsSync(file(root))).toBe(false)
    })

    it('throws the refusal naming the file, writing nothing to the board, when the file cannot be written', async () => {
      const { root, engine, access, writes } = saving()
      chmodSync(join(root, 'takes'), 0o555)
      try {
        await expect(
          engine.save('p', 'x', access, {
            root,
            path: 'takes/1.wav',
            bytes: new Uint8Array([1]),
            stop: new AbortController().signal,
            change: (board) => void board.next++,
          }),
        ).rejects.toThrow('takes/1.wav could not be written')
      } finally {
        chmodSync(join(root, 'takes'), 0o755)
      }
      expect(writes).toEqual([])
    })

    it('removes the file and answers false when stopped, leaving the board as it was', async () => {
      const { root, engine, access, writes } = saving()
      const stop = new AbortController()
      stop.abort()
      const saved = await engine.save('p', 'x', access, {
        root,
        path: 'takes/1.wav',
        bytes: new Uint8Array([1]),
        stop: stop.signal,
        change: (board) => void board.next++,
      })
      expect(saved).toBe(false)
      expect(existsSync(file(root))).toBe(false)
      expect(writes).toEqual([])
    })

    it('keeps the file and answers true when Stop arrives after the board lists the take', async () => {
      const { root, engine, access, writes } = saving()
      const stop = new AbortController()
      const saved = await engine.save('p', 'x', access, {
        root,
        path: 'takes/1.wav',
        bytes: new Uint8Array([1]),
        stop: stop.signal,
        change: (board) => {
          board.next = 7
          // Stop arrives once the take is on the board, before the board turn returns.
          stop.abort()
        },
      })
      expect(saved).toBe(true)
      expect(existsSync(file(root))).toBe(true)
      expect(JSON.parse(writes[0]!).next).toBe(7)
    })

    it('calls written once the board lists the take, and never when the board is refused or the take stopped', async () => {
      const { root, engine, access } = saving()
      let written = 0
      const base = { root, path: 'takes/1.wav', bytes: new Uint8Array([1]), change: () => {} }
      await engine.save('p', 'x', access, {
        ...base,
        stop: new AbortController().signal,
        change: (board) => void board.next++,
        written: async () => void written++,
      })
      expect(written).toBe(1)
      const refusing: BoardAccess<TakeBoard> = {
        read: access.read,
        write: async () => {
          throw new WriteRefused('boards/x.json', 'permission denied', null)
        },
      }
      await expect(
        engine.save('p', 'x', refusing, {
          ...base,
          stop: new AbortController().signal,
          change: (board) => void board.next++,
          written: async () => void written++,
        }),
      ).rejects.toBeInstanceOf(WriteRefused)
      const stopped = new AbortController()
      stopped.abort()
      await engine.save('p', 'x', access, {
        ...base,
        stop: stopped.signal,
        written: async () => void written++,
      })
      expect(written).toBe(1)
    })

    it('shows a save failure as a failed take without calling the medium’s failed hook', async () => {
      const { engine, access, entry } = setup()
      const [take] = (await engine.reserve('p', 'x', access, 1, entry)) as TakeEntry[]
      let blamed = 0
      const quiet = console.error
      console.error = () => {}
      try {
        await engine.run('p', 'x', take!, {
          job: async () => {
            throw new WriteRefused('takes/1.wav', 'permission denied', null)
          },
          failed: () => void blamed++,
        })
      } finally {
        console.error = quiet
      }
      expect(take!.state).toBe('failed')
      expect(take!.message).toBe('takes/1.wav could not be written.')
      expect(blamed).toBe(0)
      // A model's own failure still reaches it.
      const [other] = (await engine.reserve('p', 'x', access, 1, entry)) as TakeEntry[]
      await engine.run('p', 'x', other!, {
        job: async () => {
          throw new Error('The model stopped')
        },
        failed: () => void blamed++,
      })
      expect(blamed).toBe(1)
    })
  })
})

import { describe, expect, it } from 'bun:test'
import { createTakeEngine, type BoardAccess, type TakeBoard, type TakeEntry } from './takeEngine'
import { createSerial } from './serial'

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
})

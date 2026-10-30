import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { createGpuWorkers, GPU } from './gpu'
import {
  createMfluxGenerator,
  makeImageTake,
  mfluxArguments,
  mfluxReady,
  type ImageGenerator,
  type ImageRequest,
} from './images'
import { createSerial } from './serial'

const request: ImageRequest = {
  prompt: 'a room',
  width: 1024,
  height: 576,
  seed: 42,
  model: 'klein',
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const mac = { which: () => true, platform: 'darwin', arch: 'arm64' }

/** A stand-in for mflux-generate: a script that writes the argument after --output, or fails. */
const fake = (script: string) => (a: ReturnType<typeof mfluxArguments>) => ({
  command: ['bun', '-e', script, JSON.stringify(a)],
  out: a.out,
})

describe('mfluxArguments', () => {
  it('names the model mflux knows, the size and the seed', () => {
    const args = mfluxArguments({ ...request, model: 'z-image-turbo' }, '/tmp/x.png')
    expect(args.args).toEqual([
      '--model', 'z-image-turbo',
      '--prompt', 'a room',
      '--width', '1024',
      '--height', '576',
      '--seed', '42',
      '--output', '/tmp/x.png',
    ]) // prettier-ignore
  })
})

describe('mfluxReady', () => {
  it('needs Apple silicon and mflux-generate', () => {
    expect(mfluxReady(mac)).toEqual({ ok: true })
    expect(mfluxReady({ ...mac, platform: 'linux' })).toMatchObject({ ok: false })
    expect(mfluxReady({ ...mac, which: () => false })).toMatchObject({
      ok: false,
      message: expect.stringContaining('mflux'),
    })
  })
})

describe('createMfluxGenerator', () => {
  const writes = `const a=JSON.parse(process.argv[1]);const i=a.args.indexOf('--output');await Bun.write(a.args[i+1],new Uint8Array([137,80,78,71]));`

  it('runs one process for the take and gives its image and seed back', async () => {
    let out = ''
    const generator = createMfluxGenerator({
      build: (a) => {
        out = a.out
        return fake(writes)(a)
      },
    })
    const take = await generator.generate(request)
    expect([...take.png]).toEqual([137, 80, 78, 71])
    expect(take.seed).toBe(42)
    expect(existsSync(out)).toBe(false)
  })

  it('says why a take failed', async () => {
    const generator = createMfluxGenerator({
      build: fake(`console.error('bad model');process.exit(2)`),
    })
    await expect(generator.generate(request)).rejects.toThrow(/bad model/)
  })

  it('says the computer ran out of memory when the system killed it', async () => {
    const generator = createMfluxGenerator({
      build: fake(`process.kill(process.pid,'SIGKILL')`),
    })
    await expect(generator.generate(request)).rejects.toThrow(/memory/)
  })

  it('fails a take that wrote no image', async () => {
    const generator = createMfluxGenerator({ build: fake(`1`) })
    await expect(generator.generate(request)).rejects.toThrow(/no image/)
  })

  it('keeps the error, not the progress bars, in the message', async () => {
    const generator = createMfluxGenerator({
      build: fake(
        `console.error('error line');for(let i=0;i<3;i++)console.error('50%|#####| 2/4\\r50%|#####| 3/4');process.exit(2)`,
      ),
    })
    await expect(generator.generate(request)).rejects.toThrow(/error line/)
  })

  it('stops the process when aborted', async () => {
    const generator = createMfluxGenerator({ build: fake(`await Bun.sleep(30000)`) })
    const controller = new AbortController()
    const started = Date.now()
    const take = generator.generate(request, controller.signal)
    setTimeout(() => controller.abort(), 100)
    await expect(take).rejects.toThrow(/stopped/)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('refuses a request mflux cannot make, before running anything', async () => {
    const generator = createMfluxGenerator({ build: fake(writes) })
    await expect(generator.generate({ ...request, width: 1000 })).rejects.toThrow(/width/)
  })
})

describe('makeImageTake', () => {
  it('runs an image take, a music take and a Whisper check one at a time, freeing the GPU first', async () => {
    const queue = createSerial()
    const workers = createGpuWorkers()
    const log: string[] = []
    let running = 0
    let most = 0
    const job = (name: string) => async () => {
      running++
      most = Math.max(most, running)
      log.push(`${name}:start`)
      await wait(15)
      log.push(`${name}:end`)
      running--
    }
    workers.add(() => void log.push('free'))
    const generator: ImageGenerator = {
      ready: () => ({ ok: true }),
      generate: async (r) => {
        await job('image')()
        return { png: new Uint8Array(), seed: r.seed }
      },
    }
    await Promise.all([
      queue.run(GPU, job('music')),
      makeImageTake({ generator, queue, free: () => workers.free() }, request),
      queue.run(GPU, job('whisper')),
    ])
    expect(most).toBe(1)
    expect(log).toEqual([
      'music:start',
      'music:end',
      'free',
      'image:start',
      'image:end',
      'whisper:start',
      'whisper:end',
    ])
  })

  it('waits for the closed workers to be gone before the model loads', async () => {
    const log: string[] = []
    const generator: ImageGenerator = {
      ready: () => ({ ok: true }),
      generate: async (r) => {
        log.push('generate')
        return { png: new Uint8Array(), seed: r.seed }
      },
    }
    await makeImageTake(
      {
        generator,
        queue: createSerial(),
        free: async () => {
          await wait(20)
          log.push('gone')
        },
      },
      request,
    )
    expect(log).toEqual(['gone', 'generate'])
  })

  it('does not close the workers for a take stopped while it waited', async () => {
    const queue = createSerial()
    const log: string[] = []
    const generator: ImageGenerator = {
      ready: () => ({ ok: true }),
      generate: async (r) => {
        log.push('generate')
        return { png: new Uint8Array(), seed: r.seed }
      },
    }
    const controller = new AbortController()
    const first = queue.run(GPU, () => wait(20))
    const take = makeImageTake(
      { generator, queue, free: () => void log.push('free') },
      request,
      controller.signal,
    )
    controller.abort()
    await expect(take).rejects.toThrow(/stopped/)
    await first
    expect(log).toEqual([])
  })

  it('refuses a request that cannot be made without taking its turn', async () => {
    const log: string[] = []
    const generator: ImageGenerator = {
      ready: () => ({ ok: true }),
      generate: async () => ({ png: new Uint8Array(), seed: 1 }),
    }
    await expect(
      makeImageTake(
        { generator, queue: createSerial(), free: () => void log.push('free') },
        { ...request, prompt: '' },
      ),
    ).rejects.toThrow(/prompt/)
    expect(log).toEqual([])
  })
})

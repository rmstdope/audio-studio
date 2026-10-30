import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGpuWorkers, GPU } from './gpu'
import {
  createMfluxGenerator,
  hubDirOf,
  imageModelInstalled,
  makeImageTake,
  mfluxArguments,
  mfluxCommandLine,
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
  it('runs each model through its own mflux command', () => {
    expect(mfluxArguments(request, '/tmp/x.png').program).toBe('mflux-generate-flux2')
    expect(mfluxArguments({ ...request, model: 'z-image-turbo' }, '/tmp/x.png').program).toBe(
      'mflux-generate-z-image-turbo',
    )
  })

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

describe('mfluxCommandLine', () => {
  it("starts with the model's own command", () => {
    const line = mfluxCommandLine(
      mfluxArguments({ ...request, model: 'z-image-turbo' }, '/tmp/x.png'),
    )
    expect(line.command[0]).toBe('mflux-generate-z-image-turbo')
    expect(line.out).toBe('/tmp/x.png')
  })
})

describe('mfluxReady', () => {
  it("needs Apple silicon and both of mflux's image commands", () => {
    expect(mfluxReady(mac)).toEqual({ ok: true })
    expect(mfluxReady({ ...mac, which: (c) => c === 'mflux-generate-flux2' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('mflux-generate-z-image-turbo'),
    })
    expect(mfluxReady({ ...mac, platform: 'linux' })).toMatchObject({ ok: false })
    expect(mfluxReady({ ...mac, which: () => false })).toMatchObject({
      ok: false,
      message: expect.stringContaining('mflux'),
    })
  })
})

describe('imageModelInstalled', () => {
  const hub = () => mkdtempSync(join(tmpdir(), 'hub-'))
  const download = (dir: string, folder: string, files = ['model.safetensors']) => {
    const snapshot = join(dir, folder, 'snapshots', 'abc')
    mkdirSync(snapshot, { recursive: true })
    for (const file of files) writeFileSync(join(snapshot, file), '{}')
  }

  it('finds a model by its Hugging Face folder, with a snapshot in it', () => {
    const dir = hub()
    expect(imageModelInstalled(dir, 'klein')).toBe(false)
    download(dir, 'models--black-forest-labs--FLUX.2-klein-4B')
    expect(imageModelInstalled(dir, 'klein')).toBe(true)
    expect(imageModelInstalled(dir, 'z-image-turbo')).toBe(false)
  })

  it('does not count a folder with no snapshot (a download that never finished)', () => {
    const dir = hub()
    mkdirSync(join(dir, 'models--Tongyi-MAI--Z-Image-Turbo', 'blobs'), { recursive: true })
    expect(imageModelInstalled(dir, 'z-image-turbo')).toBe(false)
    download(dir, 'models--Tongyi-MAI--Z-Image-Turbo', [])
    expect(imageModelInstalled(dir, 'z-image-turbo')).toBe(false)
  })

  it('does not count a download stopped after its configs, and finds weights in a subfolder', () => {
    const dir = hub()
    download(dir, 'models--Tongyi-MAI--Z-Image-Turbo', ['model_index.json'])
    expect(imageModelInstalled(dir, 'z-image-turbo')).toBe(false)
    const sub = join(dir, 'models--Tongyi-MAI--Z-Image-Turbo', 'snapshots', 'abc', 'transformer')
    mkdirSync(sub)
    writeFileSync(join(sub, 'part-1.safetensors'), 'x')
    expect(imageModelInstalled(dir, 'z-image-turbo')).toBe(true)
  })

  it('is not thrown by a file among the snapshots, such as .DS_Store', () => {
    const dir = hub()
    download(dir, 'models--black-forest-labs--FLUX.2-klein-4B')
    writeFileSync(
      join(dir, 'models--black-forest-labs--FLUX.2-klein-4B', 'snapshots', '.DS_Store'),
      'x',
    )
    expect(imageModelInstalled(dir, 'klein')).toBe(true)
    writeFileSync(join(dir, 'models--Tongyi-MAI--Z-Image-Turbo'), 'not a folder')
    expect(imageModelInstalled(dir, 'z-image-turbo')).toBe(false)
  })

  it('looks where Hugging Face keeps its downloads', () => {
    expect(hubDirOf({ HF_HUB_CACHE: '/a' }, '/home/me')).toBe('/a')
    expect(hubDirOf({ HF_HOME: '/b' }, '/home/me')).toBe('/b/hub')
    expect(hubDirOf({}, '/home/me')).toBe('/home/me/.cache/huggingface/hub')
  })

  it('is what the generator answers for installed', () => {
    const dir = hub()
    download(dir, 'models--black-forest-labs--FLUX.2-klein-4B')
    const generator = createMfluxGenerator({ hubDir: dir })
    expect(generator.installed('klein')).toBe(true)
    expect(generator.installed('z-image-turbo')).toBe(false)
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

  it('says why a take failed in plain words, keeping the raw output for the log', async () => {
    const logged: string[] = []
    const generator = createMfluxGenerator({
      build: fake(
        `console.error('Traceback (most recent call last):');console.error('  File "/x/weight_loader.py", line 341, in _load_mlx_native');console.error('FileNotFoundError: No safetensors found');process.exit(1)`,
      ),
      log: (line) => logged.push(line),
    })
    const failure: Error = await generator.generate(request).then(
      () => new Error('made an image'),
      (e: unknown) => e as Error,
    )
    expect(failure.message).toBe(
      'FLUX.2 klein 4B could not load its weights: they are missing or incomplete on this computer, and Setup says how to download them.',
    )
    expect(logged.join('\n')).toContain('weight_loader.py')
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

  it('logs the error, not the progress bars, and keeps both out of the message', async () => {
    const logged: string[] = []
    const generator = createMfluxGenerator({
      build: fake(
        `console.error('error line');for(let i=0;i<3;i++)console.error('50%|#####| 2/4\\r50%|#####| 3/4');process.exit(2)`,
      ),
      log: (line) => logged.push(line),
    })
    const failure: Error = await generator.generate(request).then(
      () => new Error('made an image'),
      (e: unknown) => e as Error,
    )
    expect(failure.message).toContain('exit code 2')
    expect(failure.message).not.toContain('error line')
    expect(logged.join('\n')).toContain('error line')
    expect(logged.join('\n')).not.toContain('50%')
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

describe('makeImageTake turn', () => {
  it('says when the take’s turn comes, not for a take stopped while it waited', async () => {
    const queue = createSerial()
    const generator: ImageGenerator = {
      ready: () => ({ ok: true }),
      installed: () => true,
      generate: async (r) => ({ png: new Uint8Array(), seed: r.seed }),
    }
    const turns: string[] = []
    const gate = queue.run(GPU, () => wait(20))
    const stop = new AbortController()
    const stopped = makeImageTake({ generator, queue, free: () => {} }, request, stop.signal, () =>
      turns.push('stopped'),
    )
    stop.abort()
    const made = makeImageTake({ generator, queue, free: () => {} }, request, undefined, () =>
      turns.push('made'),
    )
    await gate
    await expect(stopped).rejects.toThrow()
    await made
    expect(turns).toEqual(['made'])
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
      installed: () => true,
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
      installed: () => true,
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
      installed: () => true,
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
      installed: () => true,
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

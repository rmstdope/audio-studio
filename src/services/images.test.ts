import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imageModel } from '../core/imageModels'
import { createGpuWorkers, gpuInUse, GPU } from './gpu'
import {
  createMfluxGenerator,
  hubDirOf,
  ImageToolError,
  hubDownload,
  imageModelDownload,
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

  it('runs Qwen-Image through mflux-generate-qwen with its repository as the model, quantizing and steps', () => {
    const model = imageModel('qwen-image')
    const args = mfluxArguments({ ...request, model: 'qwen-image' }, '/tmp/x.png')
    expect(args.program).toBe('mflux-generate-qwen')
    expect(args.args).toEqual([
      '--model', 'Qwen/Qwen-Image',
      '--base-model', 'qwen-image',
      ...(model.quantize ? ['--quantize', String(model.quantize)] : []),
      ...(model.steps ? ['--steps', String(model.steps)] : []),
      '--prompt', 'a room',
      '--width', '1024',
      '--height', '576',
      '--seed', '42',
      '--output', '/tmp/x.png',
    ]) // prettier-ignore
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

describe('mfluxArguments of an edit', () => {
  it("runs FLUX.2 klein's edit command on the picture, at the picture's size", () => {
    const edit = mfluxArguments({ ...request, editing: '/repo/25.png' }, '/tmp/x.png')
    expect(edit.program).toBe('mflux-generate-flux2-edit')
    expect(edit.args).toEqual([
      '--model', 'flux2-klein-4b',
      '--image-paths', '/repo/25.png',
      '--prompt', 'a room',
      '--width', '1024',
      '--height', '576',
      '--seed', '42',
      '--output', '/tmp/x.png',
    ]) // prettier-ignore
  })
})

describe('mfluxArguments of a Qwen Image Edit take', () => {
  it('names the repository, its base, 8 bits and 30 steps, with its own command', () => {
    const edit = mfluxArguments(
      { ...request, model: 'qwen-edit', editing: '/repo/25.png' },
      '/tmp/x.png',
    )
    expect(edit.program).toBe('mflux-generate-qwen-edit')
    expect(edit.args).toEqual([
      '--model', 'Qwen/Qwen-Image-Edit',
      '--base-model', 'qwen-image-edit',
      '--quantize', '8',
      '--steps', '30',
      '--image-paths', '/repo/25.png',
      '--prompt', 'a room',
      '--width', '1024',
      '--height', '576',
      '--seed', '42',
      '--output', '/tmp/x.png',
    ]) // prettier-ignore
  })

  it('finds the Qwen weights in the hub by their repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-'))
    expect(imageModelDownload(dir, 'qwen-edit')).toBe('absent')
    const snapshot = join(dir, 'models--Qwen--Qwen-Image-Edit', 'snapshots', 'abc')
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(join(snapshot, 'model.safetensors'), '{}')
    expect(imageModelDownload(dir, 'qwen-edit')).toBe('whole')
    expect(imageModelInstalled(dir, 'qwen-edit')).toBe(true)
  })

  it('says a failed Qwen take could not make the take', async () => {
    const generator = createMfluxGenerator({
      machine: mac,
      log: () => {},
      build: fake('console.error("boom"); process.exit(3)'),
    })
    await expect(
      generator.generate({ ...request, model: 'qwen-edit', editing: '/repo/25.png' }),
    ).rejects.toThrow('Qwen Image Edit could not make the take (mflux stopped with exit code 3)')
  })
})

describe('canEdit', () => {
  it('asks for the command of the model given', async () => {
    const onlyKlein = createMfluxGenerator({
      machine: { ...mac, which: (c) => c !== 'mflux-generate-qwen-edit' },
    })
    expect(await onlyKlein.canEdit?.('klein')).toBe(true)
    expect(await onlyKlein.canEdit?.('qwen-edit')).toBe(false)
  })

  it('asks whether the installed mflux has the edit command', async () => {
    const has = createMfluxGenerator({ machine: mac })
    const lacks = createMfluxGenerator({
      machine: { ...mac, which: (c) => c !== 'mflux-generate-flux2-edit' },
    })
    expect(await has.canEdit?.()).toBe(true)
    expect(await lacks.canEdit?.()).toBe(false)
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
    // An mflux without the Qwen-Image command still runs the other two.
    expect(mfluxReady({ ...mac, which: (c) => c !== 'mflux-generate-qwen' })).toEqual({ ok: true })
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
      'FLUX.2 klein 4B could not load its weights: they are missing or incomplete on this computer; download them again with uvx --from huggingface_hub hf download black-forest-labs/FLUX.2-klein-4B, then Try again.',
    )
    expect(logged.join('\n')).toContain('weight_loader.py')
    expect(failure).toBeInstanceOf(ImageToolError)
    expect((failure as ImageToolError).lastLine).toBe('FileNotFoundError: No safetensors found')
  })

  it('has an empty last line when the tool said nothing', async () => {
    const generator = createMfluxGenerator({ build: fake(`process.exit(3)`), log: () => {} })
    const failure = await generator.generate(request).catch((e: unknown) => e as ImageToolError)
    expect(failure).toBeInstanceOf(ImageToolError)
    expect((failure as ImageToolError).lastLine).toBe('')
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

  it('says an mflux without the model’s command cannot make it, not the raw spawn error', async () => {
    const generator = createMfluxGenerator({
      build: () => ({ command: ['/no/such/mflux-generate-qwen'], out: '/tmp/none.png' }),
      log: () => {},
    })
    await expect(generator.generate({ ...request, model: 'qwen-image' })).rejects.toThrow(
      /installed mflux cannot make Qwen-Image images/,
    )
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

describe('makeImageTake use of the GPU', () => {
  it('shows as an image while the take is made', async () => {
    const seen: (string | null)[] = []
    const generator: ImageGenerator = {
      ready: () => ({ ok: true }),
      installed: () => true,
      generate: async (r) => {
        seen.push(gpuInUse())
        return { png: new Uint8Array(), seed: r.seed }
      },
    }
    await makeImageTake({ generator, queue: createSerial(), free: () => {} }, request)
    expect(seen).toEqual(['image'])
    expect(gpuInUse()).toBeNull()
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

describe('imageModelDownload', () => {
  const KLEIN = 'models--black-forest-labs--FLUX.2-klein-4B'
  const hub = () => mkdtempSync(join(tmpdir(), 'hub-'))
  /** A Hugging Face folder: blobs, and a snapshot whose files are links to them. */
  const whole = (dir: string, folder = KLEIN) => {
    const blobs = join(dir, folder, 'blobs')
    const snapshot = join(dir, folder, 'snapshots', 'abc')
    mkdirSync(blobs, { recursive: true })
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(join(blobs, 'h1'), 'weights')
    symlinkSync(join('..', '..', 'blobs', 'h1'), join(snapshot, 'model.safetensors'))
    return { blobs, snapshot }
  }

  it('is absent with no folder, whole with weights and nothing unfinished', () => {
    const dir = hub()
    expect(imageModelDownload(dir, 'klein')).toBe('absent')
    whole(dir)
    expect(imageModelDownload(dir, 'klein')).toBe('whole')
  })

  it('checks any repository the same way (the sound-effect model)', () => {
    const dir = hub()
    expect(hubDownload(dir, 'stabilityai/stable-audio-3-small-sfx')).toBe('absent')
    whole(dir, 'models--stabilityai--stable-audio-3-small-sfx')
    expect(hubDownload(dir, 'stabilityai/stable-audio-3-small-sfx')).toBe('whole')
  })

  it('is partial for a folder with no weights, or with an unfinished blob', () => {
    const dir = hub()
    mkdirSync(join(dir, KLEIN, 'blobs'), { recursive: true })
    expect(imageModelDownload(dir, 'klein')).toBe('partial')
    const { blobs } = whole(dir)
    writeFileSync(join(blobs, 'h2.incomplete'), 'half')
    expect(imageModelDownload(dir, 'klein')).toBe('partial')
  })

  describe('with no shard index, and .incomplete files in blobs', () => {
    const SFX_REPO = 'stabilityai/stable-audio-3-small-sfx'
    const SFX = 'models--stabilityai--stable-audio-3-small-sfx'

    it('is whole when each .incomplete is a leftover of a blob that finished', () => {
      const dir = hub()
      const { blobs } = whole(dir, SFX)
      writeFileSync(join(blobs, 'h1.6fc64d0e.incomplete'), 'half')
      writeFileSync(join(blobs, 'h1.incomplete'), 'half')
      expect(hubDownload(dir, SFX_REPO)).toBe('whole')
    })

    it('stays partial while a blob with no finished file is still coming, beside a leftover', () => {
      const dir = hub()
      const { blobs } = whole(dir, SFX)
      writeFileSync(join(blobs, 'h1.6fc64d0e.incomplete'), 'half')
      writeFileSync(join(blobs, 'h2.a829cf6b.incomplete'), 'half')
      expect(hubDownload(dir, SFX_REPO)).toBe('partial')
    })
  })

  it('is partial when a snapshot link points at nothing', () => {
    const dir = hub()
    const { snapshot } = whole(dir)
    symlinkSync(join('..', '..', 'blobs', 'gone'), join(snapshot, 'other.safetensors'))
    expect(imageModelDownload(dir, 'klein')).toBe('partial')
  })

  it('is partial when a shard the index names is not there', () => {
    const dir = hub()
    const { snapshot } = whole(dir)
    writeFileSync(
      join(snapshot, 'model.safetensors.index.json'),
      JSON.stringify({ weight_map: { a: 'model.safetensors', b: 'model-2.safetensors' } }),
    )
    expect(imageModelDownload(dir, 'klein')).toBe('partial')
    writeFileSync(join(snapshot, 'model-2.safetensors'), 'x')
    expect(imageModelDownload(dir, 'klein')).toBe('whole')
  })

  /** A part of a model: a folder in the snapshot holding these files. */
  const part = (snapshot: string, name: string, files: string[]) => {
    mkdirSync(join(snapshot, name))
    for (const file of files) writeFileSync(join(snapshot, name, file), '{}')
  }
  /** A finished part whose weights are in shards: config, shards and the index naming them. */
  const shardedPart = (snapshot: string, name: string) => {
    part(snapshot, name, ['config.json', 'model-00001-of-00001.safetensors'])
    writeFileSync(
      join(snapshot, name, 'model.safetensors.index.json'),
      JSON.stringify({ weight_map: { a: 'model-00001-of-00001.safetensors' } }),
    )
  }
  /** A snapshot laid out like Qwen Image Edit's, with its text encoder finished and a blob unfinished. */
  const modelOfParts = (dir: string) => {
    const { blobs, snapshot } = whole(dir)
    rmSync(join(snapshot, 'model.safetensors'))
    shardedPart(snapshot, 'text_encoder')
    writeFileSync(join(blobs, 'h2.incomplete'), 'half')
    return snapshot
  }

  it('is whole when every part is finished, whatever .incomplete files are left in blobs', () => {
    const dir = hub()
    const snapshot = modelOfParts(dir)
    shardedPart(snapshot, 'transformer')
    part(snapshot, 'vae', ['config.json', 'diffusion_pytorch_model.safetensors'])
    expect(imageModelDownload(dir, 'klein')).toBe('whole')
  })

  it('stays partial while a part after a finished one has shards but no index yet', () => {
    const dir = hub()
    part(modelOfParts(dir), 'transformer', ['config.json', 'model-00001-of-00002.safetensors'])
    expect(imageModelDownload(dir, 'klein')).toBe('partial')
  })

  it('stays partial while a part after a finished one has only its config', () => {
    const dir = hub()
    part(modelOfParts(dir), 'vae', ['config.json'])
    expect(imageModelDownload(dir, 'klein')).toBe('partial')
  })

  it('stays partial while a folder has shards but no index, even with no config', () => {
    const dir = hub()
    part(modelOfParts(dir), 'transformer', ['model-00001-of-00002.safetensors'])
    expect(imageModelDownload(dir, 'klein')).toBe('partial')
  })

  /** The `model_index.json` of a pipeline with these parts, a part with `[null, null]` being one it does without and a value that is no list a setting. */
  const modelIndex = (snapshot: string, parts: Record<string, (string | null)[] | boolean>) =>
    writeFileSync(
      join(snapshot, 'model_index.json'),
      JSON.stringify({ _class_name: 'QwenImageEditPipeline', ...parts }),
    )
  const USED = ['diffusers', 'SomeClass']

  it('stays partial when a part model_index.json lists has no folder yet', () => {
    const dir = hub()
    const snapshot = modelOfParts(dir)
    shardedPart(snapshot, 'transformer')
    modelIndex(snapshot, { text_encoder: USED, transformer: USED, vae: USED })
    expect(imageModelDownload(dir, 'klein')).toBe('partial')
  })

  it('stays partial when the folder of a part model_index.json lists is still empty', () => {
    const dir = hub()
    const snapshot = modelOfParts(dir)
    shardedPart(snapshot, 'transformer')
    part(snapshot, 'vae', [])
    modelIndex(snapshot, { text_encoder: USED, transformer: USED, vae: USED })
    expect(imageModelDownload(dir, 'klein')).toBe('partial')
  })

  it('is whole with a leftover when every part model_index.json lists is there', () => {
    const dir = hub()
    const snapshot = modelOfParts(dir)
    shardedPart(snapshot, 'transformer')
    part(snapshot, 'vae', ['config.json', 'diffusion_pytorch_model.safetensors'])
    modelIndex(snapshot, { text_encoder: USED, transformer: USED, vae: USED })
    expect(imageModelDownload(dir, 'klein')).toBe('whole')
  })

  it('does not wait for a part model_index.json says the model does without', () => {
    const dir = hub()
    const snapshot = modelOfParts(dir)
    modelIndex(snapshot, { text_encoder: USED, safety_checker: [null, null], is_distilled: true })
    expect(imageModelDownload(dir, 'klein')).toBe('whole')
  })

  it('stays partial with a leftover when model_index.json cannot be read', () => {
    const dir = hub()
    const snapshot = modelOfParts(dir)
    writeFileSync(join(snapshot, 'model_index.json'), '{ not json')
    expect(imageModelDownload(dir, 'klein')).toBe('partial')
  })

  describe('with nothing unfinished left in blobs', () => {
    /** A snapshot like `modelOfParts` makes, the stopped download's leftovers cleared. */
    const clearedModelOfParts = (dir: string) => {
      const snapshot = modelOfParts(dir)
      rmSync(join(dir, KLEIN, 'blobs', 'h2.incomplete'))
      return snapshot
    }

    it('is partial while a part model_index.json lists is missing, and whole once it is back', () => {
      const dir = hub()
      const snapshot = clearedModelOfParts(dir)
      shardedPart(snapshot, 'transformer')
      modelIndex(snapshot, { text_encoder: USED, transformer: USED, vae: USED })
      expect(imageModelDownload(dir, 'klein')).toBe('partial')
      part(snapshot, 'vae', ['config.json', 'diffusion_pytorch_model.safetensors'])
      expect(imageModelDownload(dir, 'klein')).toBe('whole')
    })

    it('is partial while a part has only its config, the download stopped between two files', () => {
      const dir = hub()
      part(clearedModelOfParts(dir), 'vae', ['config.json'])
      expect(imageModelDownload(dir, 'klein')).toBe('partial')
    })
  })

  describe('with more than one snapshot', () => {
    /** A second snapshot beside `whole`'s, and `refs/main` naming `current`. */
    const secondSnapshot = (dir: string, current: string) => {
      const snapshot = join(dir, KLEIN, 'snapshots', 'old')
      mkdirSync(snapshot)
      mkdirSync(join(dir, KLEIN, 'refs'))
      writeFileSync(join(dir, KLEIN, 'refs', 'main'), `${current}\n`)
      return snapshot
    }

    it('is whole when only a snapshot refs/main does not name has a part waiting', () => {
      const dir = hub()
      whole(dir)
      part(secondSnapshot(dir, 'abc'), 'vae', ['config.json'])
      expect(imageModelDownload(dir, 'klein')).toBe('whole')
    })

    it('is partial when the snapshot refs/main names has a part waiting, beside a whole one', () => {
      const dir = hub()
      const { snapshot } = whole(dir)
      part(snapshot, 'vae', ['config.json'])
      writeFileSync(join(secondSnapshot(dir, 'abc'), 'model.safetensors'), '{}')
      expect(imageModelDownload(dir, 'klein')).toBe('partial')
    })

    it('is partial when the snapshot refs/main names has not been made yet', () => {
      const dir = hub()
      whole(dir)
      secondSnapshot(dir, 'newer')
      expect(imageModelDownload(dir, 'klein')).toBe('partial')
    })
  })

  it('only a whole download counts as installed', () => {
    const dir = hub()
    mkdirSync(join(dir, KLEIN, 'blobs'), { recursive: true })
    expect(imageModelInstalled(dir, 'klein')).toBe(false)
    whole(dir)
    expect(imageModelInstalled(dir, 'klein')).toBe(true)
  })
})

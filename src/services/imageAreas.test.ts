import { describe, expect, it } from 'bun:test'
import { chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { choices } from './musicClips'
import { syncImageAreas } from './imageAreas'
import { openProject } from './workspace'

const images = {
  from: { part: 'tts/{part}/images.json' },
  clips: 'web/public/images/generated',
  manifest: 'web/public/images/generated/manifest.json',
}
const MANIFEST = 'web/public/images/generated/manifest.json'
const EDITS = 'content-studio/images/edits.json'
const box = { x: 80, y: 50, width: 160, height: 100 }
const fountain = { id: 'fountain', title: 'Fountain' }
const inn = { id: 'inn', title: 'Inn', text: 'a low inn', width: 320, height: 200 }
const entry = { file: 'inn.png', width: 320, height: 200 }

function repo(files: Record<string, unknown> = {}) {
  const root = tempRepo({
    'content-studio.json': projectJson({ images }),
    'tts/act1/images.json': [{ ...inn, areas: [fountain] }],
    [EDITS]: { style: { look: 'pixel', keepOut: 'x', palette: ['#000000'] }, images: {} },
    ...files,
  })
  const read = () => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'))
  const run = async (ids: string[], requireEntry = false) => {
    const opened = await openProject(join(root, 'content-studio.json'))
    if (!opened.ok) throw new Error('project')
    return syncImageAreas(join(root, 'content-studio.json'), opened.project, ids, {
      requireEntry,
    })
  }
  return { root, read, run }
}

describe('syncImageAreas', () => {
  it('writes the placed areas as fractions under the image’s entry', async () => {
    const { run, read } = repo({
      [MANIFEST]: { inn: entry },
      [EDITS]: { images: { inn: { areas: { fountain: box } } } },
    })
    expect(await run(['inn'])).toEqual({ ok: true })
    expect(read()).toEqual({
      inn: { ...entry, areas: { fountain: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } } },
    })
  })

  it('takes areas the game no longer asks for out, and the last one takes the key out', async () => {
    const { run, read } = repo({
      'tts/act1/images.json': [inn],
      [MANIFEST]: { inn: { ...entry, areas: { fountain: { x: 0, y: 0, width: 1, height: 1 } } } },
      [EDITS]: { images: { inn: { areas: { fountain: box } } } },
    })
    expect(await run(['inn'])).toEqual({ ok: true })
    expect(read()).toEqual({ inn: entry })
  })

  it('writes nothing when nothing changes', async () => {
    const { run, root } = repo({ [MANIFEST]: { inn: entry } })
    const file = join(root, MANIFEST)
    chmodSync(file, 0o444)
    chmodSync(join(root, 'web/public/images/generated'), 0o555)
    expect(await run(['inn'])).toEqual({ ok: true })
    chmodSync(join(root, 'web/public/images/generated'), 0o755)
  })

  it('leaves an image with no entry alone, or fails when an entry is required', async () => {
    const { run } = repo({
      [MANIFEST]: {},
      [EDITS]: { images: { inn: { areas: { fountain: box } } } },
    })
    expect(await run(['inn'])).toEqual({ ok: true })
    expect(await run(['inn'], true)).toEqual({
      ok: false,
      reason: 'entry',
      message: 'the image has no entry in the images manifest',
    })
  })

  it('fails with the reason when the manifest cannot be read or written', async () => {
    const broken = repo({ [MANIFEST]: '{ nope' })
    expect(await broken.run(['inn'])).toEqual({
      ok: false,
      reason: 'read',
      message: 'the images manifest could not be read',
    })
    const full = repo({
      [MANIFEST]: { inn: entry },
      [EDITS]: { images: { inn: { areas: { fountain: box } } } },
    })
    chmodSync(join(full.root, 'web/public/images/generated'), 0o555)
    const answer = await full.run(['inn'])
    chmodSync(join(full.root, 'web/public/images/generated'), 0o755)
    expect(answer).toMatchObject({ ok: false, reason: 'write', message: 'permission denied' })
  })

  it('waits for a take being chosen, which writes the same manifest', async () => {
    const { run, read, root } = repo({
      [MANIFEST]: { inn: entry },
      [EDITS]: { images: { inn: { areas: { fountain: box } } } },
    })
    let release: () => void = () => {}
    const held = choices().run(
      `image-choice\0${join(root, 'content-studio.json')}`,
      () => new Promise<void>((resolve) => (release = resolve)),
    )
    const sync = run(['inn'])
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(read().inn.areas).toBeUndefined()
    release()
    await held
    expect(await sync).toEqual({ ok: true })
    expect(read().inn.areas).toBeDefined()
  })

  it('touches only the images it is asked for, and none that lists disagree on', async () => {
    const { run, read } = repo({
      'tts/act1/images.json': [
        { ...inn, areas: [fountain] },
        { ...inn, id: 'hall', title: 'Hall', areas: [fountain] },
      ],
      [MANIFEST]: { inn: entry, hall: { ...entry, file: 'hall.png' } },
      [EDITS]: {
        images: { inn: { areas: { fountain: box } }, hall: { areas: { fountain: box } } },
      },
    })
    await run(['inn'])
    expect(read().inn.areas).toBeDefined()
    expect(read().hall.areas).toBeUndefined()
  })
})

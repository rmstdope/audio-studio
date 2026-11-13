import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { effectModel } from '../core/effectModels'
import { hubDownload } from './hubCache'

describe('hubDownload of the sound-effect model', () => {
  const { repo, needs } = effectModel('small-sfx')
  it('is partial while a file its listing names (the tokenizer) is missing, whole once back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-'))
    const folder = join(dir, 'models--stabilityai--stable-audio-3-small-sfx')
    const snapshot = join(folder, 'snapshots', 'abc')
    mkdirSync(join(folder, 'blobs'), { recursive: true })
    mkdirSync(snapshot, { recursive: true })
    mkdirSync(join(folder, 'refs'))
    mkdirSync(join(folder, 'trees'))
    writeFileSync(join(folder, 'refs', 'main'), 'abc')
    writeFileSync(join(folder, 'blobs', 'h1'), 'w')
    symlinkSync(join('..', '..', 'blobs', 'h1'), join(snapshot, 'model.safetensors'))
    writeFileSync(
      join(folder, 'trees', 'abc.json'),
      JSON.stringify({ files: { 'model.safetensors': {}, 'tokenizer/vocab.json': {} } }),
    )
    expect(hubDownload(dir, repo, needs)).toBe('partial')
    mkdirSync(join(snapshot, 'tokenizer'))
    writeFileSync(join(snapshot, 'tokenizer', 'vocab.json'), '{}')
    expect(hubDownload(dir, repo, needs)).toBe('whole')
  })
})

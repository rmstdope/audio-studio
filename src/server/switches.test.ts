import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Every file under a folder, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

test('the dev stand-in switches carry Content Studio’s name, and no old name is left', () => {
  const old = ['src', 'bin']
    .flatMap(files)
    .filter((f) => /AUDIO_STUDIO_FAKE_/.test(readFileSync(f, 'utf8')))
  // This test file names the old prefix to look for it.
  expect(old.filter((f) => !f.endsWith('switches.test.ts'))).toEqual([])
  const server = readFileSync('src/server/index.ts', 'utf8')
  expect(server).toContain('CONTENT_STUDIO_FAKE_IMAGES')
  expect(server).toContain('CONTENT_STUDIO_FAKE_MUSIC')
})

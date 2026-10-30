import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** Every file under a folder, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

test('the dev stand-in switches carry Content Studio’s name, and no old name is left', () => {
  const old = ['src', 'bin']
    .flatMap((d) => files(join(root, d)))
    .filter((f) => /AUDIO_STUDIO_FAKE_/.test(readFileSync(f, 'utf8')))
  // This test file names the old prefix to look for it.
  expect(old.filter((f) => !f.endsWith('switches.test.ts'))).toEqual([])
  const server = readFileSync(join(root, 'src/server/index.ts'), 'utf8')
  expect(server).toContain("process.env.CONTENT_STUDIO_FAKE_IMAGES === '1'")
  expect(server).toContain("process.env.CONTENT_STUDIO_FAKE_MUSIC === '1'")
})

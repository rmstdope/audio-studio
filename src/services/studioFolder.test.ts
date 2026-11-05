import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRepo } from '../../test/helpers'
import { ensureStudioFolder } from './studioFolder'

describe('ensureStudioFolder', () => {
  it('writes the studio folder’s .gitignore, which keeps the cache out of git', async () => {
    const root = tempRepo({})
    await ensureStudioFolder(root)
    expect(readFileSync(join(root, 'content-studio/.gitignore'), 'utf8')).toBe('cache/\n')
  })

  it('leaves a .gitignore that is there alone', async () => {
    const root = tempRepo({ 'content-studio/.gitignore': 'cache/\n*.bak\n' })
    await ensureStudioFolder(root)
    expect(readFileSync(join(root, 'content-studio/.gitignore'), 'utf8')).toBe('cache/\n*.bak\n')
  })
})

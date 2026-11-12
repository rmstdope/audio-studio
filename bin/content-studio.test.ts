import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../test/helpers'

const CLI = join(import.meta.dir, 'content-studio.ts')

/** Runs the real command in `cwd`; the stop states end before any server starts. */
async function run(cwd: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, CLI, '--no-open', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => child.kill(), 8000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  clearTimeout(timer)
  return { stdout, stderr, code }
}

describe('content-studio without a project file', () => {
  it('says so when there is no project file', async () => {
    const root = tempRepo({ 'README.md': 'x' })
    const { stdout, stderr, code } = await run(root)
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('No content-studio.json in ')
    expect(stderr).toContain(
      'Run content-studio from the game repository that has one, or pass --project <file>.',
    )
  })
})

describe('content-studio on a game', () => {
  it('greets with Content Studio and the project file, and serves', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const child = Bun.spawn([process.execPath, CLI, '--no-open'], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'ignore',
    })
    try {
      const reader = child.stdout.getReader()
      let seen = ''
      while (!seen.includes('Open ')) {
        const { value, done } = await reader.read()
        if (done) break
        seen += new TextDecoder().decode(value)
      }
      expect(seen).toMatch(/^Content Studio: .*content-studio\.json$/m)
    } finally {
      child.kill()
    }
  })

  it('prints help that names the new command and file', async () => {
    const { stdout, code } = await run(tempRepo({}), '--help')
    expect(code).toBe(0)
    expect(stdout.split('\n')[0]).toBe("content-studio: make a game's narration, music and images.")
    expect(stdout).toContain('content-studio.json')
  })
})

/** Starts the real command in `root` and waits for it to serve; returns once it says where. */
async function startedIn(root: string): Promise<() => void> {
  const child = Bun.spawn([process.execPath, CLI, '--no-open'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const reader = child.stdout.getReader()
  let seen = ''
  while (!seen.includes('Open ')) {
    const { value, done } = await reader.read()
    if (done) break
    seen += new TextDecoder().decode(value)
  }
  return () => child.kill()
}

describe('content-studio, the studio folder', () => {
  it('writes content-studio/.gitignore at start, keeping the cache out of git', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const stop = await startedIn(root)
    try {
      expect(readFileSync(join(root, 'content-studio/.gitignore'), 'utf8')).toBe('cache/\n')
    } finally {
      stop()
    }
  })

  it('writes nothing for a project file in the format before version 2', async () => {
    const { version: _version, ...old } = projectJson()
    const root = tempRepo({ 'content-studio.json': old })
    const stop = await startedIn(root)
    try {
      expect(existsSync(join(root, 'content-studio'))).toBe(false)
    } finally {
      stop()
    }
  })
})

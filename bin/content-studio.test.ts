import { describe, expect, it } from 'bun:test'
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

describe('content-studio on a game still set up for Audio Studio', () => {
  it('stops with all three renames, no server', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson(), '.audio-studio/x.json': {} })
    const { stdout, stderr, code } = await run(root)
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toBe(
      [
        'This game is set up for Audio Studio, which is now Content Studio.',
        'Rename these, then run content-studio again:',
        '  git mv audio-studio.json content-studio.json',
        '  mv .audio-studio .content-studio',
        '  in .gitignore, change .audio-studio/ to .content-studio/',
        '',
      ].join('\n'),
    )
  })

  it('stops with the both-files message when both project files exist', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson(),
      'content-studio.json': projectJson(),
    })
    const { stdout, stderr, code } = await run(root)
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toBe(
      'This game has both audio-studio.json and content-studio.json.\n' +
        'Keep one, named content-studio.json, then run content-studio again.\n',
    )
  })

  it('stops with the file rename alone', async () => {
    const root = tempRepo({ 'audio-studio.json': projectJson() })
    const { stdout, stderr, code } = await run(root)
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('Rename this, then run content-studio again:')
    expect(stderr).not.toContain('mv .audio-studio')
  })

  it('stops with the folder rename alone, even with --project', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson(), '.audio-studio/x.json': {} })
    const { stdout, stderr, code } = await run(root, '--project', join(root, 'content-studio.json'))
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).not.toContain('git mv')
    expect(stderr).toContain('  mv .audio-studio .content-studio')
  })

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

describe('content-studio on a game that is renamed', () => {
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

import { describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { gitChanges } from './git'

/** Runs git in a test repository, as a throwaway committer. */
function git(cwd: string, ...args: string[]) {
  const run = Bun.spawnSync(
    ['git', '-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args],
    {
      cwd,
    },
  )
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': { speakers: {}, pronounce: {} },
  'tts/act1/script.json': [{ key: 'a', speaker: 'mira', text: 'Hi.' }],
  'audio/act1/a.mp3': 'clip',
  'notes.txt': 'not the studio’s',
}

describe('gitChanges', () => {
  it('lists the changes to the project’s files only, grouped', async () => {
    const root = tempRepo(files)
    git(root, 'init', '-q')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'start')
    writeFileSync(join(root, 'tts/cast.json'), '{"speakers":{},"pronounce":{"a":"b"}}')
    writeFileSync(join(root, 'tts/act1/cues.json'), '{}')
    writeFileSync(join(root, 'audio/act1/b.mp3'), 'new clip')
    rmSync(join(root, 'audio/act1/a.mp3'))
    writeFileSync(join(root, 'notes.txt'), 'changed, but not the studio’s')

    const result = await gitChanges(join(root, 'audio-studio.json'))
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.groups.total).toBe(4)
    expect(result.groups.project).toEqual([{ path: 'tts/cast.json', change: 'modified' }])
    expect(result.groups.parts).toEqual([
      {
        id: 'act1',
        title: 'Act I',
        files: [{ path: 'tts/act1/cues.json', change: 'new', role: 'cues' }],
        clips: { new: 1, modified: 0, deleted: 1, renamed: 0 },
      },
    ])
  })

  it('gives paths from the project root when it is inside the repository', async () => {
    const top = tempRepo({})
    const root = join(top, 'game')
    mkdirSync(root)
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(
        join(root, path),
        typeof content === 'string' ? content : JSON.stringify(content),
      )
    }
    git(top, 'init', '-q')
    const result = await gitChanges(join(root, 'audio-studio.json'))
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.groups.project.map((c) => c.path)).toEqual(['audio-studio.json', 'tts/cast.json'])
  })

  it('says when the project is not in a git repository', async () => {
    const root = tempRepo(files)
    expect(await gitChanges(join(root, 'audio-studio.json'))).toMatchObject({
      ok: false,
      reason: 'no-git',
    })
  })
})

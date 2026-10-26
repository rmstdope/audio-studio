import { describe, expect, it } from 'bun:test'
import { projectJson } from '../../test/helpers'
import { groupChanges, parsePorcelain, projectPaths } from './changes'
import { ProjectSchema } from './project'

const project = ProjectSchema.parse(projectJson())

describe('parsePorcelain', () => {
  it('reads git status --porcelain -z, renames included', () => {
    const text = [
      ' M tts/cast.json',
      '?? tts/act1/cues.json',
      'A  audio/act1/a.mp3',
      ' D audio/act1/old.mp3',
      'R  audio/act1/new.mp3',
      'audio/act1/was.mp3',
      'MM audio-studio.json',
      '',
    ].join('\0')
    expect(parsePorcelain(text)).toEqual([
      { path: 'tts/cast.json', change: 'modified' },
      { path: 'tts/act1/cues.json', change: 'new' },
      { path: 'audio/act1/a.mp3', change: 'new' },
      { path: 'audio/act1/old.mp3', change: 'deleted' },
      { path: 'audio/act1/new.mp3', change: 'renamed', from: 'audio/act1/was.mp3' },
      { path: 'audio-studio.json', change: 'modified' },
    ])
  })

  it('marks conflicts, and reads a file added then deleted as deleted', () => {
    const text = [
      'UU tts/act1/narration.lock.json',
      'AA tts/cast.json',
      'AD audio/act1/a.mp3',
      '',
    ].join('\0')
    expect(parsePorcelain(text).map((c) => c.change)).toEqual(['conflict', 'conflict', 'deleted'])
  })

  it('gives paths from the project root, renames included', () => {
    const text = [
      'R  game/audio/act1/new.mp3',
      'game/audio/act1/was.mp3',
      ' M game/tts/cast.json',
      '',
    ].join('\0')
    expect(parsePorcelain(text, 'game/')).toEqual([
      { path: 'audio/act1/new.mp3', change: 'renamed', from: 'audio/act1/was.mp3' },
      { path: 'tts/cast.json', change: 'modified' },
    ])
  })

  it('reads nothing as no changes', () => {
    expect(parsePorcelain('')).toEqual([])
  })
})

describe('groupChanges', () => {
  it('puts each changed file with the project, the cast or its part', () => {
    const groups = groupChanges(project, 'audio-studio.json', [
      { path: 'audio-studio.json', change: 'modified' },
      { path: 'tts/cast.json', change: 'modified' },
      { path: 'tts/act1/cues.json', change: 'new' },
      { path: 'tts/act1/narration.lock.json', change: 'modified' },
      { path: 'audio/act1/manifest.json', change: 'modified' },
      { path: 'audio/act1/a.mp3', change: 'new' },
      { path: 'audio/act1/b.mp3', change: 'modified' },
      { path: 'audio/act2/c.mp3', change: 'deleted' },
    ])
    expect(groups.total).toBe(8)
    expect(groups.project.map((c) => c.path)).toEqual(['audio-studio.json', 'tts/cast.json'])
    expect(groups.parts[0]).toMatchObject({
      id: 'act1',
      files: [
        { path: 'tts/act1/cues.json', role: 'cues', change: 'new' },
        { path: 'tts/act1/narration.lock.json', role: 'lock', change: 'modified' },
        { path: 'audio/act1/manifest.json', role: 'manifest', change: 'modified' },
      ],
      clips: { new: 1, modified: 1, deleted: 0, renamed: 0 },
    })
    expect(groups.parts[1]).toMatchObject({ id: 'act2', files: [], clips: { deleted: 1 } })
  })

  it('matches paths written with ./ or doubled slashes in the project file', () => {
    const odd = ProjectSchema.parse(
      projectJson({
        narration: {
          ...(projectJson().narration as object),
          characters: './tts/cast.json',
          paths: {
            ...(projectJson().narration as { paths: object }).paths,
            cues: 'tts//{part}/cues.json',
          },
        },
      }),
    )
    const groups = groupChanges(odd, 'audio-studio.json', [
      { path: 'tts/cast.json', change: 'modified' },
      { path: 'tts/act1/cues.json', change: 'new' },
    ])
    expect(groups.total).toBe(2)
  })

  it('leaves out parts without changes', () => {
    expect(groupChanges(project, 'audio-studio.json', []).parts).toEqual([])
  })
})

describe('projectPaths', () => {
  it('lists the project’s own paths, normalised, each part’s clips as a folder', () => {
    const paths = projectPaths(project, 'audio-studio.json')
    expect(paths.own).toEqual(['audio-studio.json', 'tts/cast.json'])
    expect(paths.parts[0]).toEqual({
      id: 'act1',
      title: 'Act I',
      files: {
        'tts/act1/script.json': 'dialog',
        'tts/act1/cues.json': 'cues',
        'tts/act1/narration.lock.json': 'lock',
        'audio/act1/manifest.json': 'manifest',
      },
      clips: ['audio/act1/'],
    })
  })
})

describe('projectPaths with several languages', () => {
  it('lists every language’s files and clips folder', () => {
    const many = ProjectSchema.parse(
      projectJson({
        narration: {
          ...(projectJson().narration as object),
          languages: ['en', 'sv'],
          paths: {
            dialog: 'tts/{part}/{language}/script.json',
            cues: 'tts/{part}/{language}/cues.json',
            lock: 'tts/{part}/{language}/lock.json',
            clips: 'audio/{part}/{language}',
            manifest: 'audio/{part}/{language}/manifest.json',
          },
        },
      }),
    )
    const part = projectPaths(many, 'audio-studio.json').parts[0]!
    expect(part.clips).toEqual(['audio/act1/en/', 'audio/act1/sv/'])
    expect(Object.keys(part.files)).toContain('tts/act1/sv/script.json')
    expect(Object.keys(part.files)).toHaveLength(8)
  })
})

describe('the music files in the changes', () => {
  const withMusic = ProjectSchema.parse(
    projectJson({
      music: {
        paths: {
          loops: 'tts/{part}/music.json',
          stingers: 'tts/stingers.json',
          briefs: 'music/briefs.json',
          lock: 'music/music.lock.json',
          clips: 'web/audio/music',
          manifest: 'web/audio/music/manifest.json',
        },
      },
    }),
  )

  it('lists the music files by role and counts the music clips', () => {
    const groups = groupChanges(withMusic, 'audio-studio.json', [
      { path: 'tts/act1/music.json', change: 'modified' },
      { path: 'tts/stingers.json', change: 'new' },
      { path: 'music/briefs.json', change: 'modified' },
      { path: 'music/music.lock.json', change: 'modified' },
      { path: 'web/audio/music/manifest.json', change: 'modified' },
      { path: 'web/audio/music/a.mp3', change: 'new' },
      { path: 'web/audio/music/b.mp3', change: 'modified' },
      { path: 'web/audio/music/notes.txt', change: 'new' },
    ])
    expect(groups.total).toBe(7)
    expect(groups.music?.files.map((f) => [f.path, f.role])).toEqual([
      ['tts/act1/music.json', 'list'],
      ['tts/stingers.json', 'list'],
      ['music/briefs.json', 'briefs'],
      ['music/music.lock.json', 'lock'],
      ['web/audio/music/manifest.json', 'manifest'],
    ])
    expect(groups.music?.clips).toMatchObject({ new: 1, modified: 1, deleted: 0 })
  })

  it('does not count the hidden file an encode is writing as a clip', () => {
    const groups = groupChanges(withMusic, 'audio-studio.json', [
      { path: 'web/audio/music/.hall.1234.mp3', change: 'new' },
    ])
    expect(groups.music).toBeNull()
  })

  it('has no music group without changes or without a music section', () => {
    expect(groupChanges(withMusic, 'audio-studio.json', []).music).toBeNull()
    expect(groupChanges(project, 'audio-studio.json', []).music).toBeNull()
  })

  it('names the music paths for git to ask about', () => {
    const paths = projectPaths(withMusic, 'audio-studio.json')
    expect(paths.music?.clips).toBe('web/audio/music/')
    expect(Object.keys(paths.music!.files)).toContain('music/music.lock.json')
    expect(projectPaths(project, 'audio-studio.json').music).toBeNull()
  })
})

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
      clips: 'audio/act1/',
    })
  })
})

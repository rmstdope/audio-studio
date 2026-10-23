import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** A minimal valid project file; override any top-level key. */
export function projectJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Test Game',
    narration: {
      partLabel: 'Act',
      parts: [
        { id: 'act1', title: 'Act I' },
        { id: 'act2', title: 'Act II' },
      ],
      characters: 'tts/cast.json',
      paths: {
        dialog: 'tts/{part}/script.json',
        cues: 'tts/{part}/cues.json',
        lock: 'tts/{part}/narration.lock.json',
        clips: 'audio/{part}',
        manifest: 'audio/{part}/manifest.json',
      },
    },
    ...overrides,
  }
}

/** A temporary consumer repository holding `files` (path → JSON value, or raw text). */
export function tempRepo(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'audio-studio-test-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
  return root
}

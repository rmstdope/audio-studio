import { describe, expect, it } from 'bun:test'
import { pythonJson } from './pyjson'

describe('pythonJson', () => {
  it('writes as Python’s json.dumps(indent=1): floats keep .0, non-ASCII escaped', () => {
    const text = pythonJson({
      k1: {
        file: 'k1.mp3',
        speaker: 'narrator',
        duration: 2,
        words: [
          { word: 'man’s', start: 0, end: 0.48 },
          { word: '…and—😀', start: 1.5, end: 2 },
        ],
      },
    })
    expect(text).toBe(
      '{\n "k1": {\n  "file": "k1.mp3",\n  "speaker": "narrator",\n  "duration": 2.0,\n  "words": [\n' +
        '   {\n    "word": "man\\u2019s",\n    "start": 0.0,\n    "end": 0.48\n   },\n' +
        '   {\n    "word": "\\u2026and\\u2014\\ud83d\\ude00",\n    "start": 1.5,\n    "end": 2.0\n   }\n' +
        '  ]\n }\n}',
    )
  })

  it('writes empty containers and escapes like Python', () => {
    expect(pythonJson({ a: [], b: {}, c: 'tab\there "q" \\ \u007f' })).toBe(
      '{\n "a": [],\n "b": {},\n "c": "tab\\there \\"q\\" \\\\ \\u007f"\n}',
    )
  })
})

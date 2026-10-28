import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeEleven, projectJson, tempRepo } from '../../test/helpers'
import type { Voice } from '../core/voiceSearch'
import { ELEVEN_VOICES_FILE, readAddedVoices, voiceToSpeak } from './elevenVoices'

/** Gravel, a voice of ElevenLabs' library. */
const gravel: Voice = {
  id: 'eleven:lib1',
  title: 'Gravel',
  description: '',
  tags: [],
  languages: ['en'],
  uses: 10,
  likes: 0,
  author: '',
  sample: null,
  library: { owner: 'owner1', added: false },
}

/** A project, and a client that adds library voices as `own-<id>`, counting what it added. */
function setUp() {
  const root = tempRepo({ 'audio-studio.json': projectJson() })
  const projectFile = join(root, 'audio-studio.json')
  const { client } = fakeEleven()
  const added: string[] = []
  client.addSharedVoice = async (owner, id, name) => {
    added.push(`${owner}/${id}/${name}`)
    return `own-${id}`
  }
  return { root, projectFile, client, added }
}

describe('voiceToSpeak', () => {
  it('adds a library voice on its first use, remembers it, and adds it once', async () => {
    const { root, projectFile, client, added } = setUp()
    const at = new Date('2026-10-28T10:00:00.000Z')
    const [first, second] = await Promise.all([
      voiceToSpeak(projectFile, async () => client, gravel, 'wizard', at),
      voiceToSpeak(projectFile, async () => client, gravel, 'wizard', at),
    ])
    expect([first, second]).toEqual(['eleven:own-lib1', 'eleven:own-lib1'])
    expect(await voiceToSpeak(projectFile, async () => client, gravel, 'witch')).toBe(
      'eleven:own-lib1',
    )
    expect(added).toEqual(['owner1/lib1/Gravel'])
    expect(await readAddedVoices(projectFile)).toEqual({
      version: 1,
      added: [
        {
          library: 'eleven:lib1',
          voice: 'eleven:own-lib1',
          name: 'Gravel',
          character: 'wizard',
          at: '2026-10-28T10:00:00.000Z',
        },
      ],
    })
    expect(readFileSync(join(root, ELEVEN_VOICES_FILE), 'utf8')).toEndWith('\n')
  })

  it('adds nothing for a voice of the user’s own, or a library voice the user added already', async () => {
    const { projectFile, client, added } = setUp()
    const { library: _, ...own } = gravel
    expect(await voiceToSpeak(projectFile, async () => client, own, 'wizard')).toBe('eleven:lib1')
    expect(
      await voiceToSpeak(
        projectFile,
        async () => client,
        { ...gravel, library: { owner: 'owner1', added: true } },
        'wizard',
      ),
    ).toBe('eleven:lib1')
    expect(added).toEqual([])
    expect(await readAddedVoices(projectFile)).toEqual({ version: 1, added: [] })
  })

  it('speaks a voice it added as the voice it became, also once ElevenLabs says it is added', async () => {
    const { projectFile, client, added } = setUp()
    await voiceToSpeak(projectFile, async () => client, gravel, 'wizard')
    const later = { ...gravel, library: { owner: 'owner1', added: true } }
    expect(await voiceToSpeak(projectFile, async () => null, later, 'witch')).toBe(
      'eleven:own-lib1',
    )
    expect(added).toHaveLength(1)
  })

  it('needs the client only to add a voice, and says so without it', async () => {
    const { projectFile } = setUp()
    const { library: _, ...own } = gravel
    expect(await voiceToSpeak(projectFile, async () => null, own, 'wizard')).toBe('eleven:lib1')
    await expect(voiceToSpeak(projectFile, async () => null, gravel, 'wizard')).rejects.toThrow(
      'ELEVENLABS_API_KEY',
    )
  })

  it('remembers nothing when ElevenLabs will not add it', async () => {
    const { projectFile, client } = setUp()
    client.addSharedVoice = () =>
      Promise.reject(new Error('ElevenLabs answered 400: You have reached your voice limit.'))
    await expect(voiceToSpeak(projectFile, async () => client, gravel, 'wizard')).rejects.toThrow(
      'voice limit',
    )
    expect(await readAddedVoices(projectFile)).toEqual({ version: 1, added: [] })
  })
})

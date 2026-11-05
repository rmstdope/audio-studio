import type { SceneAudio } from './sceneLoudness'

/** The real audio of the Scenes page: ffmpeg's measure of a mix (written next). */
export function ffmpegSceneAudio(): SceneAudio {
  return {
    seconds: async () => {
      throw new Error('not built')
    },
    loudness: async () => {
      throw new Error('not built')
    },
  }
}

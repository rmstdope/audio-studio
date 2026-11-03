/** An audio element that plays at once, five seconds into a ten-second clip. */
class FakeAudio {
  src = ''
  loop = false
  currentTime = 0
  duration = 10
  volume = 1
  paused = true
  play() {
    this.paused = false
    this.currentTime = 5
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  addEventListener() {}
  removeEventListener() {}
}

/** What the fake Web Audio context was asked to start. */
export const started: { loop: boolean }[] = []

/** A Web Audio context that plays a ten-second clip, recording each source it starts. */
class FakeContext {
  currentTime = 5
  destination = {}
  async decodeAudioData() {
    return { duration: 10 }
  }
  createBufferSource() {
    const source = {
      buffer: null,
      loop: false,
      onended: null,
      connect: (node: unknown) => node,
      start: () => started.push({ loop: source.loop }),
      stop() {},
    }
    return source
  }
  createGain() {
    return { gain: { value: 1 }, connect: (node: unknown) => node }
  }
}

/**
 * Puts a fake `Audio` and `AudioContext` in place of the browser's, which the test DOM lacks, and
 * clears `started`; returns what puts the real ones back.
 */
export function installFakeWebAudio(): () => void {
  const realAudio = globalThis.Audio
  const realContext = globalThis.AudioContext
  globalThis.Audio = FakeAudio as unknown as typeof Audio
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext
  started.length = 0
  return () => {
    globalThis.Audio = realAudio
    globalThis.AudioContext = realContext
  }
}

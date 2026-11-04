// A stand-in for the studio with one local generator running: it starts a worker the way the
// studio does (a line worker, or an image take) whose command leaves a child of its own running,
// as `uv run` leaves python, and waits to be stopped. Used by stopWithStudio.test.ts.
import { createLineWorker } from '../../src/services/lineWorker'
import { createMfluxGenerator } from '../../src/services/images'

const [kind, pidFile] = process.argv.slice(2)
const command = ['sh', '-c', `sleep 60 & echo $! > '${pidFile}'; wait`]

if (kind === 'line') {
  const worker = createLineWorker({
    name: 'The fake',
    command,
    timeoutMs: 60_000,
    couldNotStart: (why) => why,
  })
  worker.request({}).catch(() => {})
} else {
  createMfluxGenerator({ build: (c) => ({ command, out: c.out }), log: () => {} })
    .generate({ prompt: 'a room', width: 1024, height: 576, seed: 42, model: 'klein' })
    .catch(() => {})
}
setInterval(() => {}, 1000)

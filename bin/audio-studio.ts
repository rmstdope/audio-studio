#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { PROJECT_FILE } from '../src/core/project'
import { startServer } from '../src/server/index'
import { findProjectFile, projectFileProblem } from '../src/services/workspace'

const HELP = `audio-studio: cast and record a game's narration.

Run it from inside a game repository that has an ${PROJECT_FILE}.

Options:
  --project <file>  use this project file instead of looking for ${PROJECT_FILE}
  --port <number>   port to listen on (default: a free one)
  --no-open         do not open the browser
  --dev             reload on changes to the studio's own code (server and UI)
  -h, --help        show this help`

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    port: { type: 'string', default: '0' },
    'no-open': { type: 'boolean', default: false },
    dev: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help) {
  console.log(HELP)
  process.exit(0)
}

// --dev runs the studio under `bun --hot`, which reruns this module when the studio's code
// changes and keeps the same server and port. Start that process, and pass on its exit.
if (values.dev && !process.execArgv.includes('--hot')) {
  const child = Bun.spawn([process.execPath, '--hot', import.meta.path, ...process.argv.slice(2)], {
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  process.exit(await child.exited)
}

const projectFile = values.project ? resolve(values.project) : findProjectFile(process.cwd())
if (!projectFile) {
  console.error(
    `No ${PROJECT_FILE} in ${process.cwd()} or any folder above it.\n` +
      `Run audio-studio from the game repository that has one, or pass --project <file>.`,
  )
  process.exit(1)
}
const problem = projectFileProblem(projectFile)
if (problem) {
  console.error(problem)
  process.exit(1)
}

const port = Number(values.port)
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`--port must be a number from 0 to 65535, not ${values.port}.`)
  process.exit(1)
}

const server = startServer({ projectFile, port, development: values.dev })

// Under --hot this module reruns on every change; greet and open the browser only once.
const state = globalThis as { audioStudioStarted?: boolean }
if (state.audioStudioStarted) {
  console.log('Reloaded.')
} else {
  state.audioStudioStarted = true
  console.log(`Audio Studio: ${projectFile}`)
  console.log(`Open ${server.url}  (Ctrl+C to stop)${values.dev ? '  · reloading on changes' : ''}`)
  if (!values['no-open']) openBrowser(server.url.href)
}

function openBrowser(url: string) {
  const command =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  try {
    Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' })
  } catch {
    // No browser launcher: the URL above is printed for the user to open.
  }
}

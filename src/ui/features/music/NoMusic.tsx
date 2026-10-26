import { useState } from 'react'

/** The example `music` section the page shows under "How to set it up". */
const EXAMPLE = `"music": {
  "refreshShared": "node tts/extract-shared.js",
  "paths": {
    "loops": "tts/{part}/music.json",
    "stingers": "tts/stingers.json",
    "briefs": "music/briefs.json",
    "lock": "music/music.lock.json",
    "clips": "web/public/audio/music/generated",
    "manifest": "web/public/audio/music/generated/manifest.json"
  }
}`

/** Music in a project whose file has no `music` section: what to add, with an example. */
export function NoMusic() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Music</span>
          <h1>Music</h1>
        </div>
      </header>
      <section className="panel no-music">
        <strong>This project has no music yet</strong>
        <span>
          Add a <span className="mono">music</span> section to{' '}
          <span className="mono">audio-studio.json</span> to say where the game lists its tracks and
          where their files go, then reload.
        </span>
        <button className="btn" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          How to set it up
        </button>
        {open && <pre className="refresh-output mono music-example">{EXAMPLE}</pre>}
      </section>
    </>
  )
}

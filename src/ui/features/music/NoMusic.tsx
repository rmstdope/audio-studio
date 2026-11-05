import { useState } from 'react'

/** The example `music` section the page shows under "How to set it up". */
const EXAMPLE = `"music": {
  "from": { "part": "tts/{part}/music.json", "shared": "tts/stingers.json" },
  "clips": "web/public/audio/music/generated",
  "manifest": "web/public/audio/music/generated/manifest.json"
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
          <span className="mono">content-studio.json</span> to say where the game lists its tracks
          and where their files go, then reload.
        </span>
        <button className="btn" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          How to set it up
        </button>
        {open && <pre className="refresh-output mono music-example">{EXAMPLE}</pre>}
      </section>
    </>
  )
}

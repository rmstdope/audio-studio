import { useState } from 'react'

/** The example `scenes` section the page shows under "How to set it up". */
const EXAMPLE = `"scenes": {
  "from": { "part": "tts/{part}/scenes.json" },
  "mix": "web/src/lantern/scenes/{part}.mix.json"
}`

/** Scenes in a project whose file has no `scenes` section: what to add, with an example. */
export function NoScenes() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Scenes</h1>
        </div>
      </header>
      <section className="panel no-music">
        <strong>This project has no scenes yet</strong>
        <span>
          Add a <span className="mono">scenes</span> section to{' '}
          <span className="mono">content-studio.json</span> to say where the game lists its scenes
          and where their mix goes, then reload.
        </span>
        <button className="btn" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          How to set it up
        </button>
        {open && <pre className="refresh-output mono music-example">{EXAMPLE}</pre>}
      </section>
    </>
  )
}

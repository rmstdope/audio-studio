import { useState } from 'react'

/** The example `effects` section the page shows under "How to set it up". */
const EXAMPLE = `"effects": {
  "from": { "shared": "tts/effects.json" },
  "clips": "web/public/audio/effects",
  "manifest": "web/public/audio/effects/manifest.json"
}`

/** Sound effects in a project whose file has no `effects` section: what to add, with an example. */
export function NoEffects() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Sound effects</span>
          <h1>Sound effects</h1>
        </div>
      </header>
      <section className="panel no-music">
        <strong>This project has no sound effects yet</strong>
        <span>
          Add an <span className="mono">effects</span> section to{' '}
          <span className="mono">content-studio.json</span> to say where the game lists its sound
          effects, then reload.
        </span>
        <button className="btn" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          How to set it up
        </button>
        {open && <pre className="refresh-output mono music-example">{EXAMPLE}</pre>}
      </section>
    </>
  )
}

import { useState } from 'react'

/** The example `images` section the page shows under "How to set it up". */
const EXAMPLE = `"images": {
  "paths": {
    "list": "tts/{part}/images.json",
    "style": "images/style.json",
    "prompts": "images/prompts.json",
    "lock": "images/images.lock.json"
  }
}`

/** Images in a project whose file has no `images` section: what to add, with an example. */
export function NoImages() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Images</h1>
        </div>
      </header>
      <section className="panel no-music">
        <strong>This project has no images yet</strong>
        <span>
          Add an <span className="mono">images</span> section to{' '}
          <span className="mono">audio-studio.json</span> to say where the game lists its images and
          its style, then reload.
        </span>
        <button className="btn" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          How to set it up
        </button>
        {open && <pre className="refresh-output mono music-example">{EXAMPLE}</pre>}
      </section>
    </>
  )
}

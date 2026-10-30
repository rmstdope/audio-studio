import { useState } from 'react'
import type { ImagesSummary } from '../../../core/images'
import { useSetStyleField } from '../../api'
import { paletteText } from '../../imagesText'
import { WordsField } from './WordsField'

/** The Style page: the look and what is kept out (editable here), the palette and the acts' additions (the game's). */
export function StylePage({ images }: { images: ImagesSummary }) {
  const { style } = images
  const [saved, setSaved] = useState(false)
  const look = useSetStyleField('look')
  const keepOut = useSetStyleField('keepOut')
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Images</span>
          <h1 tabIndex={-1}>Style</h1>
          <span className="muted">
            Added to every image&apos;s prompt. From the game&apos;s style file; your changes stay
            in the studio.
          </span>
        </div>
      </header>
      {!style.present ? (
        <section className="panel no-music">
          <strong>The game has no style file yet</strong>
          <span>
            Until it has one, each image&apos;s prompt is only its own words. Images made before the
            style arrives go out of date when it does.
          </span>
        </section>
      ) : (
        <>
          <section className="panel brief-panel">
            <div className="brief-panel-head">
              <h2>Style</h2>
              {saved && (
                <span className="saved" role="status">
                  Saved
                </span>
              )}
            </div>
            <WordsField
              label="The look"
              words={style.look.words}
              changed={style.look.changed}
              save={look}
              onSaved={() => setSaved(true)}
              onEdit={() => setSaved(false)}
            />
            <WordsField
              label="Kept out of every image"
              words={style.keepOut.words}
              changed={style.keepOut.changed}
              save={keepOut}
              onSaved={() => setSaved(true)}
              onEdit={() => setSaved(false)}
            />
            <div className="brief-field">
              <span className="label">Palette</span>
              <div className="images-palette">
                {style.palette.map((colour, index) => (
                  <span
                    key={`${colour}-${index}`}
                    className="images-swatch"
                    style={{ background: colour }}
                    title={colour}
                    role="img"
                    aria-label={colour}
                  />
                ))}
                <span className="muted">{paletteText(style.palette.length)}</span>
              </div>
            </div>
          </section>
          <section className="panel">
            <h2>Added per act</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Act</th>
                  <th>Added to its images</th>
                </tr>
              </thead>
              <tbody>
                {style.acts.map((act) => (
                  <tr key={act.id}>
                    <td>{act.title}</td>
                    <td>{act.addition ?? <span className="images-nothing">nothing</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">Set by the game.</p>
          </section>
        </>
      )}
    </>
  )
}

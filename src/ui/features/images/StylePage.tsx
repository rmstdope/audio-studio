import { useState } from 'react'
import type { ImagesSummary } from '../../../core/images'
import { useSetStyleField } from '../../api'
import { paletteText } from '../../imagesText'
import { WordsField } from './WordsField'

/** The Style page: the look and what is kept out (editable here), the palette and the acts' additions (in the edits file). */
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
            Added to every image&apos;s prompt. The studio&apos;s own: change the look and what is
            kept out here.
          </span>
        </div>
      </header>
      {style.invalid ? (
        <section className="panel no-music">
          <strong>The style cannot be read</strong>
          <span>
            See the problems above. Until it can be, each image&apos;s prompt is only its own words.
          </span>
        </section>
      ) : !style.present ? (
        <section className="panel no-music">
          <strong>There is no style yet</strong>
          <span>
            Add one under <span className="mono">style</span> in{' '}
            <span className="mono">content-studio/images/edits.json</span>. Until then, each
            image&apos;s prompt is only its own words. Images made before the style arrives go out
            of date when it does.
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
              words={style.look}
              save={look}
              onSaved={() => setSaved(true)}
              onEdit={() => setSaved(false)}
            />
            <WordsField
              label="Kept out of every image"
              words={style.keepOut}
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
            <p className="muted">
              The palette and the additions per act are changed in{' '}
              <span className="mono">content-studio/images/edits.json</span>.
            </p>
          </section>
        </>
      )}
    </>
  )
}

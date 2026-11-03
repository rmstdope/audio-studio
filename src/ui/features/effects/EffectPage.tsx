import { useState } from 'react'
import { effectSeconds, type EffectRow, type EffectsSummary } from '../../../core/effects'
import { useKeepMineEffect, useSetEffectDescription } from '../../api'
import { Failure } from '../../components/Failure'
import { WordsField } from '../images/WordsField'
import { routeHref } from '../../route'

const BACK = routeHref({ view: 'effects', page: null })

/** One sound effect's page: its description (the studio's over the game's), its length and its takes. */
export function EffectPage({ effects, id }: { effects: EffectsSummary; id: string }) {
  const row = effects.rows.find((r) => r.id === id)
  if (!row) return <Gone id={id} />
  return <Found row={row} />
}

/** An old link to an effect the game no longer lists. */
function Gone({ id }: { id: string }) {
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">
            <a href={BACK}>Sound effects</a> ›
          </span>
          <h1 tabIndex={-1}>{id}</h1>
        </div>
      </header>
      <section className="panel no-music">
        <strong>The game no longer lists this sound effect.</strong>
        <a href={BACK}>Back to Sound effects</a>
      </section>
    </>
  )
}

function Found({ row }: { row: EffectRow }) {
  const field = useSetEffectDescription(row.id)
  const save = useSetEffectDescription(row.id)
  const keep = useKeepMineEffect(row.id)
  const [saved, setSaved] = useState(false)
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">
            <a href={BACK}>Sound effects</a> ›
          </span>
          <h1 tabIndex={-1}>{row.name}</h1>
          <span className="mono muted">{row.id}</span>
        </div>
      </header>
      {row.gameChanged && (
        <section className="notice notice-warn" aria-label="The game's description changed">
          <div className="notice-text">
            <strong>The game&apos;s description changed since you changed yours.</strong>
            <span className="muted">
              Yours is still the one used. The game&apos;s now says: {row.gameDescription}
            </span>
          </div>
          <div className="notice-actions">
            <Failure title="The description could not be changed" result={save.data ?? keep.data} />
            {(save.error ?? keep.error) && (
              <span className="adopt-error">{(save.error ?? keep.error)!.message}</span>
            )}
            <button
              className="btn"
              type="button"
              disabled={save.isPending || keep.isPending}
              onClick={() => save.mutate(null)}
            >
              Use the game&apos;s
            </button>
            <button
              className="btn"
              type="button"
              disabled={save.isPending || keep.isPending}
              onClick={() => keep.mutate()}
            >
              Keep mine
            </button>
          </div>
        </section>
      )}
      <section className="panel" aria-label="Description">
        <h2 className="section-title">
          Description {saved && <span className="field-tag">Saved</span>}
        </h2>
        <WordsField
          label="What it should sound like"
          words={row.description}
          changed={row.changedHere}
          save={field}
          failTitle="The description could not be saved"
          onEdit={() => setSaved(false)}
          onSaved={() => setSaved(true)}
        />
        {row.changedHere && <span className="muted">The game&apos;s: {row.gameDescription}</span>}
        <div className="effects-length-line">
          <span className="label">Length</span>
          <span>{effectSeconds(row.seconds)} · set by the game</span>
        </div>
      </section>
      <section className="panel" aria-label="Takes">
        <h2 className="section-title">Takes</h2>
        <span className="muted">Making takes comes in a later step.</span>
      </section>
    </>
  )
}

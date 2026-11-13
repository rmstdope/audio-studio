import { useRef, useState } from 'react'
import type { EffectRow, EffectsSummary } from '../../../core/effects'
import { useKeepMineEffect, useSetEffectDescription } from '../../api'
import { Failure } from '../../components/Failure'
import type { PagerProps } from '../../components/Pager'
import { PageHeader } from '../../components/PageHeader'
import { pagerFor } from '../../pager'
import { WordsField, type SaveWordsNow } from '../images/WordsField'
import { EFFECTS_PENDING, effectLengthLine } from '../../effectsText'
import { off } from '../../off'
import { routeHref } from '../../route'
import { EffectTakesPanel } from './EffectTakesPanel'

const BACK = routeHref({ view: 'effects', page: null })

/** One sound effect's page: its description (the studio's over the game's), its length and its takes. */
export function EffectPage({ effects, id }: { effects: EffectsSummary; id: string }) {
  const row = effects.rows.find((r) => r.id === id)
  if (!row) return <Gone id={id} />
  const pager = pagerFor(effects.rows, id, (r) => ({
    name: r.name,
    href: routeHref({ view: 'effects', page: 'effect', effect: r.id }),
  }))
  return <Found row={row} pager={pager} />
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

function Found({ row, pager }: { row: EffectRow; pager: PagerProps | null }) {
  const field = useSetEffectDescription(row.id)
  const save = useSetEffectDescription(row.id)
  const keep = useKeepMineEffect(row.id)
  const [saved, setSaved] = useState(false)
  const saveNow = useRef<SaveWordsNow>(null)
  return (
    <>
      <PageHeader
        title={
          <>
            <span className="crumbs">
              <a href={BACK}>Sound effects</a> ›
            </span>
            <h1 tabIndex={-1}>{row.name}</h1>
            <span className="mono muted">{row.id}</span>
          </>
        }
        pager={pager}
      />
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
              {...off((save.isPending || keep.isPending) && EFFECTS_PENDING)}
              onClick={() => save.mutate(null)}
            >
              Use the game&apos;s
            </button>
            <button
              className="btn"
              type="button"
              {...off((save.isPending || keep.isPending) && EFFECTS_PENDING)}
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
          saveNow={saveNow}
        />
        {row.changedHere && <span className="muted">The game&apos;s: {row.gameDescription}</span>}
        <div className="effects-length-line">
          <span className="label">Length</span>
          <span>{effectLengthLine(row.seconds, row.loops)}</span>
        </div>
      </section>
      <EffectTakesPanel
        key={`takes-${row.id}`}
        row={row}
        saveWords={() => saveNow.current?.() ?? null}
      />
    </>
  )
}

import { useState } from 'react'
import { retiringTakes } from '../core/retirement'
import { useProject } from './api'
import { Problems } from './components/Problems'
import { RetirementNotice } from './components/RetirementNotice'
import { Sidebar } from './components/Sidebar'
import { AuditionView } from './features/audition/AuditionView'
import { ChangesView } from './features/changes/ChangesView'
import { CharacterView } from './features/characters/CharacterView'
import { CharactersView } from './features/characters/CharactersView'
import { LinesView } from './features/lines/LinesView'
import { PartOverview } from './features/overview/PartOverview'
import { SetupView } from './features/setup/SetupView'
import { useRoute } from './route'

/** The studio: loads the project and shows the page for the current route. */
export function App() {
  const project = useProject()
  const route = useRoute()
  // Not now: kept here, so it lasts across pages and is gone when the page is opened again.
  const [notNow, setNotNow] = useState(false)

  if (project.isPending) {
    return <div className="center-page muted">Opening project…</div>
  }
  if (project.isError) {
    return (
      <div className="center-page">
        <div className="empty-state">
          <strong>The studio server did not answer</strong>
          <span>
            Is <span className="mono">audio-studio</span> still running in the terminal?{' '}
            {project.error.message}
          </span>
          <button className="btn" style={{ alignSelf: 'center' }} onClick={() => project.refetch()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  const result = project.data
  if (!result.ok) {
    return (
      <div className="center-page">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Problems title="The project file needs fixing" problems={result.problems} fatal />
          <span className="muted">
            Fix <span className="mono">{result.file}</span> and come back: the studio reads it again
            when this window regains focus.
          </span>
          <button className="btn" onClick={() => project.refetch()}>
            Check again
          </button>
        </div>
      </div>
    )
  }

  const { summary } = result
  const retiring = retiringTakes(summary.models)
  const requested = route.view === 'part' || route.view === 'lines' ? route.part : null
  const part =
    summary.parts.find((p) => p.id === requested) ??
    summary.parts.find((p) => p.dialog === 'ok') ??
    summary.parts[0]!

  return (
    <div className="shell">
      <Sidebar summary={summary} route={route} activePart={part.id} />
      <main className="content">
        {!notNow && (
          <RetirementNotice
            takes={retiring}
            file={summary.projectFile}
            now={new Date()}
            onNotNow={() => setNotNow(true)}
          />
        )}
        {summary.problems.length > 0 && (
          <Problems title="Some files could not be read" problems={summary.problems} />
        )}
        {route.view === 'changes' ? (
          <ChangesView summary={summary} />
        ) : route.view === 'setup' ? (
          <SetupView />
        ) : route.view === 'characters' ? (
          <CharactersView summary={summary} asked={route.language} />
        ) : route.view === 'character' ? (
          <CharacterView
            key={route.character}
            summary={summary}
            characterId={route.character}
            asked={route.language}
          />
        ) : route.view === 'audition' ? (
          <AuditionView
            key={route.character}
            summary={summary}
            characterId={route.character}
            asked={route.language}
          />
        ) : route.view === 'lines' ? (
          <LinesView key={part.id} summary={summary} part={part} language={route.language} />
        ) : (
          <PartOverview
            key={part.id}
            summary={summary}
            part={part}
            language={route.view === 'part' ? route.language : undefined}
          />
        )}
      </main>
    </div>
  )
}

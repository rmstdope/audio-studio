import type { ProjectSummary } from '../../core/summary'
import { routeHref, type Route } from '../route'
import { MicIcon, MusicIcon, PeopleIcon, SpeakerIcon, WaveIcon } from './icons'
import { longTitle, plural } from '../format'

/** The studio's navigation: project, workspaces, the parts, and the project-wide characters. */
export function Sidebar({
  summary,
  route,
  activePart,
}: {
  summary: ProjectSummary
  route: Route
  activePart: string | null
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <WaveIcon size={18} />
        </div>
        <span className="brand-name">Audio Studio</span>
      </div>

      <div className="project-box">
        <span className="label">Project</span>
        <strong>{summary.name}</strong>
        <span className="mono muted project-path" title={summary.root}>
          {summary.root.split(/[\\/]/).filter(Boolean).pop()}
        </span>
      </div>

      <nav className="nav" aria-label="Workspaces">
        <span className="label">Workspace</span>
        <a
          className="nav-item"
          href={routeHref({ view: 'part', part: activePart })}
          aria-current="page"
        >
          <MicIcon /> Narration
        </a>
        <span className="nav-item" aria-disabled="true">
          <MusicIcon /> <span className="grow">Music</span> <span className="meta">Soon</span>
        </span>
        <span className="nav-item" aria-disabled="true">
          <SpeakerIcon /> <span className="grow">Sound effects</span>{' '}
          <span className="meta">Soon</span>
        </span>
      </nav>

      <nav className="nav" aria-label={`${summary.partLabel}s`}>
        <span className="label">{summary.partLabel}s</span>
        {summary.parts.map((part, index) => (
          <a
            key={part.id}
            className="nav-item"
            href={routeHref({ view: 'part', part: part.id })}
            aria-current={
              (route.view === 'part' || route.view === 'lines') && activePart === part.id
                ? 'page'
                : undefined
            }
          >
            <span className="num">{index + 1}</span>
            <span className="grow">{longTitle(part.title)}</span>
            <span className="meta">
              {part.dialog === 'ok'
                ? plural(part.lineCount, 'line')
                : part.dialog === 'missing'
                  ? 'no script'
                  : 'invalid'}
            </span>
          </a>
        ))}
      </nav>

      <nav className="nav sidebar-foot" aria-label="Project">
        <a
          className="nav-item"
          href={routeHref({ view: 'characters' })}
          aria-current={
            route.view === 'characters' || route.view === 'audition' ? 'page' : undefined
          }
        >
          <PeopleIcon /> <span className="grow">All characters</span>
          <span className="meta">{summary.characters.length}</span>
        </a>
      </nav>
    </aside>
  )
}

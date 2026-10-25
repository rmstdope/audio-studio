import type { ProjectSummary } from '../../core/summary'
import { useChanges, useCredit, useSetup, useSpending } from '../api'
import { routeHref, type Route } from '../route'
import {
  MicIcon,
  MusicIcon,
  PeopleIcon,
  SpeakerIcon,
  WaveIcon,
  ChangesIcon,
  SpendingIcon,
  CheckIcon,
} from './icons'
import { dollars, longTitle, plural } from '../format'

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
  const changes = useChanges()
  const credit = useCredit()
  const setup = useSetup()
  const spending = useSpending()
  const problems = setup.data?.ok
    ? setup.data.checks.filter((c) => c.state === 'problem').length
    : 0
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
        {credit.data?.ok ? (
          <span className="muted project-credit" title="Fish Audio API credit">
            {dollars(credit.data.credit)} credit for paid models
          </span>
        ) : credit.data?.reason === 'fish' ? (
          <span className="muted project-credit" title={credit.data.message}>
            Credit unknown: Fish did not answer
          </span>
        ) : null}
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
            href={routeHref({
              view: 'part',
              part: part.id,
              language:
                route.view === 'part' || route.view === 'lines' ? route.language : undefined,
            })}
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
            route.view === 'characters' || route.view === 'character' || route.view === 'audition'
              ? 'page'
              : undefined
          }
        >
          <PeopleIcon /> <span className="grow">All characters</span>
          <span className="meta">{summary.characters.length}</span>
        </a>
        <a
          className="nav-item"
          href={routeHref({ view: 'changes' })}
          aria-current={route.view === 'changes' ? 'page' : undefined}
        >
          <ChangesIcon /> <span className="grow">Changes</span>
          {changes.data?.ok && <span className="meta">{changes.data.groups.total}</span>}
        </a>
        <a
          className="nav-item"
          href={routeHref({ view: 'spending' })}
          aria-current={route.view === 'spending' ? 'page' : undefined}
        >
          <SpendingIcon /> <span className="grow">Spending</span>
          {spending.data?.ok && spending.data.count > 0 && (
            <span className="meta">{dollars(spending.data.total)}</span>
          )}
        </a>
        <a
          className="nav-item"
          href={routeHref({ view: 'setup' })}
          aria-current={route.view === 'setup' ? 'page' : undefined}
        >
          <CheckIcon /> <span className="grow">Setup</span>
          {problems > 0 && (
            <span className="meta setup-problems" title={plural(problems, 'thing') + ' to fix'}>
              {problems}
            </span>
          )}
        </a>
      </nav>
    </aside>
  )
}

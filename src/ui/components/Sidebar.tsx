import type { ProjectSummary } from '../../core/summary'
import { useChanges, useCredit, useNarrationProgress, useSetup, useSpending } from '../api'
import { currentAct } from '../imagesText'
import { listFor } from '../musicText'
import { routeHref, type Route } from '../route'
import {
  ImageIcon,
  MicIcon,
  MusicIcon,
  PeopleIcon,
  SpeakerIcon,
  LayersIcon,
  ChangesIcon,
  SpendingIcon,
  CheckIcon,
} from './icons'
import { dollars, plural, shortTitle } from '../format'
import { amountText } from '../spending'
import { actCount, doneCount, openWorkspace, type DoneTone } from '../sidebarActs'
import { imagesDone } from '../../core/images'
import { tracksDone } from '../../core/musicChoose'

/** The class of a count at the right of a sidebar entry, coloured by how much is done. */
function metaClass(tone: DoneTone, warn = false): string {
  if (warn) return 'meta meta-warn'
  return tone ? `meta meta-done-${tone}` : 'meta'
}

/** The studio's navigation: project, the workspaces with the open one's acts, and the project-wide pages. */
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
  const open = openWorkspace(route)
  const language = route.view === 'part' || route.view === 'lines' ? route.language : undefined
  const progress = useNarrationProgress(language, open === 'narration')
  const done = progress.data?.ok ? progress.data.parts : {}
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <LayersIcon size={18} />
        </div>
        <span className="brand-name">Content Studio</span>
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
        <a className="nav-item nav-workspace" href={routeHref({ view: 'part', part: activePart })}>
          <MicIcon /> Narration
        </a>
        {open === 'narration' &&
          summary.parts.map((part) => {
            const count = actCount(part, done[part.id])
            return (
              <a
                key={part.id}
                className="nav-item music-subnav"
                title={part.title}
                href={routeHref({
                  view: 'part',
                  part: part.id,
                  language:
                    route.view === 'part' || route.view === 'lines' ? route.language : undefined,
                })}
                aria-current={activePart === part.id ? 'page' : undefined}
              >
                <span className="grow">{shortTitle(part.title)}</span>
                <span
                  className={metaClass(count.tone, count.warn)}
                  title={done[part.id] ? 'Lines that are ok, out of all' : undefined}
                >
                  {count.text}
                </span>
              </a>
            )
          })}
        <a
          className="nav-item nav-workspace"
          href={routeHref({ view: 'music', page: null })}
          aria-current={route.view === 'music' && !summary.music ? 'page' : undefined}
        >
          <MusicIcon /> <span className="grow">Music</span>
        </a>
        {open === 'music' &&
          summary.music?.lists.map((list) => {
            const current = route.view === 'music' && listFor(summary.music!.lists, route) === list
            return (
              <a
                key={`${list.kind}:${list.id}`}
                className="nav-item music-subnav"
                href={routeHref(
                  list.kind === 'stingers'
                    ? { view: 'music', page: 'stingers' }
                    : { view: 'music', page: 'act', part: list.id },
                )}
                aria-current={current ? 'page' : undefined}
              >
                <span className="grow">
                  {list.kind === 'stingers' ? 'Stingers' : shortTitle(list.title)}
                </span>
                {list.state === 'ok' && (
                  <DoneCount
                    count={doneCount(tracksDone(list.tracks))}
                    title="Tracks with a take chosen and up to date, out of all"
                  />
                )}
              </a>
            )
          })}
        <a
          className="nav-item nav-workspace"
          href={routeHref({ view: 'images', page: null })}
          aria-current={route.view === 'images' && !summary.images ? 'page' : undefined}
        >
          <ImageIcon /> <span className="grow">Images</span>
        </a>
        {open === 'images' && summary.images && (
          <>
            {summary.images.acts.map((act) => (
              <a
                key={act.id}
                className="nav-item music-subnav"
                href={routeHref({ view: 'images', page: 'act', part: act.id })}
                aria-current={
                  route.view === 'images' && currentAct(summary.images!, route) === act.id
                    ? 'page'
                    : undefined
                }
              >
                <span className="grow">{shortTitle(act.title)}</span>
                {act.state === 'ok' && (
                  <DoneCount
                    count={doneCount(imagesDone(act))}
                    title="Images chosen and up to date, out of all"
                  />
                )}
              </a>
            ))}
            <a
              className="nav-item music-subnav"
              href={routeHref({ view: 'images', page: 'style' })}
              aria-current={route.view === 'images' && route.page === 'style' ? 'page' : undefined}
            >
              <span className="grow">Style</span>
            </a>
          </>
        )}
        <span className="nav-item" aria-disabled="true">
          <SpeakerIcon /> <span className="grow">Sound effects</span>{' '}
          <span className="meta">Soon</span>
        </span>
      </nav>

      <nav className="nav sidebar-foot" aria-label="Project">
        <a
          className="nav-item"
          href={routeHref({
            view: 'characters',
            language:
              route.view === 'part' ||
              route.view === 'lines' ||
              route.view === 'characters' ||
              route.view === 'character' ||
              route.view === 'audition'
                ? route.language
                : undefined,
          })}
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
          {spending.data?.ok && spending.data.count + spending.data.takes > 0 && (
            <span className="meta">{amountText(spending.data.total, spending.data.credits)}</span>
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

/** A done count at the right of a sidebar entry, in its colour. */
function DoneCount({ count, title }: { count: { text: string; tone: DoneTone }; title: string }) {
  return (
    <span className={metaClass(count.tone)} title={title}>
      {count.text}
    </span>
  )
}

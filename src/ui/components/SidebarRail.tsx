import type { ProjectSummary } from '../../core/summary'
import { routeHref, type Route } from '../route'
import { openWorkspace } from '../sidebarActs'
import type { ReactNode } from 'react'
import {
  ChangesIcon,
  ChevronsRightIcon,
  CheckIcon,
  ImageIcon,
  LayersIcon,
  MicIcon,
  MusicIcon,
  PeopleIcon,
  SpeakerIcon,
  SpendingIcon,
} from './icons'

/** One act of the open workspace as a pill in the rail. */
export interface RailAct {
  key: string
  label: string
  tip: string
  href: string
  current: boolean
  /** How far the act is; left out for an entry with nothing to count. */
  dot?: 'all' | 'some' | 'none'
}

/** One entry of the rail: an icon over a short name. */
function RailItem({
  name,
  tip,
  href,
  current,
  icon,
  badge,
}: {
  name: string
  tip: string
  href: string
  current: boolean
  icon: ReactNode
  badge?: { text: string; tip: string }
}) {
  return (
    <a className="rail-item" href={href} title={tip} aria-current={current ? 'page' : undefined}>
      {icon}
      <span>{name}</span>
      {badge && (
        <span className="rail-badge" title={badge.tip}>
          {badge.text}
        </span>
      )}
    </a>
  )
}

/**
 * The sidebar folded to a rail: the studio's mark (the project's name, folder and credit as its
 * tip), the workspaces with the open one's acts as pills, and the project pages.
 */
export function SidebarRail({
  summary,
  route,
  activePart,
  acts,
  markTip,
  problems,
  onUnfold,
}: {
  summary: ProjectSummary
  route: Route
  activePart: string | null
  acts: RailAct[]
  markTip: string
  problems: { count: number; tip: string }
  onUnfold: () => void
}) {
  const open = openWorkspace(route)
  const workspaces = [
    {
      key: 'narration',
      name: 'Narration',
      tip: 'Narration',
      href: routeHref({ view: 'part', part: activePart }),
      icon: <MicIcon />,
    },
    {
      key: 'music',
      name: 'Music',
      tip: 'Music',
      href: routeHref({ view: 'music', page: null }),
      icon: <MusicIcon />,
    },
    {
      key: 'images',
      name: 'Images',
      tip: 'Images',
      href: routeHref({ view: 'images', page: null }),
      icon: <ImageIcon />,
    },
    {
      key: 'effects',
      name: 'Effects',
      tip: 'Sound effects',
      href: routeHref({ view: 'effects', page: null }),
      icon: <SpeakerIcon />,
    },
    ...(summary.scenes
      ? [
          {
            key: 'scenes',
            name: 'Scenes',
            tip: 'Scenes',
            href: routeHref({ view: 'scenes', page: null }),
            icon: <LayersIcon />,
          },
        ]
      : []),
  ]
  const language =
    route.view === 'part' ||
    route.view === 'lines' ||
    route.view === 'characters' ||
    route.view === 'character' ||
    route.view === 'audition'
      ? route.language
      : undefined
  return (
    <aside className="sidebar sidebar-rail">
      <div className="rail-mark" title={markTip}>
        <LayersIcon size={18} />
      </div>
      <button className="rail-fold" title="Unfold the sidebar" onClick={onUnfold}>
        <ChevronsRightIcon />
        <span className="sr-only">Unfold the sidebar</span>
      </button>
      <nav className="rail-nav" aria-label="Workspaces">
        {workspaces.map((w) => (
          <div key={w.key} className="rail-group">
            <RailItem
              name={w.name}
              tip={w.tip}
              href={w.href}
              current={open === w.key || (w.key === 'effects' && route.view === 'effects')}
              icon={w.icon}
            />
            {open === w.key && acts.length > 0 && (
              <div className="rail-pills">
                {acts.map((a) => (
                  <a
                    key={a.key}
                    className="rail-pill"
                    href={a.href}
                    title={a.tip}
                    aria-current={a.current ? 'page' : undefined}
                  >
                    {a.dot && <span className="rail-dot" data-dot={a.dot} />}
                    {a.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
      <nav className="rail-nav rail-foot" aria-label="Project">
        <div className="rail-sep" />
        <RailItem
          name="Cast"
          tip="All characters"
          href={routeHref({ view: 'characters', language })}
          current={
            route.view === 'characters' || route.view === 'character' || route.view === 'audition'
          }
          icon={<PeopleIcon />}
        />
        <RailItem
          name="Changes"
          tip="Changes"
          href={routeHref({ view: 'changes' })}
          current={route.view === 'changes'}
          icon={<ChangesIcon />}
        />
        <RailItem
          name="Spending"
          tip="Spending"
          href={routeHref({ view: 'spending' })}
          current={route.view === 'spending'}
          icon={<SpendingIcon />}
        />
        <RailItem
          name="Setup"
          tip="Setup"
          href={routeHref({ view: 'setup' })}
          current={route.view === 'setup'}
          icon={<CheckIcon />}
          badge={
            problems.count > 0 ? { text: String(problems.count), tip: problems.tip } : undefined
          }
        />
      </nav>
    </aside>
  )
}

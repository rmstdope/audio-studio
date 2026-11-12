import { useEffect, type ReactNode } from 'react'
import { jobAtKey, type ImageJob, type JobTab } from '../../imageJobs'

/** A small drawing for each job, in the studio's stroke style. */
const ICONS: Record<ImageJob, ReactNode> = {
  make: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="m3 15 5-5 4 4 3-3 6 5" />
    </>
  ),
  'fine-tune': (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  patches: (
    <>
      <rect x="4" y="4" width="11" height="11" rx="2" />
      <rect x="9" y="9" width="11" height="11" rx="2" />
    </>
  ),
  areas: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
}

/** Whether a key pressed on `target` is typing in a field or choosing in a menu. */
function typingIn(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable], [role="menu"], [role="listbox"]',
    ) !== null
  )
}

/**
 * The row of an image page's job tabs: each with its icon, name, state chip and key. The open tab
 * is underlined; a tab that is not open whose work is running says "making…" in place of its chip.
 */
export function ImageJobTabs({
  tabs,
  open,
  onOpen,
}: {
  tabs: JobTab[]
  open: ImageJob
  onOpen: (job: ImageJob) => void
}) {
  // 1 to 4 open the tabs shown, anywhere on the page except while typing or choosing in a menu.
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typingIn(event.target)) return
      const job = jobAtKey(tabs, event.key)
      if (job) onOpen(job)
    }
    document.addEventListener('keydown', listen)
    return () => document.removeEventListener('keydown', listen)
  }, [tabs, onOpen])
  return (
    <div className="job-tabs" role="tablist" aria-label="The image's jobs">
      {tabs.map((tab, index) => {
        const selected = tab.job === open
        const chip = !selected && tab.making ? { text: 'making…', tone: 'accent' } : tab.chip
        return (
          <button
            key={tab.job}
            type="button"
            role="tab"
            id={`job-tab-${tab.job}`}
            aria-selected={selected}
            aria-controls={`job-${tab.job}`}
            className={selected ? 'job-tab job-tab-open' : 'job-tab'}
            onClick={() => onOpen(tab.job)}
          >
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {ICONS[tab.job]}
            </svg>
            <span className="job-tab-title">{tab.title}</span>
            {chip && <span className={`chip chip-${chip.tone}`}>{chip.text}</span>}
            <span className="job-tab-key" aria-hidden="true">
              {index + 1}
            </span>
          </button>
        )
      })}
    </div>
  )
}

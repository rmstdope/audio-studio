import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Problem } from '../../core/project'
import { notShown } from '../problems'

/** What a page's banners have claimed, in the order they first claimed it, and a counter that bumps when one leaves. */
type Scope = {
  claims: Map<string, { owner: string; problems: Problem[] }>
  leave: () => void
  version: number
}

const ScopeContext = createContext<Scope | null>(null)

/**
 * One page's record of which problems its banners show. Banners claim in the order they render,
 * so each lists only what the ones before it do not: a problem appears once however many banners
 * the page has, and no banner needs to know the others.
 */
export function ProblemScope({ children }: { children: ReactNode }) {
  const claims = useRef(new Map<string, { owner: string; problems: Problem[] }>())
  const [version, setVersion] = useState(0)
  const leave = useRef(() => setVersion((v) => v + 1))
  return (
    <ScopeContext.Provider value={{ claims: claims.current, leave: leave.current, version }}>
      {children}
    </ScopeContext.Provider>
  )
}

/**
 * The problems a banner named `id` should list: its own, less those the banners before it on the
 * page already show. Outside a `ProblemScope` it is every problem. A banner that leaves the page
 * stops hiding its problems from the others.
 */
export function useBannerProblems(id: string, problems: Problem[]): Problem[] {
  const scope = useContext(ScopeContext)
  const owner = useId()
  const leave = scope?.leave
  const claims = scope?.claims
  useEffect(() => {
    return () => {
      // A page that replaces this one has already claimed the id: its claim stays.
      if (claims?.get(id)?.owner === owner && claims.delete(id)) leave?.()
    }
  }, [claims, leave, id, owner])
  if (!scope) return problems
  const before: Problem[] = []
  for (const [other, claimed] of scope.claims) {
    if (other === id) break
    before.push(...claimed.problems)
  }
  // Set after reading, so a banner's own claim never hides its own problems; re-claiming under
  // the same id keeps its place in the order.
  scope.claims.set(id, { owner, problems })
  return notShown(problems, before)
}

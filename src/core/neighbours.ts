/**
 * Where an item stands in its list and what its neighbours are: the data behind the previous/next
 * control of a one-item page. Null when the list does not hold the id. The list is not wrapped.
 */
export function neighbours<T extends { id: string }>(
  items: readonly T[],
  id: string,
): { position: number; count: number; previous: T | null; next: T | null } | null {
  const at = items.findIndex((item) => item.id === id)
  if (at < 0) return null
  return {
    position: at + 1,
    count: items.length,
    previous: items[at - 1] ?? null,
    next: items[at + 1] ?? null,
  }
}

/**
 * Fish Audio's prices for text to speech: US dollars per million UTF-8 bytes of text sent, as on
 * https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits (checked
 * 2026-10-24). A promotion has the moment it ends; the list price applies from then on.
 */
const PRICES: Record<string, { price: number; promotion?: { price: number; until: string } }> = {
  's2.1-pro-free': { price: 0 },
  's2.1-pro': { price: 15 },
  's2-pro': { price: 15 },
  s1: { price: 15 },
  'drama-3': { price: 50, promotion: { price: 10, until: '2026-11-12T17:00:00Z' } },
}

/** A model's price at `at` (dollars per million bytes), or undefined for a model not listed. */
export function priceOf(model: string, at: Date): number | undefined {
  const entry = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined
  if (!entry) return undefined
  const { promotion } = entry
  return promotion && at < new Date(promotion.until) ? promotion.price : entry.price
}

/** Whether the studio knows a model's price, so it can say what using it costs. */
export function isPriced(model: string): boolean {
  return Object.hasOwn(PRICES, model)
}

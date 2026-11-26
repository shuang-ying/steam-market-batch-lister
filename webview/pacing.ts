import type { MarketPriceQuote, PluginSettings } from './types';

export interface MultisellEntry {
  marketHashName: string;
  quantity: number;
}

/**
 * Generates a bell-shaped (triangular distribution) random float in [0, 1].
 * Clusters naturally near the middle while still exploring extremes like human reaction times.
 */
export function humanRandomUnit(rng: () => number = Math.random): number {
  return (rng() + rng()) / 2;
}

/**
 * Computes the next sell delay in milliseconds.
 * - Fixed mode: returns settings.sellDelayMs
 * - Human mode: triangular random in [sellDelayMinMs, sellDelayMaxMs], plus occasional
 *   natural hesitation pause (+1.2s~3.2s with ~12% probability).
 */
export function computeNextSellDelayMs(
  settings: Pick<PluginSettings, 'humanMode' | 'sellDelayMs' | 'sellDelayMinMs' | 'sellDelayMaxMs'>,
  rng: () => number = Math.random,
): number {
  if (!settings.humanMode) {
    return Math.max(500, Math.round(settings.sellDelayMs));
  }
  const minMs = Math.max(800, Math.min(settings.sellDelayMinMs, settings.sellDelayMaxMs));
  const maxMs = Math.max(minMs, Math.max(settings.sellDelayMinMs, settings.sellDelayMaxMs));
  let delay = minMs + humanRandomUnit(rng) * (maxMs - minMs);

  // Occasional natural human micro-pause (~12% chance)
  if (rng() < 0.12) {
    delay += 1200 + rng() * 2000;
  }
  return Math.round(delay);
}

/**
 * Computes the next price-query delay in milliseconds.
 * Adds ±35% random jitter when humanMode is enabled so requests aren't fixed-interval metronome ticks.
 */
export function computeNextPriceDelayMs(
  settings: Pick<PluginSettings, 'humanMode' | 'priceDelayMs'>,
  rng: () => number = Math.random,
): number {
  const base = Math.max(500, Math.round(settings.priceDelayMs));
  if (!settings.humanMode) {
    return base;
  }
  const factor = 0.65 + humanRandomUnit(rng) * 0.7; // [0.65, 1.35]
  return Math.max(500, Math.round(base * factor));
}

/**
 * Computes batch rest duration in milliseconds when humanMode & batchRestEvery trigger.
 */
export function computeBatchRestMs(
  settings: Pick<PluginSettings, 'batchRestMinSec' | 'batchRestMaxSec'>,
  rng: () => number = Math.random,
): number {
  const minSec = Math.max(5, Math.min(settings.batchRestMinSec, settings.batchRestMaxSec));
  const maxSec = Math.max(minSec, Math.max(settings.batchRestMinSec, settings.batchRestMaxSec));
  return Math.round((minSec + humanRandomUnit(rng) * (maxSec - minSec)) * 1000);
}

/**
 * Checks whether a planned buyer price is abnormally lower than the current market lowest sell price.
 * Returns the ratio percentage (e.g. 55 means 55% of lowest sell price) if abnormally low, else null.
 */
export function checkAbnormalLowPrice(
  buyerPaysCents: number,
  quote: MarketPriceQuote | null,
  lowPriceWarnPercent: number,
): { ratioPercent: number; lowestSellCents: number } | null {
  if (
    !quote ||
    quote.lowestSellCents === null ||
    quote.lowestSellCents <= 10 ||
    lowPriceWarnPercent <= 0
  ) {
    return null;
  }
  const ratioPercent = Math.round((buyerPaysCents / quote.lowestSellCents) * 100);
  if (ratioPercent < lowPriceWarnPercent) {
    return {
      ratioPercent,
      lowestSellCents: quote.lowestSellCents,
    };
  }
  return null;
}

/**
 * Builds Steam's official native bulk-sell URL for commodity items (CS2 cases/capsules,
 * Steam trading cards, TF2 crates, Dota 2 treasures, etc.):
 * https://steamcommunity.com/market/multisell?appid=<appid>&contextid=<contextid>&items[]=<name>&qty[]=<n>
 *
 * Caps distinct item types per URL to avoid exceeding browser URL length limits.
 */
export function buildSteamMultisellUrl(
  appid: number,
  contextid: string,
  entries: MultisellEntry[],
  maxDistinctItems = 25,
): string | null {
  if (!appid || !contextid || entries.length === 0) {
    return null;
  }
  const slice = entries.slice(0, Math.max(1, maxDistinctItems));
  const parts: string[] = [
    `appid=${encodeURIComponent(String(appid))}`,
    `contextid=${encodeURIComponent(String(contextid))}`,
  ];
  for (const item of slice) {
    parts.push(`items[]=${encodeURIComponent(item.marketHashName)}`);
    parts.push(`qty[]=${encodeURIComponent(String(Math.max(1, Math.floor(item.quantity))))}`);
  }
  return `https://steamcommunity.com/market/multisell?${parts.join('&')}`;
}

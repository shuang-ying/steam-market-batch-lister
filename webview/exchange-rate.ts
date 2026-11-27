import type { ExchangeRateInfo } from './types';

const FX_CACHE_STORAGE_KEY = 'smbl_fx_daily_cache_v1';
const COST_STORAGE_KEY = 'smbl_item_cost_cny_v1';
const MAX_COST_ENTRIES = 5000;

interface FxCacheMap {
  [currencyCode: string]: ExchangeRateInfo;
}

interface CostMap {
  [itemKey: string]: number;
}

interface MillenniumHttpBackend {
  http_get_text?: (url: string) => Promise<string>;
}

/**
 * Returns local calendar date key in YYYY-MM-DD format for daily FX rate caching.
 */
export function getLocalDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function readFxCache(): FxCacheMap {
  try {
    const raw = localStorage.getItem(FX_CACHE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as FxCacheMap;
      }
    }
  } catch {
    // ignore storage errors
  }
  return {};
}

function writeFxCache(code: string, info: ExchangeRateInfo): void {
  const cache = readFxCache();
  cache[code] = info;
  try {
    localStorage.setItem(FX_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

export function getCachedDailyRate(
  currencyCode: string,
  todayKey: string = getLocalDateKey(),
): ExchangeRateInfo | null {
  const code = currencyCode.toUpperCase();
  if (code === 'CNY') {
    return {
      currencyCode: 'CNY',
      rateToCny: 1,
      date: todayKey,
      source: 'native',
      fetchedAt: Date.now(),
    };
  }
  const cache = readFxCache();
  const hit = cache[code];
  if (hit && hit.date === todayKey && Number.isFinite(hit.rateToCny) && hit.rateToCny > 0) {
    return hit;
  }
  return null;
}

/**
 * Fallback: returns the most recent cached rate even if from a previous day (used when offline).
 */
export function getLastKnownRate(currencyCode: string): ExchangeRateInfo | null {
  const code = currencyCode.toUpperCase();
  const cache = readFxCache();
  const hit = cache[code];
  if (hit && Number.isFinite(hit.rateToCny) && hit.rateToCny > 0) {
    return hit;
  }
  return null;
}

async function fetchJsonText(url: string): Promise<string | null> {
  // Prefer Millennium Lua backend HTTP (bypasses Steam page CSP/CORS completely)
  const g = globalThis as unknown as { backend?: MillenniumHttpBackend };
  if (g?.backend && typeof g.backend.http_get_text === 'function') {
    try {
      const body = await g.backend.http_get_text(url);
      if (body && body.trim().startsWith('{')) {
        return body;
      }
    } catch {
      // fall through to browser fetch
    }
  }

  try {
    const res = await fetch(url, { method: 'GET' });
    if (res.ok) {
      return await res.text();
    }
  } catch {
    // ignore network/CSP errors
  }
  return null;
}

export function parseOpenErApiRate(body: string): number | null {
  try {
    const data = JSON.parse(body) as { result?: string; rates?: Record<string, number> };
    const rate = data?.rates?.CNY;
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

export function parseJsdelivrCurrencyApiRate(body: string, currencyCode: string): number | null {
  try {
    const lower = currencyCode.toLowerCase();
    const data = JSON.parse(body) as Record<string, Record<string, number> | string>;
    const rates = data?.[lower];
    if (rates && typeof rates === 'object') {
      const rate = rates.cny;
      return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
    }
  } catch {
    // ignore
  }
  return null;
}

export function parseFrankfurterRate(body: string): number | null {
  try {
    const data = JSON.parse(body) as { rates?: Record<string, number> };
    const rate = data?.rates?.CNY;
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

/**
 * Fetches the daily exchange rate `1 <currencyCode> = ? CNY`.
 * Cached per local calendar day (YYYY-MM-DD) so it only queries once per day unless forceRefresh is true.
 */
export async function fetchDailyExchangeRateToCny(
  currencyCode: string,
  options?: { forceRefresh?: boolean; manualOverrideRate?: number },
): Promise<ExchangeRateInfo | null> {
  const code = currencyCode.toUpperCase();
  const today = getLocalDateKey();

  if (options?.manualOverrideRate && options.manualOverrideRate > 0) {
    return {
      currencyCode: code,
      rateToCny: options.manualOverrideRate,
      date: today,
      source: '手动设定',
      fetchedAt: Date.now(),
      isManual: true,
    };
  }

  if (code === 'CNY') {
    return {
      currencyCode: 'CNY',
      rateToCny: 1,
      date: today,
      source: '本币',
      fetchedAt: Date.now(),
    };
  }

  if (!options?.forceRefresh) {
    const cached = getCachedDailyRate(code, today);
    if (cached) {
      return cached;
    }
  }

  const providers: Array<{
    name: string;
    url: string;
    parse: (body: string) => number | null;
  }> = [
    {
      name: 'open.er-api',
      url: `https://open.er-api.com/v6/latest/${encodeURIComponent(code)}`,
      parse: parseOpenErApiRate,
    },
    {
      name: 'jsdelivr-fx',
      url: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${encodeURIComponent(code.toLowerCase())}.json`,
      parse: (body) => parseJsdelivrCurrencyApiRate(body, code),
    },
    {
      name: 'frankfurter',
      url: `https://api.frankfurter.app/latest?from=${encodeURIComponent(code)}&to=CNY`,
      parse: parseFrankfurterRate,
    },
  ];

  for (const provider of providers) {
    const body = await fetchJsonText(provider.url);
    if (!body) continue;
    const rate = provider.parse(body);
    if (rate !== null) {
      const info: ExchangeRateInfo = {
        currencyCode: code,
        rateToCny: rate,
        date: today,
        source: provider.name,
        fetchedAt: Date.now(),
      };
      writeFxCache(code, info);
      return info;
    }
  }

  // Offline fallback to last known cached rate
  return getLastKnownRate(code);
}

// ============= Persistent Item Cost Price (CNY) Helpers =============

let memoryCostMap: CostMap | null = null;

function loadCostMap(): CostMap {
  if (memoryCostMap) return memoryCostMap;
  try {
    const raw = localStorage.getItem(COST_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') {
        memoryCostMap = parsed as CostMap;
        return memoryCostMap;
      }
    }
  } catch {
    // ignore
  }
  memoryCostMap = {};
  return memoryCostMap;
}

export function getSavedCostPriceCny(appid: number, marketHashName: string): number | null {
  const map = loadCostMap();
  const val = map[`${appid}:${marketHashName}`];
  return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;
}

export function saveCostPriceCny(
  appid: number,
  marketHashName: string,
  costCny: number | null,
): void {
  const map = loadCostMap();
  const key = `${appid}:${marketHashName}`;
  if (costCny === null || !Number.isFinite(costCny) || costCny <= 0) {
    delete map[key];
  } else {
    map[key] = costCny;
    const keys = Object.keys(map);
    if (keys.length > MAX_COST_ENTRIES) {
      const removeCount = keys.length - MAX_COST_ENTRIES;
      for (let i = 0; i < removeCount; i += 1) {
        delete map[keys[i]];
      }
    }
  }
  try {
    localStorage.setItem(COST_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

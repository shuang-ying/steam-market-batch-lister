import { parseSteamPriceToCents } from './pricing';
import type { MarketPriceQuote, WalletFeeConfig } from './types';

const NAMEID_STORAGE_KEY = 'smbl_item_nameid_cache_v1';
const MAX_NAMEID_CACHE_ENTRIES = 5000;
const QUOTE_CACHE_TTL_MS = 3 * 60 * 1000;

interface NameIdCacheMap {
  [cacheKey: string]: string;
}

const memoryQuoteCache = new Map<string, MarketPriceQuote>();
let memoryNameIdCache: NameIdCacheMap | null = null;

function loadNameIdCache(): NameIdCacheMap {
  if (memoryNameIdCache) return memoryNameIdCache;
  try {
    const raw = localStorage.getItem(NAMEID_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') {
        memoryNameIdCache = parsed as NameIdCacheMap;
        return memoryNameIdCache;
      }
    }
  } catch {
    // ignore storage errors
  }
  memoryNameIdCache = {};
  return memoryNameIdCache;
}

function saveNameIdCacheEntry(key: string, itemNameId: string): void {
  const cache = loadNameIdCache();
  cache[key] = itemNameId;
  const keys = Object.keys(cache);
  if (keys.length > MAX_NAMEID_CACHE_ENTRIES) {
    const removeCount = keys.length - MAX_NAMEID_CACHE_ENTRIES;
    for (let i = 0; i < removeCount; i += 1) {
      delete cache[keys[i]];
    }
  }
  try {
    localStorage.setItem(NAMEID_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

export function getCachedItemNameId(appid: number, marketHashName: string): string | null {
  const cache = loadNameIdCache();
  return cache[`${appid}:${marketHashName}`] || null;
}

export class SteamRateLimitError extends Error {
  public readonly status: number;

  constructor(message: string, status = 429) {
    super(message);
    this.name = 'SteamRateLimitError';
    this.status = status;
  }
}

export function clearMemoryQuoteCache(): void {
  memoryQuoteCache.clear();
}

export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Sleeps for `totalMs` while reporting remaining seconds every 500ms, supporting abort and early skip.
 */
export async function sleepCountdownWithSkip(
  totalMs: number,
  options: {
    signal?: AbortSignal;
    shouldSkip: () => boolean;
    onTick: (remainingSec: number) => void;
  },
): Promise<boolean> {
  const endTime = Date.now() + totalMs;
  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (options.shouldSkip()) {
      return true;
    }
    const remainingMs = endTime - Date.now();
    if (remainingMs <= 0) {
      return false;
    }
    options.onTick(Math.ceil(remainingMs / 1000));
    await sleepWithAbort(Math.min(500, remainingMs), options.signal);
  }
}

async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit,
  options?: {
    signal?: AbortSignal;
    maxRetries?: number;
    onRateLimit?: (waitMs: number, attempt: number) => void;
  },
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 3;
  let attempt = 0;

  while (true) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const res = await fetch(url, {
      ...init,
      credentials: 'include',
      signal: options?.signal,
    });

    if (res.status === 429 || res.status === 502 || res.status === 503) {
      if (attempt >= maxRetries) {
        return res;
      }
      attempt += 1;
      const retryAfterSec = parseInt(res.headers.get('Retry-After') || '', 10);
      const baseWaitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : Math.min(60000, 5000 * Math.pow(2, attempt - 1));
      const jitterMs = Math.floor(Math.random() * 1200);
      const waitMs = baseWaitMs + jitterMs;
      options?.onRateLimit?.(waitMs, attempt);
      await sleepWithAbort(waitMs, options?.signal);
      continue;
    }

    return res;
  }
}

async function fetchItemNameId(
  appid: number,
  marketHashName: string,
  options?: {
    signal?: AbortSignal;
    onRateLimit?: (waitMs: number, attempt: number) => void;
  },
): Promise<string | null> {
  const key = `${appid}:${marketHashName}`;
  const cached = getCachedItemNameId(appid, marketHashName);
  if (cached) {
    return cached;
  }

  const url = `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(marketHashName)}`;
  const res = await fetchWithRateLimitRetry(url, { method: 'GET' }, options);
  if (res.status === 429) {
    throw new SteamRateLimitError('获取商品页面触发 Steam 429 限流', 429);
  }
  if (!res.ok) {
    throw new Error(`获取商品页面失败 (HTTP ${res.status})`);
  }

  const html = await res.text();
  const match = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/);
  if (!match) {
    return null;
  }

  const itemNameId = match[1];
  saveNameIdCacheEntry(key, itemNameId);
  return itemNameId;
}

async function fetchPriceOverview(
  appid: number,
  marketHashName: string,
  wallet: WalletFeeConfig,
  options?: {
    signal?: AbortSignal;
    onRateLimit?: (waitMs: number, attempt: number) => void;
  },
): Promise<{ lowestSellCents: number | null; medianCents: number | null; volume?: string }> {
  const params = new URLSearchParams({
    country: wallet.country,
    currency: String(wallet.currency),
    appid: String(appid),
    market_hash_name: marketHashName,
  });
  const url = `https://steamcommunity.com/market/priceoverview/?${params.toString()}`;
  const res = await fetchWithRateLimitRetry(url, { method: 'GET' }, options);
  if (res.status === 429) {
    throw new SteamRateLimitError('查询市场概览触发 Steam 429 限流', 429);
  }
  if (!res.ok) {
    throw new Error(`查询市场概览失败 (HTTP ${res.status})`);
  }
  const data = (await res.json()) as {
    success?: boolean;
    lowest_price?: string;
    median_price?: string;
    volume?: string;
  };
  if (!data?.success) {
    return { lowestSellCents: null, medianCents: null };
  }
  return {
    lowestSellCents: parseSteamPriceToCents(data.lowest_price),
    medianCents: parseSteamPriceToCents(data.median_price),
    volume: data.volume,
  };
}

async function fetchOrderHistogram(
  itemNameId: string,
  wallet: WalletFeeConfig,
  options?: {
    signal?: AbortSignal;
    onRateLimit?: (waitMs: number, attempt: number) => void;
  },
): Promise<{ lowestSellCents: number | null; highestBuyCents: number | null }> {
  const params = new URLSearchParams({
    country: wallet.country,
    language: 'schinese',
    currency: String(wallet.currency),
    item_nameid: itemNameId,
    two_factor: '0',
  });
  const url = `https://steamcommunity.com/market/itemordershistogram?${params.toString()}`;
  const res = await fetchWithRateLimitRetry(url, { method: 'GET' }, options);
  if (res.status === 429) {
    throw new SteamRateLimitError('查询挂单簿触发 Steam 429 限流', 429);
  }
  if (!res.ok) {
    throw new Error(`查询挂单簿失败 (HTTP ${res.status})`);
  }
  const data = (await res.json()) as {
    success?: number | boolean;
    lowest_sell_order?: string | number | null;
    highest_buy_order?: string | number | null;
  };

  if (!data || (data.success !== 1 && data.success !== true)) {
    return { lowestSellCents: null, highestBuyCents: null };
  }

  const parseOrderInt = (v: string | number | null | undefined): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return {
    lowestSellCents: parseOrderInt(data.lowest_sell_order),
    highestBuyCents: parseOrderInt(data.highest_buy_order),
  };
}

export interface FetchQuoteOptions {
  /** When true, always ensure highest_buy_order is queried via itemordershistogram. */
  includeBuyOrder: boolean;
  forceRefresh?: boolean;
  signal?: AbortSignal;
  onRateLimit?: (waitMs: number, attempt: number) => void;
}

/**
 * Fetches market quote for an item with smart caching & request minimization:
 * - If item_nameid is already cached OR includeBuyOrder is true, queries itemordershistogram
 *   (which returns BOTH exact lowest_sell_order and highest_buy_order in integer cents).
 * - If non-commodity item histogram lacks lowest_sell_order, falls back to priceoverview.
 * - If includeBuyOrder is false and item_nameid is not cached, uses 1-call priceoverview.
 */
export async function fetchMarketQuote(
  appid: number,
  marketHashName: string,
  wallet: WalletFeeConfig,
  options: FetchQuoteOptions,
): Promise<MarketPriceQuote> {
  const quoteKey = `${wallet.currency}:${appid}:${marketHashName}`;
  const cached = memoryQuoteCache.get(quoteKey);

  if (
    cached &&
    !options.forceRefresh &&
    Date.now() - cached.fetchedAt < QUOTE_CACHE_TTL_MS &&
    (!options.includeBuyOrder || cached.source !== 'overview')
  ) {
    return cached;
  }

  const cachedNameId = getCachedItemNameId(appid, marketHashName);
  const shouldUseHistogram = options.includeBuyOrder || Boolean(cachedNameId);

  let quote: MarketPriceQuote;

  if (shouldUseHistogram) {
    const itemNameId =
      cachedNameId || (await fetchItemNameId(appid, marketHashName, options));

    if (itemNameId) {
      const hist = await fetchOrderHistogram(itemNameId, wallet, options);
      let lowestSellCents = hist.lowestSellCents;
      let medianCents: number | null = null;
      let volume: string | undefined;
      let source: MarketPriceQuote['source'] = 'histogram';

      // Non-commodity items (e.g. CS2 skins) occasionally omit lowest_sell_order in histogram
      if (lowestSellCents === null) {
        const overview = await fetchPriceOverview(appid, marketHashName, wallet, options);
        lowestSellCents = overview.lowestSellCents;
        medianCents = overview.medianCents;
        volume = overview.volume;
        source = 'hybrid';
      }

      quote = {
        lowestSellCents,
        highestBuyCents: hist.highestBuyCents,
        medianCents,
        volume,
        source,
        fetchedAt: Date.now(),
      };
    } else {
      const overview = await fetchPriceOverview(appid, marketHashName, wallet, options);
      quote = {
        lowestSellCents: overview.lowestSellCents,
        highestBuyCents: null,
        medianCents: overview.medianCents,
        volume: overview.volume,
        source: 'overview',
        fetchedAt: Date.now(),
      };
    }
  } else {
    const overview = await fetchPriceOverview(appid, marketHashName, wallet, options);
    quote = {
      lowestSellCents: overview.lowestSellCents,
      highestBuyCents: null,
      medianCents: overview.medianCents,
      volume: overview.volume,
      source: 'overview',
      fetchedAt: Date.now(),
    };
  }

  memoryQuoteCache.set(quoteKey, quote);
  return quote;
}

export interface SellItemParams {
  sessionId: string;
  appid: number;
  contextid: string;
  assetid: string;
  amount: number;
  sellerReceivesCents: number;
  signal?: AbortSignal;
  onRateLimit?: (waitMs: number, attempt: number) => void;
}

export interface SellItemResponse {
  ok: boolean;
  requiresConfirmation: boolean;
  rateLimited: boolean;
  message: string;
}

/**
 * Lists a single asset onto the Steam Community Market using the logged-in client session.
 * `sellerReceivesCents` is the exact seller payout in minor units expected by Steam's `price` param.
 */
export async function listItemOnMarket(params: SellItemParams): Promise<SellItemResponse> {
  const body = new URLSearchParams({
    sessionid: params.sessionId,
    appid: String(params.appid),
    contextid: String(params.contextid),
    assetid: String(params.assetid),
    amount: String(Math.max(1, params.amount)),
    price: String(Math.max(1, Math.floor(params.sellerReceivesCents))),
  });

  const res = await fetchWithRateLimitRetry(
    'https://steamcommunity.com/market/sellitem/',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    },
    {
      signal: params.signal,
      maxRetries: 2,
      onRateLimit: params.onRateLimit,
    },
  );

  interface SteamSellItemPayload {
    success?: boolean;
    requires_confirmation?: number | boolean;
    needs_mobile_confirmation?: boolean;
    needs_email_confirmation?: boolean;
    message?: string;
  }

  let payload: SteamSellItemPayload | null = null;

  try {
    payload = (await res.json()) as SteamSellItemPayload;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const isRateLimit = res.status === 429;
    return {
      ok: false,
      requiresConfirmation: false,
      rateLimited: isRateLimit,
      message: payload?.message || (isRateLimit ? 'HTTP 429 请求过于频繁，请稍后重试' : `HTTP ${res.status} 请求失败`),
    };
  }

  if (payload?.success) {
    const needsConfirm = Boolean(
      payload.requires_confirmation ||
        payload.needs_mobile_confirmation ||
        payload.needs_email_confirmation,
    );
    return {
      ok: true,
      requiresConfirmation: needsConfirm,
      rateLimited: false,
      message: needsConfirm ? '已提交，等待手机令牌确认' : '已直接上架',
    };
  }

  const errMsg = payload?.message || 'Steam 返回未知错误';
  const msgLooksRateLimited = /too many requests|频繁|速率|rate limit|稍后再试/i.test(errMsg);
  return {
    ok: false,
    requiresConfirmation: false,
    rateLimited: msgLooksRateLimited,
    message: errMsg,
  };
}

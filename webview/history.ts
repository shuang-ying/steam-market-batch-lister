import { calculateBalanceRatio, centsToCnyYuan, formatCnyYuan } from './pricing';
import type { ListingHistoryRecord, PricingStrategy, WalletFeeConfig } from './types';

const HISTORY_STORAGE_KEY = 'smbl_listing_history_v1';
const MAX_HISTORY_RECORDS = 5000;

interface MillenniumHistoryBackend {
  load_history_json?: () => Promise<string>;
  save_history_json?: (json: string) => Promise<boolean>;
  get_history_file_path?: () => Promise<string>;
}

function getHistoryBackend(): MillenniumHistoryBackend | null {
  const g = globalThis as unknown as { backend?: MillenniumHistoryBackend };
  if (g?.backend && typeof g.backend.load_history_json === 'function') {
    return g.backend;
  }
  return null;
}

export function sanitizeHistoryRecords(raw: unknown): ListingHistoryRecord[] {
  if (!Array.isArray(raw)) return [];
  const valid: ListingHistoryRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<ListingHistoryRecord>;
    if (typeof r.id !== 'string' || typeof r.timestamp !== 'number' || typeof r.displayName !== 'string') {
      continue;
    }
    valid.push({
      id: r.id,
      timestamp: r.timestamp,
      appid: Number(r.appid) || 0,
      appName: typeof r.appName === 'string' ? r.appName : `App ${r.appid ?? ''}`,
      contextid: String(r.contextid ?? ''),
      assetid: String(r.assetid ?? ''),
      marketHashName: typeof r.marketHashName === 'string' ? r.marketHashName : r.displayName,
      displayName: r.displayName,
      amount: Math.max(1, Number(r.amount) || 1),
      currencyCode: typeof r.currencyCode === 'string' ? r.currencyCode : 'CNY',
      currencySymbol: typeof r.currencySymbol === 'string' ? r.currencySymbol : '¥ ',
      symbolPrefix: typeof r.symbolPrefix === 'boolean' ? r.symbolPrefix : true,
      zeroDecimal: Boolean(r.zeroDecimal),
      buyerPaysCents: Number(r.buyerPaysCents) || 0,
      sellerReceivesCents: Number(r.sellerReceivesCents) || 0,
      fxRateToCny:
        typeof r.fxRateToCny === 'number' && Number.isFinite(r.fxRateToCny) && r.fxRateToCny > 0
          ? r.fxRateToCny
          : null,
      buyerPaysCny:
        typeof r.buyerPaysCny === 'number' && Number.isFinite(r.buyerPaysCny)
          ? r.buyerPaysCny
          : null,
      sellerReceivesCny:
        typeof r.sellerReceivesCny === 'number' && Number.isFinite(r.sellerReceivesCny)
          ? r.sellerReceivesCny
          : null,
      costPriceCny:
        typeof r.costPriceCny === 'number' && Number.isFinite(r.costPriceCny) && r.costPriceCny > 0
          ? r.costPriceCny
          : null,
      balanceRatio: typeof r.balanceRatio === 'string' && r.balanceRatio ? r.balanceRatio : null,
      strategy: (r.strategy as PricingStrategy) || 'lowest_sell',
      strategyLabel: typeof r.strategyLabel === 'string' ? r.strategyLabel : String(r.strategy ?? ''),
    });
  }
  valid.sort((a, b) => b.timestamp - a.timestamp);
  return valid.slice(0, MAX_HISTORY_RECORDS);
}

export function createHistoryRecord(params: {
  timestamp?: number;
  appid: number;
  appName: string;
  contextid: string;
  assetid: string;
  marketHashName: string;
  displayName: string;
  amount: number;
  wallet: WalletFeeConfig;
  buyerPaysCents: number;
  sellerReceivesCents: number;
  fxRateToCny: number | null;
  costPriceCny: number | null;
  strategy: PricingStrategy;
  strategyLabel: string;
}): ListingHistoryRecord {
  const ts = params.timestamp ?? Date.now();
  const effectiveFx = params.wallet.currencyCode === 'CNY' ? 1 : params.fxRateToCny;
  const buyerPaysCny = centsToCnyYuan(params.buyerPaysCents, effectiveFx);
  const sellerReceivesCny = centsToCnyYuan(params.sellerReceivesCents, effectiveFx);
  const ratioObj = calculateBalanceRatio(params.costPriceCny, sellerReceivesCny);

  return {
    id: `${ts}_${params.assetid}`,
    timestamp: ts,
    appid: params.appid,
    appName: params.appName,
    contextid: params.contextid,
    assetid: params.assetid,
    marketHashName: params.marketHashName,
    displayName: params.displayName,
    amount: Math.max(1, params.amount),
    currencyCode: params.wallet.currencyCode,
    currencySymbol: params.wallet.currencySymbol,
    symbolPrefix: params.wallet.symbolPrefix,
    zeroDecimal: params.wallet.zeroDecimal,
    buyerPaysCents: params.buyerPaysCents,
    sellerReceivesCents: params.sellerReceivesCents,
    fxRateToCny: effectiveFx,
    buyerPaysCny: buyerPaysCny !== null ? Number(buyerPaysCny.toFixed(4)) : null,
    sellerReceivesCny: sellerReceivesCny !== null ? Number(sellerReceivesCny.toFixed(4)) : null,
    costPriceCny:
      params.costPriceCny !== null && Number.isFinite(params.costPriceCny) && params.costPriceCny > 0
        ? params.costPriceCny
        : null,
    balanceRatio: ratioObj ? ratioObj.formatted : null,
    strategy: params.strategy,
    strategyLabel: params.strategyLabel,
  };
}

export async function getHistoryStoragePath(): Promise<string> {
  const bridge = getHistoryBackend();
  if (bridge?.get_history_file_path) {
    try {
      const p = await bridge.get_history_file_path();
      if (p) return p;
    } catch {
      // ignore
    }
  }
  return '浏览器本地存储 (localStorage)';
}

export async function loadListingHistory(): Promise<ListingHistoryRecord[]> {
  let backendRecords: ListingHistoryRecord[] = [];
  let localRecords: ListingHistoryRecord[] = [];

  const bridge = getHistoryBackend();
  if (bridge?.load_history_json) {
    try {
      const raw = await bridge.load_history_json();
      if (raw) {
        backendRecords = sanitizeHistoryRecords(JSON.parse(raw));
      }
    } catch {
      // ignore
    }
  }

  try {
    const rawLocal = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (rawLocal) {
      localRecords = sanitizeHistoryRecords(JSON.parse(rawLocal));
    }
  } catch {
    // ignore
  }

  // Merge by record id (keeps newest & never loses records between disk and localStorage)
  const mergedMap = new Map<string, ListingHistoryRecord>();
  for (const r of localRecords) mergedMap.set(r.id, r);
  for (const r of backendRecords) mergedMap.set(r.id, r);
  const merged = Array.from(mergedMap.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_HISTORY_RECORDS);

  return merged;
}

export async function saveListingHistory(records: ListingHistoryRecord[]): Promise<void> {
  const trimmed = records.slice(0, MAX_HISTORY_RECORDS);
  const serialized = JSON.stringify(trimmed);

  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, serialized);
  } catch {
    // ignore quota errors
  }

  const bridge = getHistoryBackend();
  if (bridge?.save_history_json) {
    try {
      await bridge.save_history_json(serialized);
    } catch {
      // ignore IPC errors
    }
  }
}

export function formatRecordCents(
  cents: number,
  rec: Pick<ListingHistoryRecord, 'currencySymbol' | 'symbolPrefix' | 'zeroDecimal'>,
): string {
  const value = rec.zeroDecimal ? Math.round(cents / 100).toString() : (cents / 100).toFixed(2);
  return rec.symbolPrefix ? `${rec.currencySymbol}${value}` : `${value}${rec.currencySymbol}`;
}

export function formatHistoryDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface HistorySummaryStats {
  count: number;
  totalBuyerCny: number;
  totalSellerCny: number;
  cnyCoveredCount: number;
  totalCostCny: number;
  costCoveredSellerCny: number;
  overallBalanceRatio: string | null;
}

export function computeHistoryStats(records: ListingHistoryRecord[]): HistorySummaryStats {
  let totalBuyerCny = 0;
  let totalSellerCny = 0;
  let cnyCoveredCount = 0;
  let totalCostCny = 0;
  let costCoveredSellerCny = 0;

  for (const r of records) {
    if (r.buyerPaysCny !== null && r.sellerReceivesCny !== null) {
      totalBuyerCny += r.buyerPaysCny;
      totalSellerCny += r.sellerReceivesCny;
      cnyCoveredCount += 1;
    }
    if (r.costPriceCny !== null && r.costPriceCny > 0 && r.sellerReceivesCny !== null && r.sellerReceivesCny > 0) {
      totalCostCny += r.costPriceCny;
      costCoveredSellerCny += r.sellerReceivesCny;
    }
  }

  const ratioObj = calculateBalanceRatio(totalCostCny, costCoveredSellerCny);
  return {
    count: records.length,
    totalBuyerCny,
    totalSellerCny,
    cnyCoveredCount,
    totalCostCny,
    costCoveredSellerCny,
    overallBalanceRatio: ratioObj ? ratioObj.formatted : null,
  };
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const str = val === null || val === undefined ? '' : String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Exports listing history records to UTF-8 BOM CSV (Excel-friendly Chinese encoding).
 */
export function buildHistoryCsv(records: ListingHistoryRecord[]): string {
  const headers = [
    '上架时间',
    '游戏',
    'AppID',
    '物品名称',
    '英文名(MarketHashName)',
    'AssetID',
    '币种',
    '买家付(原币种)',
    '卖家实收(原币种)',
    '当时汇率(兑CNY)',
    '买家付(CNY)',
    '卖家实收(CNY)',
    '成本价(CNY)',
    '余额率',
    '定价策略',
  ];

  const rows = records.map((r) => [
    formatHistoryDateTime(r.timestamp),
    r.appName,
    r.appid,
    r.displayName,
    r.marketHashName,
    r.assetid,
    r.currencyCode,
    r.zeroDecimal ? Math.round(r.buyerPaysCents / 100) : (r.buyerPaysCents / 100).toFixed(2),
    r.zeroDecimal
      ? Math.round(r.sellerReceivesCents / 100)
      : (r.sellerReceivesCents / 100).toFixed(2),
    r.fxRateToCny !== null ? r.fxRateToCny.toFixed(6) : '',
    r.buyerPaysCny !== null ? r.buyerPaysCny.toFixed(2) : '',
    r.sellerReceivesCny !== null ? r.sellerReceivesCny.toFixed(2) : '',
    r.costPriceCny !== null ? r.costPriceCny.toFixed(2) : '',
    r.balanceRatio ?? '',
    r.strategyLabel,
  ]);

  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));
  // Prepend UTF-8 BOM for clean Excel Chinese display
  return `\uFEFF${lines.join('\r\n')}`;
}

export function formatHistorySummaryText(stats: HistorySummaryStats): string {
  const parts = [`共 ${stats.count} 条`];
  if (stats.cnyCoveredCount > 0) {
    parts.push(`累计标价 ${formatCnyYuan(stats.totalBuyerCny)}`);
    parts.push(`累计实收 ${formatCnyYuan(stats.totalSellerCny)}`);
  }
  if (stats.overallBalanceRatio) {
    parts.push(`成本 ${formatCnyYuan(stats.totalCostCny)} · 综合余额率 ${stats.overallBalanceRatio}`);
  }
  return parts.join(' ｜ ');
}

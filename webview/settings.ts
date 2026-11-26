import { DEFAULT_SETTINGS, type PluginSettings } from './types';

const SETTINGS_STORAGE_KEY = 'smbl_settings_v1';

interface MillenniumWebviewBackend {
  get_settings_json?: () => Promise<string>;
  save_settings_json?: (json: string) => Promise<boolean>;
}

function getBackendBridge(): MillenniumWebviewBackend | null {
  const g = globalThis as unknown as { backend?: MillenniumWebviewBackend };
  if (g && g.backend && typeof g.backend.get_settings_json === 'function') {
    return g.backend;
  }
  return null;
}

function sanitizeSettings(raw: unknown): PluginSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }
  const obj = raw as Partial<PluginSettings>;
  const strategy =
    obj.strategy === 'lowest_sell' ||
    obj.strategy === 'lowest_sell_minus_1' ||
    obj.strategy === 'highest_buy' ||
    obj.strategy === 'custom'
      ? obj.strategy
      : DEFAULT_SETTINGS.strategy;

  const customPriceMode =
    obj.customPriceMode === 'fixed_buyer' ||
    obj.customPriceMode === 'fixed_seller' ||
    obj.customPriceMode === 'offset_lowest_sell' ||
    obj.customPriceMode === 'percent_lowest_sell'
      ? obj.customPriceMode
      : DEFAULT_SETTINGS.customPriceMode;

  return {
    strategy,
    customPriceMode,
    customFixedPriceCents: clampInt(
      obj.customFixedPriceCents,
      1,
      100000000,
      DEFAULT_SETTINGS.customFixedPriceCents,
    ),
    customOffsetCents: clampInt(
      obj.customOffsetCents,
      -1000000,
      1000000,
      DEFAULT_SETTINGS.customOffsetCents,
    ),
    customPercent: clampInt(obj.customPercent, 10, 500, DEFAULT_SETTINGS.customPercent),
    priceDelayMs: clampInt(obj.priceDelayMs, 500, 10000, DEFAULT_SETTINGS.priceDelayMs),
    sellDelayMs: clampInt(obj.sellDelayMs, 500, 10000, DEFAULT_SETTINGS.sellDelayMs),
    humanMode: typeof obj.humanMode === 'boolean' ? obj.humanMode : DEFAULT_SETTINGS.humanMode,
    sellDelayMinMs: clampInt(obj.sellDelayMinMs, 800, 30000, DEFAULT_SETTINGS.sellDelayMinMs),
    sellDelayMaxMs: clampInt(obj.sellDelayMaxMs, 1000, 60000, DEFAULT_SETTINGS.sellDelayMaxMs),
    batchRestEvery: clampInt(obj.batchRestEvery, 0, 500, DEFAULT_SETTINGS.batchRestEvery),
    batchRestMinSec: clampInt(obj.batchRestMinSec, 5, 600, DEFAULT_SETTINGS.batchRestMinSec),
    batchRestMaxSec: clampInt(obj.batchRestMaxSec, 5, 600, DEFAULT_SETTINGS.batchRestMaxSec),
    circuitBreakerMax429: clampInt(
      obj.circuitBreakerMax429,
      0,
      10,
      DEFAULT_SETTINGS.circuitBreakerMax429,
    ),
    lowPriceWarnPercent: clampInt(
      obj.lowPriceWarnPercent,
      0,
      95,
      DEFAULT_SETTINGS.lowPriceWarnPercent,
    ),
    skipModified: typeof obj.skipModified === 'boolean' ? obj.skipModified : DEFAULT_SETTINGS.skipModified,
    highValueThresholdCents: clampInt(
      obj.highValueThresholdCents,
      0,
      10000000,
      DEFAULT_SETTINGS.highValueThresholdCents,
    ),
    keepOneDuplicate:
      typeof obj.keepOneDuplicate === 'boolean'
        ? obj.keepOneDuplicate
        : DEFAULT_SETTINGS.keepOneDuplicate,
    autoOpenOnInventory:
      typeof obj.autoOpenOnInventory === 'boolean'
        ? obj.autoOpenOnInventory
        : DEFAULT_SETTINGS.autoOpenOnInventory,
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export async function loadSettings(): Promise<PluginSettings> {
  // Prefer Millennium Lua backend persistent config so settings sync between Steam Settings and Webview
  const bridge = getBackendBridge();
  if (bridge?.get_settings_json) {
    try {
      const jsonStr = await bridge.get_settings_json();
      if (jsonStr) {
        const parsed = sanitizeSettings(JSON.parse(jsonStr));
        try {
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed));
        } catch {
          // ignore
        }
        return parsed;
      }
    } catch {
      // Fall back to localStorage below
    }
  }

  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return sanitizeSettings(JSON.parse(raw));
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: PluginSettings): Promise<void> {
  const clean = sanitizeSettings(settings);
  const serialized = JSON.stringify(clean);

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, serialized);
  } catch {
    // ignore
  }

  const bridge = getBackendBridge();
  if (bridge?.save_settings_json) {
    try {
      await bridge.save_settings_json(serialized);
    } catch {
      // ignore IPC failure
    }
  }
}

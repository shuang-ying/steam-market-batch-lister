export type PricingStrategy =
  | 'lowest_sell'
  | 'lowest_sell_minus_1'
  | 'highest_buy'
  | 'custom';

export type CustomPriceMode =
  | 'fixed_buyer'
  | 'fixed_seller'
  | 'offset_lowest_sell'
  | 'percent_lowest_sell';

export interface PluginSettings {
  strategy: PricingStrategy;
  customPriceMode: CustomPriceMode;
  /** Fixed buyer/seller price in minor units (cents), e.g. 50 = ¥0.50 */
  customFixedPriceCents: number;
  /** Signed offset from lowest sell price in minor units (cents), e.g. -5 = -¥0.05 */
  customOffsetCents: number;
  /** Percentage of lowest sell price, e.g. 95 = 95% */
  customPercent: number;
  priceDelayMs: number;
  sellDelayMs: number;
  /** Human-like randomized pacing mode */
  humanMode: boolean;
  /** Random sell interval lower bound in ms (used when humanMode = true) */
  sellDelayMinMs: number;
  /** Random sell interval upper bound in ms (used when humanMode = true) */
  sellDelayMaxMs: number;
  /** Pause for a rest after every N listed items (0 disables) */
  batchRestEvery: number;
  /** Batch rest lower bound in seconds */
  batchRestMinSec: number;
  /** Batch rest upper bound in seconds */
  batchRestMaxSec: number;
  /** Auto-pause queue after N consecutive HTTP 429 rate limits (0 disables) */
  circuitBreakerMax429: number;
  /** Warn when planned price is below this % of lowest sell price (e.g. 70 = >30% discount; 0 disables) */
  lowPriceWarnPercent: number;
  /** Force rounding listing price to whole currency units (auto-enabled for JPY/KRW/IDR/etc.) */
  roundToWholeUnits: boolean;
  /** Optional manual override for exchange rate to CNY (0 = auto daily fetch) */
  manualFxRateToCny: number;
  skipModified: boolean;
  /** Threshold in minor currency units (e.g. 10000 = ¥100.00). 0 disables warning. */
  highValueThresholdCents: number;
  keepOneDuplicate: boolean;
  autoOpenOnInventory: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  strategy: 'lowest_sell_minus_1',
  customPriceMode: 'fixed_buyer',
  customFixedPriceCents: 100,
  customOffsetCents: -5,
  customPercent: 95,
  priceDelayMs: 1500,
  sellDelayMs: 1200,
  humanMode: true,
  sellDelayMinMs: 2200,
  sellDelayMaxMs: 5200,
  batchRestEvery: 20,
  batchRestMinSec: 30,
  batchRestMaxSec: 60,
  circuitBreakerMax429: 2,
  lowPriceWarnPercent: 70,
  roundToWholeUnits: false,
  manualFxRateToCny: 0,
  skipModified: true,
  highValueThresholdCents: 10000,
  keepOneDuplicate: false,
  autoOpenOnInventory: false,
};

export interface WalletFeeConfig {
  currency: number;
  currencyCode: string;
  country: string;
  steamFeePercent: number;
  publisherFeePercentDefault: number;
  feeMinimum: number;
  feeBase: number;
  currencySymbol: string;
  symbolPrefix: boolean;
  zeroDecimal: boolean;
  /** True when Steam global.js marks bWholeUnitsOnly (e.g. INR/RUB/JPY/KRW) */
  steamWholeUnitsHint: boolean;
  /** Whether g_rgWalletInfo was actually resolved from the Steam page (false = fallback) */
  walletDetected: boolean;
}

export interface ExchangeRateInfo {
  currencyCode: string;
  rateToCny: number;
  date: string;
  source: string;
  fetchedAt: number;
  isManual?: boolean;
}

export interface InventoryAssetItem {
  assetid: string;
  classid: string;
  instanceid: string;
  appid: number;
  contextid: string;
  amount: number;
  marketHashName: string;
  displayName: string;
  typeText: string;
  iconUrl: string;
  nameColor: string;
  commodity: boolean;
  publisherFeePercent: number;
  hasModifier: boolean;
  modifierHints: string[];
}

export interface MarketPriceQuote {
  /** Lowest current sell order (buyer pays) in minor currency units (cents). */
  lowestSellCents: number | null;
  /** Highest current buy order (buyer pays) in minor currency units (cents). */
  highestBuyCents: number | null;
  /** Median price from priceoverview if available, in minor currency units. */
  medianCents: number | null;
  volume?: string;
  source: 'histogram' | 'overview' | 'hybrid';
  fetchedAt: number;
  error?: string;
}

export interface ItemGroup {
  groupKey: string;
  appid: number;
  contextid: string;
  marketHashName: string;
  displayName: string;
  typeText: string;
  iconUrl: string;
  nameColor: string;
  commodity: boolean;
  publisherFeePercent: number;
  hasModifier: boolean;
  modifierHints: string[];
  assets: InventoryAssetItem[];
  /** Whether selected for batch listing */
  selected: boolean;
  /** Number of assets in this group to list (1..assets.length) */
  quantityToSell: number;
  /** Latest fetched market quote */
  quote: MarketPriceQuote | null;
  /** Price fetch status */
  priceStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** Optional manual override for buyer pays price (in minor units) */
  manualBuyerPriceCents: number | null;
  /** Optional user-entered cost price per item in CNY (RMB yuan), e.g. 1.0 */
  costPriceCny: number | null;
}

export interface CalculatedListingPrice {
  buyerPaysCents: number;
  sellerReceivesCents: number;
  steamFeeCents: number;
  publisherFeeCents: number;
  totalFeeCents: number;
}

export interface SellTaskResult {
  assetid: string;
  displayName: string;
  buyerPaysCents: number;
  sellerReceivesCents: number;
  status: 'listed' | 'needs_confirmation' | 'failed';
  message: string;
}

export interface SupportedGameTab {
  appid: number;
  name: string;
  shortName: string;
  defaultContextId: string;
}

export const FEATURED_GAMES: SupportedGameTab[] = [
  { appid: 730, name: 'Counter-Strike 2', shortName: 'CS2', defaultContextId: '2' },
  { appid: 570, name: 'Dota 2', shortName: 'Dota 2', defaultContextId: '2' },
  { appid: 440, name: 'Team Fortress 2', shortName: 'TF2', defaultContextId: '2' },
  { appid: 753, name: 'Steam 通用库存', shortName: 'Steam 通用', defaultContextId: '6' },
];

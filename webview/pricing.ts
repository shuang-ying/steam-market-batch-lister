import type {
  CalculatedListingPrice,
  CustomPriceMode,
  MarketPriceQuote,
  PricingStrategy,
  WalletFeeConfig,
} from './types';

export interface CustomPriceOptions {
  mode: CustomPriceMode;
  fixedPriceCents: number;
  offsetCents: number;
  percent: number;
}

export const CURRENCY_META: Record<
  number,
  { code: string; symbol: string; prefix: boolean; zeroDecimal?: boolean }
> = {
  1: { code: 'USD', symbol: '$', prefix: true },
  2: { code: 'GBP', symbol: '£', prefix: true },
  3: { code: 'EUR', symbol: '€', prefix: false },
  4: { code: 'CHF', symbol: 'CHF ', prefix: true },
  5: { code: 'RUB', symbol: ' pуб.', prefix: false },
  6: { code: 'PLN', symbol: ' zł', prefix: false },
  7: { code: 'BRL', symbol: 'R$ ', prefix: true },
  8: { code: 'JPY', symbol: '¥ ', prefix: true, zeroDecimal: true },
  9: { code: 'NOK', symbol: ' kr', prefix: false },
  10: { code: 'IDR', symbol: 'Rp ', prefix: true, zeroDecimal: true },
  11: { code: 'MYR', symbol: 'RM', prefix: true },
  12: { code: 'PHP', symbol: '₱', prefix: true },
  13: { code: 'SGD', symbol: 'S$', prefix: true },
  14: { code: 'THB', symbol: '฿', prefix: true },
  15: { code: 'VND', symbol: '₫', prefix: false, zeroDecimal: true },
  16: { code: 'KRW', symbol: '₩ ', prefix: true, zeroDecimal: true },
  17: { code: 'TRY', symbol: ' TL', prefix: false },
  18: { code: 'UAH', symbol: '₴', prefix: false },
  19: { code: 'MXN', symbol: 'Mex$ ', prefix: true },
  20: { code: 'CAD', symbol: 'CDN$ ', prefix: true },
  21: { code: 'AUD', symbol: 'A$ ', prefix: true },
  22: { code: 'NZD', symbol: 'NZ$ ', prefix: true },
  23: { code: 'CNY', symbol: '¥ ', prefix: true },
  24: { code: 'INR', symbol: '₹ ', prefix: true },
  25: { code: 'CLP', symbol: 'CLP$ ', prefix: true, zeroDecimal: true },
  26: { code: 'PEN', symbol: 'S/.', prefix: true },
  27: { code: 'COP', symbol: 'COL$ ', prefix: true, zeroDecimal: true },
  28: { code: 'ZAR', symbol: 'R ', prefix: true },
  29: { code: 'HKD', symbol: 'HK$ ', prefix: true },
  30: { code: 'TWD', symbol: 'NT$ ', prefix: true, zeroDecimal: true },
  31: { code: 'SAR', symbol: ' SR', prefix: false },
  32: { code: 'AED', symbol: ' AED', prefix: false },
  37: { code: 'KZT', symbol: '₸', prefix: false },
};

export function createWalletFeeConfig(rawWallet?: Record<string, unknown> | null): WalletFeeConfig {
  const currency = Number(rawWallet?.wallet_currency) || 23;
  const meta = CURRENCY_META[currency] || { code: 'CNY', symbol: '¥ ', prefix: true };
  const country = typeof rawWallet?.wallet_country === 'string' && rawWallet.wallet_country
    ? rawWallet.wallet_country
    : 'CN';

  const steamFeePercent = parseFloat(String(rawWallet?.wallet_fee_percent ?? '0.05'));
  const publisherFeePercentDefault = parseFloat(
    String(rawWallet?.wallet_publisher_fee_percent_default ?? '0.10'),
  );
  const feeMinimum = Math.max(1, parseInt(String(rawWallet?.wallet_fee_minimum ?? '1'), 10) || 1);
  const feeBase = Math.max(0, parseInt(String(rawWallet?.wallet_fee_base ?? '0'), 10) || 0);

  return {
    currency,
    country,
    steamFeePercent: Number.isFinite(steamFeePercent) ? steamFeePercent : 0.05,
    publisherFeePercentDefault: Number.isFinite(publisherFeePercentDefault)
      ? publisherFeePercentDefault
      : 0.1,
    feeMinimum,
    feeBase,
    currencySymbol: meta.symbol,
    symbolPrefix: meta.prefix,
    zeroDecimal: Boolean(meta.zeroDecimal),
  };
}

/**
 * Forward Steam Market fee calculation:
 * Given sellerReceivesCents, returns exact steamFee, publisherFee, and buyerPaysCents.
 * Matches Steam's economy_v2.js CalculateAmountToSendForDesiredReceivedAmount.
 */
export function calculateBuyerPaysFromSellerReceives(
  sellerReceivesCents: number,
  publisherFeePercent: number,
  wallet: WalletFeeConfig,
): CalculatedListingPrice {
  const received = Math.max(1, Math.floor(sellerReceivesCents));
  const steamFee = Math.floor(
    Math.max(received * wallet.steamFeePercent, wallet.feeMinimum) + wallet.feeBase,
  );
  const pubFee =
    publisherFeePercent > 0
      ? Math.floor(Math.max(received * publisherFeePercent, wallet.feeMinimum))
      : 0;
  const totalFee = steamFee + pubFee;
  return {
    buyerPaysCents: received + totalFee,
    sellerReceivesCents: received,
    steamFeeCents: steamFee,
    publisherFeeCents: pubFee,
    totalFeeCents: totalFee,
  };
}

/**
 * Minimum valid buyer-pays price (when seller receives the minimum unit).
 */
export function getMinimumBuyerPriceCents(
  publisherFeePercent: number,
  wallet: WalletFeeConfig,
): number {
  const minReceived = wallet.zeroDecimal ? Math.max(100, wallet.feeMinimum) : 1;
  return calculateBuyerPaysFromSellerReceives(minReceived, publisherFeePercent, wallet)
    .buyerPaysCents;
}

/**
 * Inverse Steam Market fee calculation:
 * Given desired buyerPaysCents, computes the maximum sellerReceivesCents such that
 * actualBuyerPays <= desiredBuyerPaysCents (falling back to minimum valid price if below minimum).
 * Matches Steam's economy_v2.js CalculateFeeAmount behavior including fee-gap handling.
 */
export function calculateSellerReceivesFromBuyerPays(
  desiredBuyerPaysCents: number,
  publisherFeePercent: number,
  wallet: WalletFeeConfig,
): CalculatedListingPrice {
  const minUnit = wallet.zeroDecimal ? Math.max(100, wallet.feeMinimum) : 1;
  const minCalc = calculateBuyerPaysFromSellerReceives(minUnit, publisherFeePercent, wallet);
  const target = Math.floor(desiredBuyerPaysCents);

  if (target <= minCalc.buyerPaysCents) {
    return minCalc;
  }

  const totalRate = wallet.steamFeePercent + (publisherFeePercent > 0 ? publisherFeePercent : 0);
  let estimated = Math.max(
    minUnit,
    Math.floor((target - wallet.feeBase) / (1 + totalRate)),
  );

  // Align to step for zero-decimal currencies if needed
  let current = calculateBuyerPaysFromSellerReceives(estimated, publisherFeePercent, wallet);

  // Step down if we overshot target
  let guard = 0;
  while (current.buyerPaysCents > target && estimated > minUnit && guard < 100) {
    estimated -= 1;
    current = calculateBuyerPaysFromSellerReceives(estimated, publisherFeePercent, wallet);
    guard += 1;
  }

  // Step up while next candidate still does not exceed target
  guard = 0;
  while (guard < 100) {
    const next = calculateBuyerPaysFromSellerReceives(estimated + 1, publisherFeePercent, wallet);
    if (next.buyerPaysCents <= target) {
      estimated += 1;
      current = next;
    } else {
      break;
    }
    guard += 1;
  }

  return current;
}

/**
 * Computes the target listing price for a given strategy and quote.
 * Returns null if the quote doesn't contain the required price for the selected strategy.
 */
export function resolveStrategyPrice(
  strategy: PricingStrategy,
  quote: MarketPriceQuote | null,
  manualBuyerPriceCents: number | null,
  publisherFeePercent: number,
  wallet: WalletFeeConfig,
  customOptions?: CustomPriceOptions,
): CalculatedListingPrice | null {
  if (
    manualBuyerPriceCents !== null &&
    Number.isFinite(manualBuyerPriceCents) &&
    manualBuyerPriceCents > 0
  ) {
    return calculateSellerReceivesFromBuyerPays(manualBuyerPriceCents, publisherFeePercent, wallet);
  }

  const step = wallet.zeroDecimal ? Math.max(100, wallet.feeMinimum) : 1;
  const minBuyer = getMinimumBuyerPriceCents(publisherFeePercent, wallet);

  if (strategy === 'custom' && customOptions) {
    switch (customOptions.mode) {
      case 'fixed_buyer': {
        if (!Number.isFinite(customOptions.fixedPriceCents) || customOptions.fixedPriceCents <= 0) {
          return null;
        }
        return calculateSellerReceivesFromBuyerPays(
          Math.max(minBuyer, Math.floor(customOptions.fixedPriceCents)),
          publisherFeePercent,
          wallet,
        );
      }
      case 'fixed_seller': {
        if (!Number.isFinite(customOptions.fixedPriceCents) || customOptions.fixedPriceCents <= 0) {
          return null;
        }
        const minSeller = wallet.zeroDecimal ? Math.max(100, wallet.feeMinimum) : 1;
        return calculateBuyerPaysFromSellerReceives(
          Math.max(minSeller, Math.floor(customOptions.fixedPriceCents)),
          publisherFeePercent,
          wallet,
        );
      }
      case 'offset_lowest_sell': {
        if (!quote || quote.lowestSellCents === null) return null;
        const target = Math.max(minBuyer, Math.round(quote.lowestSellCents + customOptions.offsetCents));
        return calculateSellerReceivesFromBuyerPays(target, publisherFeePercent, wallet);
      }
      case 'percent_lowest_sell': {
        if (!quote || quote.lowestSellCents === null) return null;
        if (!Number.isFinite(customOptions.percent) || customOptions.percent <= 0) return null;
        const scaled = Math.round((quote.lowestSellCents * customOptions.percent) / 100);
        const target = Math.max(minBuyer, scaled);
        return calculateSellerReceivesFromBuyerPays(target, publisherFeePercent, wallet);
      }
    }
  }

  if (!quote) {
    return null;
  }

  let targetBuyer: number | null = null;

  switch (strategy) {
    case 'lowest_sell':
      targetBuyer = quote.lowestSellCents;
      break;
    case 'lowest_sell_minus_1':
      if (quote.lowestSellCents !== null) {
        targetBuyer = Math.max(minBuyer, quote.lowestSellCents - step);
      }
      break;
    case 'highest_buy':
      targetBuyer = quote.highestBuyCents;
      break;
    case 'custom':
      return null;
  }

  if (targetBuyer === null || !Number.isFinite(targetBuyer) || targetBuyer <= 0) {
    return null;
  }

  return calculateSellerReceivesFromBuyerPays(targetBuyer, publisherFeePercent, wallet);
}

/**
 * Parses formatted Steam price strings like "¥ 0.28", "$1,234.56", "1.234,56€", "12,--€", "¥ 150"
 * into integer minor currency units (cents).
 */
export function parseSteamPriceToCents(priceStr: string | null | undefined): number | null {
  if (!priceStr || typeof priceStr !== 'string') {
    return null;
  }

  // Handle European "--" for ".00" (e.g. "12,--€"), then keep only the numeric core
  // so currency abbreviations with dots like "45,90 pуб." or "S/. 12.50" don't confuse decimal detection.
  const normalized = priceStr.trim().replace(/--/g, '00');
  const numericCore = normalized.replace(/^[^0-9]+|[^0-9]+$/g, '');
  const cleaned = numericCore.replace(/[^0-9.,]/g, '');
  if (!cleaned) {
    return null;
  }

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  let majorMinorNumber: number;

  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: whichever appears last is the decimal separator
    if (lastDot > lastComma) {
      majorMinorNumber = parseFloat(cleaned.replace(/,/g, ''));
    } else {
      majorMinorNumber = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    }
  } else if (lastComma !== -1) {
    const afterComma = cleaned.slice(lastComma + 1);
    if (afterComma.length === 2 || afterComma.length === 1) {
      // Decimal comma, e.g. "12,50" or "0,28"
      majorMinorNumber = parseFloat(cleaned.replace(',', '.'));
    } else {
      // Thousands separator, e.g. "1,250"
      majorMinorNumber = parseFloat(cleaned.replace(/,/g, ''));
    }
  } else if (lastDot !== -1) {
    const afterDot = cleaned.slice(lastDot + 1);
    if (afterDot.length === 3 && cleaned.indexOf('.') === lastDot && cleaned.length > 4) {
      // Ambiguous thousands separator like "1.250" (often IDR/EUR/CLP)
      majorMinorNumber = parseFloat(cleaned.replace(/\./g, ''));
    } else {
      majorMinorNumber = parseFloat(cleaned);
    }
  } else {
    majorMinorNumber = parseFloat(cleaned);
  }

  if (!Number.isFinite(majorMinorNumber) || majorMinorNumber < 0) {
    return null;
  }

  return Math.round(majorMinorNumber * 100);
}

/**
 * Format integer minor units (cents) for display.
 */
export function formatCents(cents: number | null | undefined, wallet: WalletFeeConfig): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return '--';
  }
  const value = wallet.zeroDecimal
    ? Math.round(cents / 100).toString()
    : (cents / 100).toFixed(2);
  return wallet.symbolPrefix
    ? `${wallet.currencySymbol}${value}`
    : `${value}${wallet.currencySymbol}`;
}

/**
 * Format cents as plain editable decimal input string (e.g. "0.28" or "150").
 */
export function centsToInputValue(cents: number | null | undefined, wallet: WalletFeeConfig): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return '';
  }
  return wallet.zeroDecimal ? Math.round(cents / 100).toString() : (cents / 100).toFixed(2);
}

/**
 * Parse plain user input string like "0.28" or "12.5" into integer cents.
 */
export function inputValueToCents(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, '.');
  if (!trimmed) {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return Math.round(num * 100);
}

/**
 * Parse signed numeric offset string like "-0.05" or "0.10" into integer cents.
 */
export function signedInputValueToCents(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, '.');
  if (!trimmed) {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Math.round(num * 100);
}

export function getCustomModeLabel(mode: CustomPriceMode): string {
  switch (mode) {
    case 'fixed_buyer':
      return '固定买家付';
    case 'fixed_seller':
      return '固定卖家实收';
    case 'offset_lowest_sell':
      return '最低卖价加减偏移';
    case 'percent_lowest_sell':
      return '最低卖价按比例';
  }
}

export function getStrategyLabel(strategy: PricingStrategy, customOptions?: CustomPriceOptions): string {
  switch (strategy) {
    case 'lowest_sell':
      return '最低卖价';
    case 'lowest_sell_minus_1':
      return '最低卖价 -0.01';
    case 'highest_buy':
      return '最高求购 (秒出)';
    case 'custom':
      return customOptions ? `自定义价格 (${getCustomModeLabel(customOptions.mode)})` : '自定义价格';
  }
}

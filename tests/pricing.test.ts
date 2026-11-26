import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectItemModifiers,
  extractMarketableAssets,
  extractMarketableAssetsFromApiPage,
  extractSteamSessionFromCookie,
  extractSteamVarsFromScriptText,
  groupInventoryAssets,
  type SteamInventoryObject,
} from '../webview/inventory.ts';
import {
  buildSteamMultisellUrl,
  checkAbnormalLowPrice,
  computeBatchRestMs,
  computeNextPriceDelayMs,
  computeNextSellDelayMs,
} from '../webview/pacing.ts';
import {
  calculateBuyerPaysFromSellerReceives,
  calculateSellerReceivesFromBuyerPays,
  createWalletFeeConfig,
  formatCents,
  parseSteamPriceToCents,
  resolveStrategyPrice,
} from '../webview/pricing.ts';

const CNY_WALLET = createWalletFeeConfig({
  wallet_currency: 23,
  wallet_country: 'CN',
  wallet_fee_percent: '0.05',
  wallet_publisher_fee_percent_default: '0.10',
  wallet_fee_minimum: '1',
  wallet_fee_base: '0',
});

test('Steam fee forward and inverse calculation matches Steam rules', () => {
  // Minimum price ¥0.03 -> seller receives ¥0.01 + ¥0.01 Steam + ¥0.01 Publisher
  const minCalc = calculateSellerReceivesFromBuyerPays(3, 0.1, CNY_WALLET);
  assert.equal(minCalc.sellerReceivesCents, 1);
  assert.equal(minCalc.steamFeeCents, 1);
  assert.equal(minCalc.publisherFeeCents, 1);
  assert.equal(minCalc.buyerPaysCents, 3);

  // ¥0.23 -> seller receives ¥0.20 + ¥0.01 Steam + ¥0.02 Publisher
  const calc23 = calculateSellerReceivesFromBuyerPays(23, 0.1, CNY_WALLET);
  assert.equal(calc23.sellerReceivesCents, 20);
  assert.equal(calc23.buyerPaysCents, 23);

  // ¥1.15 -> seller receives ¥1.00 + ¥0.05 + ¥0.10 = ¥1.15
  const calc115 = calculateSellerReceivesFromBuyerPays(115, 0.1, CNY_WALLET);
  assert.equal(calc115.sellerReceivesCents, 100);
  assert.equal(calc115.buyerPaysCents, 115);

  // Unreachable fee gap ¥1.14 -> must never exceed ¥1.14 (lands on ¥1.12, seller receives ¥0.99)
  const calc114 = calculateSellerReceivesFromBuyerPays(114, 0.1, CNY_WALLET);
  assert.ok(calc114.buyerPaysCents <= 114);
  assert.equal(calc114.sellerReceivesCents, 99);
  assert.equal(calc114.buyerPaysCents, 112);

  // Verify next cent above 99 indeed exceeds 114
  const nextAbove99 = calculateBuyerPaysFromSellerReceives(100, 0.1, CNY_WALLET);
  assert.equal(nextAbove99.buyerPaysCents, 115);
});

test('Pricing strategies: lowest_sell, lowest_sell_minus_1, highest_buy', () => {
  const quote = {
    lowestSellCents: 28,
    highestBuyCents: 25,
    medianCents: 27,
    source: 'histogram' as const,
    fetchedAt: Date.now(),
  };

  const s1 = resolveStrategyPrice('lowest_sell', quote, null, 0.1, CNY_WALLET);
  assert.ok(s1);
  assert.equal(s1.buyerPaysCents, 28);

  const s2 = resolveStrategyPrice('lowest_sell_minus_1', quote, null, 0.1, CNY_WALLET);
  assert.ok(s2);
  assert.equal(s2.buyerPaysCents, 27);

  const s3 = resolveStrategyPrice('highest_buy', quote, null, 0.1, CNY_WALLET);
  assert.ok(s3);
  assert.equal(s3.buyerPaysCents, 25);

  // Floor protection: lowest_sell_minus_1 on ¥0.03 stays at minimum ¥0.03
  const floorQuote = { ...quote, lowestSellCents: 3 };
  const floorPrice = resolveStrategyPrice('lowest_sell_minus_1', floorQuote, null, 0.1, CNY_WALLET);
  assert.ok(floorPrice);
  assert.equal(floorPrice.buyerPaysCents, 3);
  assert.equal(floorPrice.sellerReceivesCents, 1);

  // Manual override takes priority over strategy
  const manual = resolveStrategyPrice('highest_buy', quote, 50, 0.1, CNY_WALLET);
  assert.ok(manual);
  assert.equal(manual.buyerPaysCents, 50);

  // Missing buy order returns null instead of listing at 0
  const noBuyQuote = { ...quote, highestBuyCents: null };
  assert.equal(resolveStrategyPrice('highest_buy', noBuyQuote, null, 0.1, CNY_WALLET), null);
});

test('Custom pricing strategy supports fixed buyer, fixed seller, offset, and percent modes', () => {
  // 1. Fixed buyer price works even WITHOUT fetching market quote (quote = null)
  const fixedBuyer = resolveStrategyPrice('custom', null, null, 0.1, CNY_WALLET, {
    mode: 'fixed_buyer',
    fixedPriceCents: 115,
    offsetCents: 0,
    percent: 100,
  });
  assert.ok(fixedBuyer);
  assert.equal(fixedBuyer.buyerPaysCents, 115);
  assert.equal(fixedBuyer.sellerReceivesCents, 100);

  // 2. Fixed seller payout works without quote and adds exact Steam + publisher fee
  const fixedSeller = resolveStrategyPrice('custom', null, null, 0.1, CNY_WALLET, {
    mode: 'fixed_seller',
    fixedPriceCents: 100,
    offsetCents: 0,
    percent: 100,
  });
  assert.ok(fixedSeller);
  assert.equal(fixedSeller.sellerReceivesCents, 100);
  assert.equal(fixedSeller.buyerPaysCents, 115);

  const quote = {
    lowestSellCents: 200,
    highestBuyCents: 180,
    medianCents: 195,
    source: 'histogram' as const,
    fetchedAt: Date.now(),
  };

  // 3. Offset from lowest sell price (-0.05 -> ¥1.95)
  const offsetMinus = resolveStrategyPrice('custom', quote, null, 0.1, CNY_WALLET, {
    mode: 'offset_lowest_sell',
    fixedPriceCents: 100,
    offsetCents: -5,
    percent: 100,
  });
  assert.ok(offsetMinus);
  assert.ok(offsetMinus.buyerPaysCents <= 195);
  assert.ok(offsetMinus.buyerPaysCents >= 193);

  // Offset requires quote
  assert.equal(
    resolveStrategyPrice('custom', null, null, 0.1, CNY_WALLET, {
      mode: 'offset_lowest_sell',
      fixedPriceCents: 100,
      offsetCents: -5,
      percent: 100,
    }),
    null,
  );

  // 4. Percentage of lowest sell price (90% of ¥2.00 = ¥1.80)
  const pct90 = resolveStrategyPrice('custom', quote, null, 0.1, CNY_WALLET, {
    mode: 'percent_lowest_sell',
    fixedPriceCents: 100,
    offsetCents: 0,
    percent: 90,
  });
  assert.ok(pct90);
  assert.ok(pct90.buyerPaysCents <= 180);
  assert.ok(pct90.buyerPaysCents >= 178);
});

test('parseSteamPriceToCents handles multi-currency formats accurately', () => {
  assert.equal(parseSteamPriceToCents('¥ 0.28'), 28);
  assert.equal(parseSteamPriceToCents('¥ 1,234.56'), 123456);
  assert.equal(parseSteamPriceToCents('$12.34'), 1234);
  assert.equal(parseSteamPriceToCents('12,50€'), 1250);
  assert.equal(parseSteamPriceToCents('1.234,56€'), 123456);
  assert.equal(parseSteamPriceToCents('12,--€'), 1200);
  assert.equal(parseSteamPriceToCents('45,90 pуб.'), 4590);
  assert.equal(parseSteamPriceToCents('S/. 12.50'), 1250);
  assert.equal(parseSteamPriceToCents(''), null);
  assert.equal(formatCents(128, CNY_WALLET), '¥ 1.28');
});

test('CS2 / Dota 2 / TF2 modifier detection isolates valuable modified items', () => {
  const cs2StickerHints = detectItemModifiers(730, {
    descriptions: [{ value: '<div id="sticker_info">印花: Katowice 2014</div>' }],
    fraudwarnings: ['名称标签：“AK神枪”'],
  });
  assert.ok(cs2StickerHints.includes('含印花'));
  assert.ok(cs2StickerHints.includes('改名标签'));

  const dotaGemHints = detectItemModifiers(570, {
    descriptions: [{ value: '动能宝石: 破阵' }],
  });
  assert.ok(dotaGemHints.includes('含宝石/签名'));

  const tf2Hints = detectItemModifiers(440, {
    descriptions: [{ value: 'Killstreak: Specialized' }],
  });
  assert.ok(tf2Hints.includes('含涂色/部件/咒语'));
});

test('Steam 753 child inventory extraction and grouping keeps modified items separate', () => {
  const mockSteam753: SteamInventoryObject = {
    appid: 753,
    contextid: '6',
    m_rgAssets: {},
    m_rgChildInventories: {
      '6': {
        appid: 753,
        contextid: '6',
        m_rgAssets: {
          a1: {
            assetid: 'a1',
            appid: 753,
            contextid: '6',
            amount: '1',
            description: {
              marketable: 1,
              commodity: 1,
              market_hash_name: '730-Anarchist',
              market_name: 'Anarchist (集换式卡牌)',
              type: 'Counter-Strike 2 集换式卡牌',
            },
          },
          a2: {
            assetid: 'a2',
            appid: 753,
            contextid: '6',
            amount: '1',
            description: {
              marketable: 1,
              commodity: 1,
              market_hash_name: '730-Anarchist',
              market_name: 'Anarchist (集换式卡牌)',
              type: 'Counter-Strike 2 集换式卡牌',
            },
          },
          a3: {
            assetid: 'a3',
            appid: 753,
            contextid: '6',
            amount: '1',
            description: {
              marketable: 0,
              market_hash_name: 'Non-Marketable Gem',
              market_name: '不可出售物品',
            },
          },
        },
      },
    },
  };

  const { assets, totalScanned } = extractMarketableAssets(mockSteam753, CNY_WALLET);
  assert.equal(totalScanned, 3);
  assert.equal(assets.length, 2);

  const groups = groupInventoryAssets(assets);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].assets.length, 2);
  assert.equal(groups[0].contextid, '6');

  // Verify CS2 modified gun is split from plain gun with identical market_hash_name
  const cs2Inv: SteamInventoryObject = {
    appid: 730,
    contextid: '2',
    m_rgAssets: {
      g1: {
        assetid: 'g1',
        appid: 730,
        contextid: '2',
        description: {
          marketable: 1,
          market_hash_name: 'AK-47 | Redline (Field-Tested)',
          market_name: 'AK-47 | 红线 (久经沙场)',
        },
      },
      g2: {
        assetid: 'g2',
        appid: 730,
        contextid: '2',
        description: {
          marketable: 1,
          market_hash_name: 'AK-47 | Redline (Field-Tested)',
          market_name: 'AK-47 | 红线 (久经沙场)',
          descriptions: [{ value: '<div id="sticker_info">Sticker: Titan</div>' }],
        },
      },
    },
  };

  const cs2Extracted = extractMarketableAssets(cs2Inv, CNY_WALLET);
  const cs2Groups = groupInventoryAssets(cs2Extracted.assets);
  assert.equal(cs2Groups.length, 2);
  assert.equal(cs2Groups.filter((g) => g.hasModifier).length, 1);
  assert.equal(cs2Groups.filter((g) => !g.hasModifier).length, 1);
});

test('Human-like pacing delays, batch rest, low-price guard, and official multisell URL', () => {
  // Fixed mode returns exact sellDelayMs
  assert.equal(
    computeNextSellDelayMs({
      humanMode: false,
      sellDelayMs: 1200,
      sellDelayMinMs: 2200,
      sellDelayMaxMs: 5200,
    }),
    1200,
  );

  // Human mode stays within bounds (no hesitation when rng >= 0.12)
  const deterministicRng = () => 0.5;
  const midDelay = computeNextSellDelayMs(
    {
      humanMode: true,
      sellDelayMs: 1200,
      sellDelayMinMs: 2000,
      sellDelayMaxMs: 5000,
    },
    deterministicRng,
  );
  assert.equal(midDelay, 3500);

  // Price jitter respects ±35% around base
  const midPriceDelay = computeNextPriceDelayMs(
    { humanMode: true, priceDelayMs: 2000 },
    () => 0.5,
  );
  assert.equal(midPriceDelay, 2000);
  const lowPriceDelay = computeNextPriceDelayMs(
    { humanMode: true, priceDelayMs: 2000 },
    () => 0,
  );
  assert.equal(lowPriceDelay, 1300);

  // Batch rest stays within [minSec, maxSec]
  assert.equal(
    computeBatchRestMs({ batchRestMinSec: 30, batchRestMaxSec: 60 }, () => 0.5),
    45000,
  );

  // Abnormal low price guard catches >30% discount (<70%)
  const quote = {
    lowestSellCents: 1000,
    highestBuyCents: 900,
    medianCents: 980,
    source: 'histogram' as const,
    fetchedAt: Date.now(),
  };
  const warn = checkAbnormalLowPrice(600, quote, 70);
  assert.ok(warn);
  assert.equal(warn.ratioPercent, 60);
  assert.equal(checkAbnormalLowPrice(800, quote, 70), null);

  // Official Steam multisell URL builder
  const url = buildSteamMultisellUrl(730, '2', [
    { marketHashName: 'Revolution Case', quantity: 12 },
    { marketHashName: 'Kilowatt Case', quantity: 5 },
  ]);
  assert.equal(
    url,
    'https://steamcommunity.com/market/multisell?appid=730&contextid=2&items[]=Revolution%20Case&qty[]=12&items[]=Kilowatt%20Case&qty[]=5',
  );
});

test('Isolated-world script/cookie extraction and Inventory JSON API parser work reliably', () => {
  const sampleScript = `
    var g_steamID = "76561198012345678";
    var g_sessionID = "abcdef0123456789abcdef01";
    var g_bViewingOwnProfile = true;
    var g_rgWalletInfo = {"wallet_currency":23,"wallet_country":"CN","wallet_fee_percent":"0.05","wallet_publisher_fee_percent_default":"0.10","wallet_fee_minimum":"1"};
    var g_rgAppContextData = {"730":{"appid":730,"name":"Counter-Strike 2","rgContexts":{"2":{"id":"2","asset_count":42}}}};
  `;

  const parsed = extractSteamVarsFromScriptText(sampleScript);
  assert.equal(parsed.steamId, '76561198012345678');
  assert.equal(parsed.sessionId, 'abcdef0123456789abcdef01');
  assert.equal(parsed.viewingOwnProfile, true);
  assert.equal(parsed.walletInfo?.wallet_currency, 23);
  assert.equal(parsed.appContextData?.['730']?.name, 'Counter-Strike 2');

  assert.equal(
    extractSteamSessionFromCookie('timezoneOffset=28800,0; sessionid=deadbeef1234; steamCountry=CN'),
    'deadbeef1234',
  );

  const apiRes = extractMarketableAssetsFromApiPage(
    {
      success: 1,
      assets: [
        { appid: 730, contextid: '2', assetid: '1001', classid: 'c1', instanceid: '0', amount: '1' },
        { appid: 730, contextid: '2', assetid: '1002', classid: 'c2', instanceid: '0', amount: '1' },
      ],
      descriptions: [
        {
          classid: 'c1',
          instanceid: '0',
          marketable: 1,
          commodity: 1,
          market_hash_name: 'Revolution Case',
          market_name: '变革武器箱',
          type: '普通级 容器',
        },
        {
          classid: 'c2',
          instanceid: '0',
          marketable: 0,
          market_hash_name: 'Service Medal',
          market_name: '服役勋章',
        },
      ],
    },
    730,
    '2',
    CNY_WALLET,
  );

  assert.equal(apiRes.totalScanned, 2);
  assert.equal(apiRes.assets.length, 1);
  assert.equal(apiRes.assets[0].assetid, '1001');
  assert.equal(apiRes.assets[0].displayName, '变革武器箱');
  assert.equal(apiRes.assets[0].commodity, true);
});

import {
  FEATURED_GAMES,
  type InventoryAssetItem,
  type ItemGroup,
  type WalletFeeConfig,
} from './types';

export interface SteamDescriptionLine {
  type?: string;
  value?: string;
  name?: string;
}

export interface SteamItemDescription {
  appid?: number;
  classid?: string;
  instanceid?: string;
  marketable?: number | boolean;
  tradable?: number | boolean;
  commodity?: number | boolean;
  market_hash_name?: string;
  market_name?: string;
  name?: string;
  type?: string;
  icon_url?: string;
  icon_url_large?: string;
  name_color?: string;
  market_fee?: string | number;
  descriptions?: SteamDescriptionLine[];
  fraudwarnings?: string[];
  tags?: Array<{ category?: string; internal_name?: string; localized_tag_name?: string }>;
}

export interface SteamRawAsset {
  assetid?: string;
  id?: string;
  classid?: string;
  instanceid?: string;
  appid?: number;
  contextid?: string | number;
  amount?: string | number;
  description?: SteamItemDescription;
}

export interface SteamInventoryObject {
  appid?: number;
  contextid?: string | number;
  m_bFullyLoaded?: boolean;
  m_rgAssets?: Record<string, SteamRawAsset>;
  m_rgChildInventories?: Record<string, SteamInventoryObject>;
  LoadCompleteInventory?: () =>
    | Promise<unknown>
    | { done?: (cb: () => void) => { fail?: (cb: () => void) => void } };
}

export interface SteamAppContextEntry {
  appid?: number;
  name?: string;
  asset_count?: number;
  rgContexts?: Record<string, { id?: string; name?: string; asset_count?: number }>;
}

export interface DetectedGameTab {
  appid: number;
  name: string;
  shortName: string;
  countText?: string;
  active: boolean;
  featured: boolean;
}

export interface SteamPageWindow extends Window {
  g_ActiveInventory?: SteamInventoryObject;
  g_sessionID?: string;
  g_steamID?: string;
  g_bViewingOwnProfile?: boolean;
  g_rgWalletInfo?: Record<string, unknown>;
  g_rgAppContextData?: Record<string, SteamAppContextEntry>;
  UserYou?: { strSteamId?: string; GetSteamId?: () => string };
}

export interface ResolvedSteamPageContext {
  steamId: string | null;
  sessionId: string | null;
  viewingOwnProfile: boolean | null;
  walletInfo: Record<string, unknown> | null;
  appContextData: Record<string, SteamAppContextEntry> | null;
}

export function getSteamWindow(): SteamPageWindow {
  return window as unknown as SteamPageWindow;
}

/**
 * Extracts a JSON object assigned to a JS variable in inline script text,
 * e.g. `var g_rgWalletInfo = {"wallet_currency":23,...};`
 */
export function extractJsAssignedObject(
  scriptText: string,
  varName: string,
): Record<string, unknown> | null {
  const regex = new RegExp(`(?:var\\s+|let\\s+|const\\s+|window\\.)?\\b${varName}\\s*=\\s*\\{`);
  const match = regex.exec(scriptText);
  if (!match) return null;

  const startIdx = match.index + match[0].length - 1;
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = startIdx; i < scriptText.length; i += 1) {
    const ch = scriptText[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const jsonCandidate = scriptText.slice(startIdx, i + 1);
        try {
          const parsed = JSON.parse(jsonCandidate) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          return null;
        }
        return null;
      }
    }
  }

  return null;
}

export function extractSteamSessionFromCookie(cookieStr: string): string | null {
  const match = cookieStr.match(/(?:^|;\s*)sessionid=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function extractSteamVarsFromScriptText(scriptText: string): {
  steamId: string | null;
  sessionId: string | null;
  viewingOwnProfile: boolean | null;
  walletInfo: Record<string, unknown> | null;
  appContextData: Record<string, SteamAppContextEntry> | null;
} {
  let steamId: string | null = null;
  let sessionId: string | null = null;
  let viewingOwnProfile: boolean | null = null;

  const steamIdMatch =
    scriptText.match(/\bg_steamID\s*=\s*["'](\d{17})["']/) ||
    scriptText.match(/new\s+CUser\(\s*["'](\d{17})["']\s*\)/) ||
    scriptText.match(/"steamid"\s*:\s*"(\d{17})"/);
  if (steamIdMatch) {
    steamId = steamIdMatch[1];
  }

  const sessionMatch = scriptText.match(/\bg_sessionID\s*=\s*["']([^"']+)["']/);
  if (sessionMatch) {
    sessionId = sessionMatch[1];
  }

  const ownMatch = scriptText.match(/\bg_bViewingOwnProfile\s*=\s*(true|false)\b/);
  if (ownMatch) {
    viewingOwnProfile = ownMatch[1] === 'true';
  }

  const walletInfo = extractJsAssignedObject(scriptText, 'g_rgWalletInfo');
  const appContextData = extractJsAssignedObject(
    scriptText,
    'g_rgAppContextData',
  ) as Record<string, SteamAppContextEntry> | null;

  return {
    steamId,
    sessionId,
    viewingOwnProfile,
    walletInfo,
    appContextData,
  };
}

let cachedScriptContext: ResolvedSteamPageContext | null = null;

/**
 * Resolves Steam session, steamId, walletInfo, and appContextData reliably in BOTH
 * page main-world (Tampermonkey) AND Chromium/Millennium isolated worlds.
 */
export function resolveSteamPageContext(forceRefresh = false): ResolvedSteamPageContext {
  const win = getSteamWindow();

  if (forceRefresh) {
    cachedScriptContext = null;
  }

  let steamId: string | null =
    (typeof win.g_steamID === 'string' && /^\d{17}$/.test(win.g_steamID) ? win.g_steamID : null) ||
    (typeof win.UserYou?.strSteamId === 'string' && /^\d{17}$/.test(win.UserYou.strSteamId)
      ? win.UserYou.strSteamId
      : null);
  let sessionId: string | null =
    (typeof win.g_sessionID === 'string' && win.g_sessionID ? win.g_sessionID : null) ||
    extractSteamSessionFromCookie(document.cookie || '');
  let viewingOwnProfile: boolean | null =
    typeof win.g_bViewingOwnProfile === 'boolean' ? win.g_bViewingOwnProfile : null;
  let walletInfo: Record<string, unknown> | null =
    win.g_rgWalletInfo && typeof win.g_rgWalletInfo === 'object' ? win.g_rgWalletInfo : null;
  let appContextData: Record<string, SteamAppContextEntry> | null =
    win.g_rgAppContextData && typeof win.g_rgAppContextData === 'object'
      ? win.g_rgAppContextData
      : null;

  // Fallback: inspect inline <script> blocks (works in isolated worlds!)
  // IMPORTANT: never freeze partial null results — keep re-scanning until walletInfo/steamId/sessionId are found.
  if (!steamId || !sessionId || viewingOwnProfile === null || !walletInfo || !appContextData) {
    const cacheIncomplete =
      !cachedScriptContext ||
      !cachedScriptContext.steamId ||
      !cachedScriptContext.sessionId ||
      !cachedScriptContext.walletInfo ||
      !cachedScriptContext.appContextData;

    if (cacheIncomplete) {
      const merged: ResolvedSteamPageContext = {
        steamId: cachedScriptContext?.steamId ?? null,
        sessionId: cachedScriptContext?.sessionId ?? null,
        viewingOwnProfile: cachedScriptContext?.viewingOwnProfile ?? null,
        walletInfo: cachedScriptContext?.walletInfo ?? null,
        appContextData: cachedScriptContext?.appContextData ?? null,
      };
      const scripts = document.querySelectorAll('script:not([src])');
      scripts.forEach((el) => {
        const text = el.textContent || '';
        if (
          !text.includes('g_rgWalletInfo') &&
          !text.includes('g_rgAppContextData') &&
          !text.includes('g_steamID') &&
          !text.includes('g_sessionID') &&
          !text.includes('g_bViewingOwnProfile')
        ) {
          return;
        }
        const parsed = extractSteamVarsFromScriptText(text);
        if (!merged.steamId && parsed.steamId) merged.steamId = parsed.steamId;
        if (!merged.sessionId && parsed.sessionId) merged.sessionId = parsed.sessionId;
        if (merged.viewingOwnProfile === null && parsed.viewingOwnProfile !== null) {
          merged.viewingOwnProfile = parsed.viewingOwnProfile;
        }
        if (!merged.walletInfo && parsed.walletInfo) merged.walletInfo = parsed.walletInfo;
        if (!merged.appContextData && parsed.appContextData) {
          merged.appContextData = parsed.appContextData;
        }
      });

      // URL /profiles/<steamid>/inventory fallback
      if (!merged.steamId) {
        const urlMatch = window.location.pathname.match(/\/profiles\/(\d{17})\/inventory/i);
        if (urlMatch) merged.steamId = urlMatch[1];
      }

      // Profile link / data-miniprofile fallback in DOM
      if (!merged.steamId) {
        const profileLink = document.querySelector<HTMLAnchorElement>(
          '#global_actions a.user_avatar[href*="/profiles/"], .playerAvatar a[href*="/profiles/"]',
        );
        const linkMatch = profileLink?.href.match(/\/profiles\/(\d{17})/);
        if (linkMatch) merged.steamId = linkMatch[1];
      }

      cachedScriptContext = merged;
    }

    steamId = steamId || cachedScriptContext!.steamId;
    sessionId = sessionId || cachedScriptContext!.sessionId;
    if (viewingOwnProfile === null) viewingOwnProfile = cachedScriptContext!.viewingOwnProfile;
    walletInfo = walletInfo || cachedScriptContext!.walletInfo;
    appContextData = appContextData || cachedScriptContext!.appContextData;
  }

  return {
    steamId,
    sessionId,
    viewingOwnProfile,
    walletInfo,
    appContextData,
  };
}

/**
 * Detect special modifications on CS2 / Dota 2 / TF2 items (stickers, charms, name tags,
 * inscribed/kinetic/ethereal gems, TF2 spells/killstreaks/strange parts) so users don't
 * accidentally bulk-list valuable modified items at base floor price.
 */
export function detectItemModifiers(
  appid: number,
  description: SteamItemDescription | undefined,
): string[] {
  if (!description) {
    return [];
  }

  const hints = new Set<string>();

  if (Array.isArray(description.fraudwarnings) && description.fraudwarnings.length > 0) {
    for (const warning of description.fraudwarnings) {
      if (/name tag|名称标签|重命名/i.test(warning)) {
        hints.add('改名标签');
      } else if (warning.trim()) {
        hints.add('特殊提示');
      }
    }
  }

  const descLines = Array.isArray(description.descriptions) ? description.descriptions : [];
  for (const line of descLines) {
    const val = line?.value || '';
    if (!val) continue;

    if (appid === 730) {
      if (val.includes('sticker_info') || /印花[:：]|Sticker:/i.test(val)) {
        hints.add('含印花');
      }
      if (val.includes('keychain_info') || /挂件[:：]|Charm:/i.test(val)) {
        hints.add('含挂件');
      }
      if (/布章[:：]|Patch:/i.test(val)) {
        hints.add('含布章');
      }
    } else if (appid === 570) {
      if (
        /镶嵌|动能宝石|棱彩宝石|虚灵宝石|亲笔签名|Ethereal|Prismatic|Kinetic|Inscribed Gem|Autograph/i.test(
          val,
        )
      ) {
        hints.add('含宝石/签名');
      }
    } else if (appid === 440) {
      if (/Halloween:|万圣节|Strange Part|奇异部件|Killstreak|连杀|Painted:|已涂色/i.test(val)) {
        hints.add('含涂色/部件/咒语');
      }
    }
  }

  return Array.from(hints);
}

export function buildSteamIconUrl(iconPath?: string): string {
  if (!iconPath) {
    return '';
  }
  if (/^https?:\/\//i.test(iconPath)) {
    return iconPath;
  }
  return `https://community.fastly.steamstatic.com/economy/image/${iconPath}/96fx96f`;
}

function buildAssetItem(
  raw: SteamRawAsset,
  desc: SteamItemDescription,
  appid: number,
  contextid: string,
  wallet: WalletFeeConfig,
): InventoryAssetItem | null {
  const assetid = String(raw.assetid ?? raw.id ?? '');
  if (!assetid) return null;

  const isMarketable = desc.marketable === 1 || desc.marketable === true;
  if (!isMarketable) return null;

  const marketHashName = desc.market_hash_name || desc.market_name || desc.name;
  if (!marketHashName) return null;

  const displayName = desc.market_name || desc.name || marketHashName;
  const parsedFee =
    desc.market_fee !== undefined && desc.market_fee !== null && desc.market_fee !== ''
      ? parseFloat(String(desc.market_fee))
      : wallet.publisherFeePercentDefault;
  const publisherFeePercent = Number.isFinite(parsedFee)
    ? parsedFee
    : wallet.publisherFeePercentDefault;

  const modifierHints = detectItemModifiers(appid, desc);
  const amount = Math.max(1, parseInt(String(raw.amount ?? '1'), 10) || 1);

  return {
    assetid,
    classid: String(raw.classid ?? desc.classid ?? ''),
    instanceid: String(raw.instanceid ?? desc.instanceid ?? '0'),
    appid,
    contextid,
    amount,
    marketHashName,
    displayName,
    typeText: desc.type || '',
    iconUrl: buildSteamIconUrl(desc.icon_url || desc.icon_url_large),
    nameColor: desc.name_color ? `#${desc.name_color.replace(/^#/, '')}` : '#d2d2d2',
    commodity: desc.commodity === 1 || desc.commodity === true,
    publisherFeePercent,
    hasModifier: modifierHints.length > 0,
    modifierHints,
  };
}

/**
 * Pure extraction of marketable assets from Steam page `g_ActiveInventory` objects.
 */
export function extractMarketableAssets(
  rootInventory: SteamInventoryObject | null | undefined,
  wallet: WalletFeeConfig,
): { assets: InventoryAssetItem[]; totalScanned: number } {
  if (!rootInventory) {
    return { assets: [], totalScanned: 0 };
  }

  const inventoriesToScan: SteamInventoryObject[] = [rootInventory];
  if (
    rootInventory.m_rgChildInventories &&
    typeof rootInventory.m_rgChildInventories === 'object'
  ) {
    for (const child of Object.values(rootInventory.m_rgChildInventories)) {
      if (child && child !== rootInventory) {
        inventoriesToScan.push(child);
      }
    }
  }

  const seenAssetKeys = new Set<string>();
  const assets: InventoryAssetItem[] = [];
  let totalScanned = 0;

  for (const inv of inventoriesToScan) {
    const rawMap = inv.m_rgAssets;
    if (!rawMap || typeof rawMap !== 'object') {
      continue;
    }

    for (const raw of Object.values(rawMap)) {
      if (!raw || typeof raw !== 'object') continue;
      const assetid = String(raw.assetid ?? raw.id ?? '');
      if (!assetid) continue;

      const desc = raw.description;
      const appid = Number(raw.appid ?? desc?.appid ?? inv.appid ?? 0);
      const contextid = String(raw.contextid ?? inv.contextid ?? '');
      if (!appid || !contextid) continue;

      const uniqueKey = `${appid}:${contextid}:${assetid}`;
      if (seenAssetKeys.has(uniqueKey)) continue;
      seenAssetKeys.add(uniqueKey);
      totalScanned += 1;

      if (!desc) continue;
      const item = buildAssetItem(raw, desc, appid, contextid, wallet);
      if (item) assets.push(item);
    }
  }

  return { assets, totalScanned };
}

export interface SteamInventoryApiPage {
  success?: number | boolean;
  assets?: Array<{
    appid?: number;
    contextid?: string;
    assetid: string;
    classid: string;
    instanceid?: string;
    amount?: string | number;
  }>;
  descriptions?: SteamItemDescription[];
  more_items?: number | boolean;
  last_assetid?: string;
  total_inventory_count?: number;
}

/**
 * Pure parser for Steam's official `/inventory/{steamid}/{appid}/{contextid}` JSON response.
 */
export function extractMarketableAssetsFromApiPage(
  page: SteamInventoryApiPage,
  defaultAppId: number,
  defaultContextId: string,
  wallet: WalletFeeConfig,
): { assets: InventoryAssetItem[]; totalScanned: number } {
  const descMap = new Map<string, SteamItemDescription>();
  if (Array.isArray(page.descriptions)) {
    for (const d of page.descriptions) {
      const key = `${d.classid ?? ''}_${d.instanceid ?? '0'}`;
      descMap.set(key, d);
    }
  }

  const assets: InventoryAssetItem[] = [];
  let totalScanned = 0;

  if (Array.isArray(page.assets)) {
    for (const raw of page.assets) {
      totalScanned += 1;
      const descKey = `${raw.classid ?? ''}_${raw.instanceid ?? '0'}`;
      const desc = descMap.get(descKey) || descMap.get(`${raw.classid ?? ''}_0`);
      if (!desc) continue;

      const appid = Number(raw.appid ?? desc.appid ?? defaultAppId);
      const contextid = String(raw.contextid ?? defaultContextId);
      const item = buildAssetItem(raw, desc, appid, contextid, wallet);
      if (item) assets.push(item);
    }
  }

  return { assets, totalScanned };
}

/**
 * Group identical marketable assets by appid + contextid + marketHashName.
 * Items with special modifications (stickers, charms, name tags, gems, spells) are isolated
 * into individual groups so they are never accidentally bundled with plain floor items.
 */
export function groupInventoryAssets(
  assets: InventoryAssetItem[],
  options?: { keepOneDuplicate?: boolean; skipModified?: boolean },
): ItemGroup[] {
  const map = new Map<string, ItemGroup>();

  for (const asset of assets) {
    const groupKey = asset.hasModifier
      ? `${asset.appid}:${asset.contextid}:${asset.marketHashName}::mod:${asset.assetid}`
      : `${asset.appid}:${asset.contextid}:${asset.marketHashName}`;

    let group = map.get(groupKey);
    if (!group) {
      group = {
        groupKey,
        appid: asset.appid,
        contextid: asset.contextid,
        marketHashName: asset.marketHashName,
        displayName: asset.displayName,
        typeText: asset.typeText,
        iconUrl: asset.iconUrl,
        nameColor: asset.nameColor,
        commodity: asset.commodity,
        publisherFeePercent: asset.publisherFeePercent,
        hasModifier: asset.hasModifier,
        modifierHints: [...asset.modifierHints],
        assets: [],
        selected: false,
        quantityToSell: 1,
        quote: null,
        priceStatus: 'idle',
        manualBuyerPriceCents: null,
        costPriceCny: null,
      };
      map.set(groupKey, group);
    }

    group.assets.push(asset);
  }

  const groups = Array.from(map.values());

  for (const group of groups) {
    const maxSellable = options?.keepOneDuplicate
      ? Math.max(0, group.assets.length - 1)
      : group.assets.length;
    group.quantityToSell = Math.max(1, maxSellable || group.assets.length);
  }

  groups.sort((a, b) => {
    if (a.hasModifier !== b.hasModifier) {
      return a.hasModifier ? 1 : -1;
    }
    if (b.assets.length !== a.assets.length) {
      return b.assets.length - a.assets.length;
    }
    return a.displayName.localeCompare(b.displayName, 'zh-CN');
  });

  return groups;
}

function awaitSteamDeferred(result: unknown): Promise<void> {
  if (!result) return Promise.resolve();
  if (typeof (result as Promise<unknown>).then === 'function') {
    return (result as Promise<unknown>).then(
      () => undefined,
      () => undefined,
    );
  }
  if (typeof (result as { done?: unknown }).done === 'function') {
    return new Promise((resolve) => {
      const def = result as { done: (cb: () => void) => { fail?: (cb: () => void) => void } };
      const chained = def.done(() => resolve());
      if (chained && typeof chained.fail === 'function') {
        chained.fail(() => resolve());
      }
    });
  }
  return Promise.resolve();
}

export function getActiveAppIdFromPage(): number {
  const win = getSteamWindow();
  const fromGlobal = Number(win.g_ActiveInventory?.appid || 0);
  if (fromGlobal) return fromGlobal;

  const activeTab = document.querySelector<HTMLAnchorElement>(
    '.games_list_tab.active[id^="inventory_link_"]',
  );
  if (activeTab) {
    const m = activeTab.id.match(/^inventory_link_(\d+)$/);
    if (m) return Number(m[1]);
  }

  const hashMatch = window.location.hash.match(/^#(\d+)/);
  if (hashMatch) return Number(hashMatch[1]);

  const firstTab = document.querySelector<HTMLAnchorElement>(
    '.games_list_tab[id^="inventory_link_"]',
  );
  if (firstTab) {
    const m = firstTab.id.match(/^inventory_link_(\d+)$/);
    if (m) return Number(m[1]);
  }

  return 0;
}

function getContextIdsForApp(
  appid: number,
  appContextData: Record<string, SteamAppContextEntry> | null,
): string[] {
  const appEntry = appContextData?.[String(appid)];
  if (appEntry?.rgContexts && typeof appEntry.rgContexts === 'object') {
    const ids = Object.entries(appEntry.rgContexts)
      .filter(([, ctx]) => (ctx?.asset_count ?? 1) > 0)
      .map(([id, ctx]) => String(ctx?.id ?? id))
      .filter((id) => id !== '0');
    if (ids.length > 0) {
      // For Steam 753, prioritize context 6 (Community items: cards/emoticons/backgrounds)
      if (appid === 753 && ids.includes('6')) {
        return ['6'];
      }
      return ids;
    }
  }

  if (appid === 753) return ['6'];
  return ['2'];
}

async function fetchInventoryViaApi(
  steamId: string,
  appid: number,
  contextIds: string[],
  wallet: WalletFeeConfig,
): Promise<{ assets: InventoryAssetItem[]; totalScanned: number }> {
  const seenAssetKeys = new Set<string>();
  const allAssets: InventoryAssetItem[] = [];
  let totalScanned = 0;

  for (const contextid of contextIds) {
    let startAssetId: string | undefined;
    let pageCount = 0;

    while (pageCount < 25) {
      pageCount += 1;
      const params = new URLSearchParams({
        l: 'schinese',
        count: '2000',
      });
      if (startAssetId) {
        params.set('start_assetid', startAssetId);
      }

      const url = `https://steamcommunity.com/inventory/${steamId}/${appid}/${contextid}?${params.toString()}`;
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        res = await fetch(url, { method: 'GET', credentials: 'include' });
        if (res.status === 429 || res.status === 502 || res.status === 503) {
          await new Promise((r) => window.setTimeout(r, 2500 * (attempt + 1)));
          continue;
        }
        break;
      }

      if (!res || !res.ok) {
        if (res?.status === 429) {
          throw new Error('读取库存接口触发 Steam 429 限流，请稍等 1 分钟后重试');
        }
        throw new Error(`读取 Steam 库存接口失败 (HTTP ${res?.status ?? 'ERR'})`);
      }

      const data = (await res.json()) as SteamInventoryApiPage | null;
      if (!data) break;

      const parsed = extractMarketableAssetsFromApiPage(data, appid, contextid, wallet);
      totalScanned += parsed.totalScanned;
      for (const item of parsed.assets) {
        const key = `${item.appid}:${item.contextid}:${item.assetid}`;
        if (!seenAssetKeys.has(key)) {
          seenAssetKeys.add(key);
          allAssets.push(item);
        }
      }

      if (data.more_items && data.last_assetid) {
        startAssetId = data.last_assetid;
        await new Promise((r) => window.setTimeout(r, 400));
      } else {
        break;
      }
    }
  }

  return { assets: allAssets, totalScanned };
}

/**
 * Loads the active Steam inventory completely:
 * 1) Uses `window.g_ActiveInventory` directly when running in main world.
 * 2) Automatically falls back to Steam's same-origin `/inventory/{steamId}/{appid}/{contextid}` API
 *    when running inside Millennium's isolated WebKit world.
 */
export async function loadActiveSteamInventory(wallet: WalletFeeConfig): Promise<{
  appid: number;
  appName: string;
  assets: InventoryAssetItem[];
  totalScanned: number;
}> {
  const win = getSteamWindow();
  const ctx = resolveSteamPageContext();
  const activeInv = win.g_ActiveInventory;

  if (activeInv) {
    if (!activeInv.m_bFullyLoaded && typeof activeInv.LoadCompleteInventory === 'function') {
      await awaitSteamDeferred(activeInv.LoadCompleteInventory());
    }

    if (activeInv.m_rgChildInventories && typeof activeInv.m_rgChildInventories === 'object') {
      for (const child of Object.values(activeInv.m_rgChildInventories)) {
        if (child && !child.m_bFullyLoaded && typeof child.LoadCompleteInventory === 'function') {
          await awaitSteamDeferred(child.LoadCompleteInventory());
        }
      }
    }

    const appid = Number(activeInv.appid || getActiveAppIdFromPage());
    const featured = FEATURED_GAMES.find((g) => g.appid === appid);
    const appInfo = ctx.appContextData?.[String(appid)];
    const appName = featured?.shortName || appInfo?.name || `App ${appid}`;
    const { assets, totalScanned } = extractMarketableAssets(activeInv, wallet);
    return { appid, appName, assets, totalScanned };
  }

  // Isolated-world fallback: fetch directly via Steam's official same-origin inventory JSON API
  const appid = getActiveAppIdFromPage();
  if (!appid) {
    throw new Error('未检测到当前选中的游戏库存标签，请先点击一个游戏库存页后重试');
  }

  const steamId = ctx.steamId;
  if (!steamId) {
    throw new Error('未能识别当前账号的 SteamID，请刷新库存页面后重试');
  }

  const contextIds = getContextIdsForApp(appid, ctx.appContextData);
  const featured = FEATURED_GAMES.find((g) => g.appid === appid);
  const tabNameEl = document.querySelector(`#inventory_link_${appid} .game_name`);
  const appInfo = ctx.appContextData?.[String(appid)];
  const appName =
    featured?.shortName ||
    tabNameEl?.textContent?.trim() ||
    appInfo?.name ||
    `App ${appid}`;

  const { assets, totalScanned } = await fetchInventoryViaApi(steamId, appid, contextIds, wallet);
  return { appid, appName, assets, totalScanned };
}

/**
 * Detects all available game tabs on the current Steam inventory page.
 */
export function getAvailableGameTabs(): DetectedGameTab[] {
  const ctx = resolveSteamPageContext();
  const activeAppId = getActiveAppIdFromPage();
  const tabs: DetectedGameTab[] = [];
  const seen = new Set<number>();

  const tabElements = document.querySelectorAll<HTMLAnchorElement>(
    '.games_list_tab[id^="inventory_link_"]',
  );
  tabElements.forEach((el) => {
    const match = el.id.match(/^inventory_link_(\d+)$/);
    if (!match) return;
    const appid = Number(match[1]);
    if (!appid || seen.has(appid)) return;
    seen.add(appid);

    const featured = FEATURED_GAMES.find((g) => g.appid === appid);
    const nameEl = el.querySelector('.game_name');
    const countEl = el.querySelector('.games_list_tab_number');
    const domName =
      nameEl?.textContent?.trim() ||
      ctx.appContextData?.[String(appid)]?.name ||
      `App ${appid}`;

    tabs.push({
      appid,
      name: domName,
      shortName: featured ? featured.shortName : domName,
      countText: countEl?.textContent?.trim() || undefined,
      active: el.classList.contains('active') || appid === activeAppId,
      featured: Boolean(featured),
    });
  });

  const featuredOrder = new Map(FEATURED_GAMES.map((g, idx) => [g.appid, idx]));
  tabs.sort((a, b) => {
    const ai = featuredOrder.has(a.appid) ? featuredOrder.get(a.appid)! : 999;
    const bi = featuredOrder.has(b.appid) ? featuredOrder.get(b.appid)! : 999;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return tabs;
}

/**
 * Programmatically switch Steam's inventory tab and wait until the active tab updates
 * (works in both main world and isolated worlds).
 */
export async function switchInventoryTab(appid: number, timeoutMs = 8000): Promise<boolean> {
  if (getActiveAppIdFromPage() === appid) {
    return true;
  }

  const link = document.getElementById(`inventory_link_${appid}`);
  if (!link) {
    return false;
  }

  link.click();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getActiveAppIdFromPage() === appid) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return getActiveAppIdFromPage() === appid;
}

import {
  fetchDailyExchangeRateToCny,
  getSavedCostPriceCny,
  saveCostPriceCny,
} from './exchange-rate';
import {
  getActiveAppIdFromPage,
  getAvailableGameTabs,
  groupInventoryAssets,
  loadActiveSteamInventory,
  resolveSteamPageContext,
  switchInventoryTab,
  type DetectedGameTab,
} from './inventory';
import {
  clearMemoryQuoteCache,
  fetchMarketQuote,
  listItemOnMarket,
  sleepCountdownWithSkip,
  sleepWithAbort,
  SteamRateLimitError,
} from './market-api';
import {
  buildSteamMultisellUrl,
  checkAbnormalLowPrice,
  computeBatchRestMs,
  computeNextPriceDelayMs,
  computeNextSellDelayMs,
} from './pacing';
import {
  calculateBalanceRatio,
  centsToCnyYuan,
  centsToInputValue,
  createWalletFeeConfig,
  formatCents,
  formatCnyYuan,
  getStrategyLabel,
  inputValueToCents,
  resolveStrategyPrice,
  signedInputValueToCents,
  type CustomPriceOptions,
} from './pricing';
import { loadSettings, saveSettings } from './settings';
import { PLUGIN_STYLES } from './styles';
import type {
  CalculatedListingPrice,
  CustomPriceMode,
  ExchangeRateInfo,
  ItemGroup,
  PluginSettings,
  PricingStrategy,
  WalletFeeConfig,
} from './types';

interface LogEntry {
  time: string;
  level: 'info' | 'ok' | 'warn' | 'err';
  text: string;
}

interface FailedSellItem {
  groupKey: string;
  appid: number;
  contextid: string;
  assetid: string;
  amount: number;
  displayName: string;
  buyerPaysCents: number;
  sellerReceivesCents: number;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nowTimeStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export class BatchListerUI {
  private settings: PluginSettings | null = null;
  private wallet: WalletFeeConfig = createWalletFeeConfig(null);
  private fxRate: ExchangeRateInfo | null = null;
  private isLoadingFx = false;
  private groups: ItemGroup[] = [];
  private gameTabs: DetectedGameTab[] = [];
  private currentAppId = 0;
  private currentAppName = '未扫描';
  private totalScannedAssets = 0;
  private searchQuery = '';
  private logs: LogEntry[] = [];
  private failedQueue: FailedSellItem[] = [];

  private isOpen = false;
  private isScanning = false;
  private isRunningTask: 'none' | 'pricing' | 'selling' = 'none';
  private isPaused = false;
  private isResting = false;
  private skipCurrentRest = false;
  private abortController: AbortController | null = null;
  private progressCurrent = 0;
  private progressTotal = 0;
  private progressLabel = '';

  private backdropEl: HTMLDivElement | null = null;
  private modalEl: HTMLDivElement | null = null;
  private panelMounted = false;

  public async mount(): Promise<void> {
    if (this.panelMounted) return;
    this.panelMounted = true;

    this.injectStyles();
    const ctx = resolveSteamPageContext();
    this.wallet = createWalletFeeConfig(ctx.walletInfo);
    this.settings = await loadSettings();

    this.mountTriggerButtons();
    this.createPanelDom();
    this.observeGameTabChanges();

    if (this.settings.autoOpenOnInventory) {
      this.openPanel();
    }
  }

  private injectStyles(): void {
    if (document.getElementById('smbl-styles')) return;
    const style = document.createElement('style');
    style.id = 'smbl-styles';
    style.textContent = PLUGIN_STYLES;
    document.head.appendChild(style);
  }

  private mountTriggerButtons(): void {
    // 1. Floating button (always accessible regardless of Steam layout variations)
    if (!document.getElementById('smbl-fab-btn')) {
      const fab = document.createElement('button');
      fab.id = 'smbl-fab-btn';
      fab.type = 'button';
      fab.className = 'smbl-fab';
      fab.textContent = '⚡ 市场批量上架';
      fab.addEventListener('click', () => this.openPanel());
      document.body.appendChild(fab);
    }

    // 2. Inline toolbar button inside Steam's inventory filter bar when present
    if (!document.getElementById('smbl-inline-btn')) {
      const target =
        document.querySelector('.filter_ctn') ||
        document.querySelector('.inventory_page_left .filter_control_ctn') ||
        document.querySelector('.inventory_links');
      if (target) {
        const btn = document.createElement('button');
        btn.id = 'smbl-inline-btn';
        btn.type = 'button';
        btn.className = 'smbl-trigger-btn';
        btn.textContent = '⚡ 批量上架助手';
        btn.addEventListener('click', () => this.openPanel());
        target.appendChild(btn);
      }
    }
  }

  private observeGameTabChanges(): void {
    const gamesList = document.querySelector('.games_list_tabs');
    if (!gamesList) return;
    gamesList.addEventListener('click', () => {
      if (!this.isOpen || this.isRunningTask !== 'none') return;
      window.setTimeout(() => {
        const activeId = getActiveAppIdFromPage();
        if (activeId && activeId !== this.currentAppId) {
          void this.scanCurrentInventory();
        }
      }, 450);
    });
  }

  private createPanelDom(): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'smbl-backdrop';
    backdrop.id = 'smbl-backdrop';
    backdrop.innerHTML = `
      <div class="smbl-panel" role="dialog" aria-label="Steam 市场批量上架助手">
        <div class="smbl-header">
          <div class="smbl-title-wrap">
            <h2 class="smbl-title">⚡ Steam 市场批量上架助手</h2>
            <span class="smbl-badge" id="smbl-app-badge">等待扫描</span>
            <span class="smbl-badge" id="smbl-wallet-badge"></span>
            <span class="smbl-fx-badge" id="smbl-fx-badge" title="点击可手动设定自定义汇率（留空恢复每日自动查询）">💱 汇率加载中...</span>
            <button type="button" class="smbl-btn smbl-btn-ghost" id="smbl-fx-refresh-btn" title="强制刷新今日实时汇率" style="padding:2px 6px;font-size:11px;">↻</button>
          </div>
          <div class="smbl-header-actions">
            <button type="button" class="smbl-btn" id="smbl-rescan-btn">🔄 扫描当前库存</button>
            <button type="button" class="smbl-btn smbl-btn-ghost" id="smbl-close-btn">✕ 关闭</button>
          </div>
        </div>

        <div class="smbl-gamebar" id="smbl-gamebar"></div>

        <div class="smbl-toolbar">
          <input type="text" class="smbl-input smbl-search" id="smbl-search-input" placeholder="搜索物品名 / 英文名 / 类型..." />

          <button type="button" class="smbl-btn" id="smbl-sel-all-btn">全选</button>
          <button type="button" class="smbl-btn" id="smbl-sel-dup-btn">仅选重复</button>
          <button type="button" class="smbl-btn" id="smbl-sel-inv-btn">反选</button>
          <button type="button" class="smbl-btn" id="smbl-sel-none-btn">清空</button>

          <div class="smbl-strategy-group" id="smbl-strategy-group">
            <button type="button" class="smbl-strategy-btn" data-strategy="lowest_sell">最低卖价</button>
            <button type="button" class="smbl-strategy-btn" data-strategy="lowest_sell_minus_1">卖家减 0.01</button>
            <button type="button" class="smbl-strategy-btn" data-strategy="highest_buy">最高求购 (秒出)</button>
            <button type="button" class="smbl-strategy-btn" data-strategy="custom">自定义价格</button>
          </div>

          <button type="button" class="smbl-btn smbl-btn-primary" id="smbl-fetch-price-btn">📊 批量查价</button>
          <button type="button" class="smbl-btn" id="smbl-refresh-price-btn">↻ 强制刷新行情</button>
        </div>

        <div class="smbl-custom-bar" id="smbl-custom-bar">
          <strong>自定义定价：</strong>
          <select class="smbl-select" id="smbl-custom-mode">
            <option value="fixed_buyer">统一固定价（买家付 · 免查价直挂）</option>
            <option value="fixed_seller">统一固定价（卖家实收 · 免查价直挂）</option>
            <option value="offset_lowest_sell">最低卖价 ± 固定金额偏移</option>
            <option value="percent_lowest_sell">最低卖价 × 百分比(%)</option>
          </select>
          <label class="smbl-check-label" id="smbl-custom-val-label">
            <span id="smbl-custom-val-prefix">金额:</span>
            <input type="number" step="0.01" class="smbl-input" id="smbl-custom-val-input" style="width:92px;height:28px;" />
            <span id="smbl-custom-val-suffix">元</span>
          </label>
          <button type="button" class="smbl-btn" id="smbl-apply-custom-selected-btn" title="把当前自定义价写入已勾选行作为独立手动价，便于分批设不同价格">📌 应用到已选行</button>
          <button type="button" class="smbl-btn smbl-btn-ghost" id="smbl-clear-manual-btn">清除全部手动价</button>
          <span class="smbl-custom-hint" id="smbl-custom-hint"></span>
        </div>

        <div class="smbl-settings-row">
          <label class="smbl-check-label" title="模拟真实玩家操作节奏：随机区间间隔 + 偶尔微停顿 + 分批自动休眠 + 429 熔断保护">
            <input type="checkbox" id="smbl-opt-human-mode" />
            <strong style="color:#86efac;">🛡 拟真防风控</strong>
          </label>
          <span id="smbl-human-range-wrap" style="display:inline-flex;align-items:center;gap:5px;">
            随机上架(ms):
            <input type="number" min="800" max="30000" step="200" class="smbl-mini-input" id="smbl-opt-sell-min" />
            ~
            <input type="number" min="1000" max="60000" step="200" class="smbl-mini-input" id="smbl-opt-sell-max" />
            ｜每
            <input type="number" min="0" max="500" step="5" class="smbl-mini-input" style="width:48px;" id="smbl-opt-rest-every" />
            件休眠
            <input type="number" min="5" max="600" step="5" class="smbl-mini-input" style="width:48px;" id="smbl-opt-rest-min" />
            ~
            <input type="number" min="5" max="600" step="5" class="smbl-mini-input" style="width:48px;" id="smbl-opt-rest-max" />s
          </span>
          <label class="smbl-check-label" id="smbl-fixed-sell-wrap">
            上架间隔(ms):
            <input type="number" min="500" max="10000" step="100" class="smbl-mini-input" id="smbl-opt-sell-delay" />
          </label>
          <label class="smbl-check-label">
            查价间隔(ms):
            <input type="number" min="500" max="10000" step="100" class="smbl-mini-input" id="smbl-opt-price-delay" />
          </label>
          <label class="smbl-check-label">
            <input type="checkbox" id="smbl-opt-skip-mod" />
            跳过印花/改名/宝石
          </label>
          <label class="smbl-check-label">
            <input type="checkbox" id="smbl-opt-keep-one" />
            保留 1 件
          </label>
          <label class="smbl-check-label">
            高价提醒(元):
            <input type="number" min="0" step="10" class="smbl-mini-input" style="width:58px;" id="smbl-opt-threshold" />
          </label>
          <label class="smbl-check-label" title="上架价低于市场最低卖价的该百分比时标红拦截提醒（0 关闭）">
            低价警告(&lt;%):
            <input type="number" min="0" max="95" step="5" class="smbl-mini-input" style="width:50px;" id="smbl-opt-low-warn" />
          </label>
          <label class="smbl-check-label" title="将提交给 Steam 的实收价对齐到整数货币单位（如卢比/卢布去小数，避免部分地区小数取整误差）">
            <input type="checkbox" id="smbl-opt-whole-units" />
            整数上架
          </label>
        </div>

        <div class="smbl-body">
          <div class="smbl-table-wrap">
            <table class="smbl-table">
              <thead>
                <tr>
                  <th style="width: 34px; text-align: center;">选</th>
                  <th>物品名称（可上架）</th>
                  <th style="width: 104px;">上架 / 库存</th>
                  <th style="width: 82px;">最低卖价</th>
                  <th style="width: 82px;">最高求购</th>
                  <th style="width: 116px;">买家付(上架价)</th>
                  <th style="width: 92px;">预计实收</th>
                  <th style="width: 84px;">成本价(¥)</th>
                  <th style="width: 66px;">余额率</th>
                  <th style="width: 48px; text-align: center;">查价</th>
                </tr>
              </thead>
              <tbody id="smbl-tbody"></tbody>
            </table>
          </div>
          <aside class="smbl-log-pane">
            <div class="smbl-log-header">
              <span>运行日志</span>
              <button type="button" class="smbl-btn smbl-btn-ghost" id="smbl-clear-log-btn" style="padding:2px 6px;font-size:11px;">清空</button>
            </div>
            <div class="smbl-log-list" id="smbl-log-list"></div>
          </aside>
        </div>

        <div class="smbl-footer">
          <div class="smbl-progress-wrap" id="smbl-progress-wrap">
            <div class="smbl-progress-text">
              <span id="smbl-progress-label">准备中...</span>
              <span id="smbl-progress-count">0 / 0</span>
            </div>
            <div class="smbl-progress-bar">
              <div class="smbl-progress-fill" id="smbl-progress-fill"></div>
            </div>
          </div>

          <div class="smbl-summary" id="smbl-summary"></div>

          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button type="button" class="smbl-btn" id="smbl-multisell-btn" title="针对 CS2 箱子/胶囊、集换式卡牌等同类大宗物品，打开 Steam 官方原生批量出售页（单次请求，零限流风险）">📦 官方批量出售(大宗)</button>
            <button type="button" class="smbl-btn" id="smbl-retry-failed-btn" style="display:none;">🔁 重试失败项</button>
            <button type="button" class="smbl-btn" id="smbl-skip-rest-btn" style="display:none;">⏭ 跳过休眠</button>
            <button type="button" class="smbl-btn" id="smbl-pause-btn" style="display:none;">⏸ 暂停</button>
            <button type="button" class="smbl-btn smbl-btn-danger" id="smbl-stop-btn" style="display:none;">⏹ 停止</button>
            <button type="button" class="smbl-btn smbl-btn-success" id="smbl-start-sell-btn">🚀 确认批量上架</button>
          </div>
        </div>
      </div>
    `;

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && this.isRunningTask === 'none') {
        this.closePanel();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'smbl-modal-overlay';
    modal.id = 'smbl-confirm-modal';
    modal.innerHTML = `
      <div class="smbl-modal" role="alertdialog" aria-label="确认批量上架">
        <div class="smbl-modal-head">确认批量上架预览</div>
        <div class="smbl-modal-body" id="smbl-modal-body"></div>
        <div class="smbl-modal-foot">
          <button type="button" class="smbl-btn" id="smbl-modal-cancel">取消</button>
          <button type="button" class="smbl-btn smbl-btn-success" id="smbl-modal-confirm">确认开始上架</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    this.backdropEl = backdrop;
    this.modalEl = modal;

    this.bindPanelEvents();
    this.syncSettingsControls();
    this.renderWalletBadge();
    this.renderAll();
  }

  private bindPanelEvents(): void {
    const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

    $<HTMLButtonElement>('smbl-close-btn').addEventListener('click', () => this.closePanel());
    $<HTMLButtonElement>('smbl-rescan-btn').addEventListener('click', () => {
      void this.scanCurrentInventory();
    });

    $<HTMLButtonElement>('smbl-fx-refresh-btn').addEventListener('click', () => {
      if (this.settings && this.settings.manualFxRateToCny > 0) {
        this.settings.manualFxRateToCny = 0;
        void saveSettings(this.settings);
      }
      void this.refreshExchangeRate(true);
    });

    $<HTMLSpanElement>('smbl-fx-badge').addEventListener('click', () => {
      if (!this.settings || this.wallet.currencyCode === 'CNY') return;
      const curText = this.fxRate ? String(this.fxRate.rateToCny) : '';
      const input = window.prompt(
        `输入自定义汇率（1 ${this.wallet.currencyCode} = ? 人民币 CNY），留空并确定则恢复每日自动查询：`,
        this.settings.manualFxRateToCny > 0 ? String(this.settings.manualFxRateToCny) : curText,
      );
      if (input === null) return;
      const trimmed = input.trim();
      if (!trimmed) {
        this.settings.manualFxRateToCny = 0;
        void saveSettings(this.settings);
        void this.refreshExchangeRate(false);
        return;
      }
      const val = Number(trimmed);
      if (Number.isFinite(val) && val > 0 && val <= 1000) {
        this.settings.manualFxRateToCny = val;
        void saveSettings(this.settings);
        void this.refreshExchangeRate(false);
      } else {
        this.addLog('warn', '输入的汇率格式无效，请填写大于 0 的数字');
      }
    });

    $<HTMLInputElement>('smbl-search-input').addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderTable();
      this.renderSummary();
    });

    $<HTMLButtonElement>('smbl-sel-all-btn').addEventListener('click', () => this.selectFiltered('all'));
    $<HTMLButtonElement>('smbl-sel-dup-btn').addEventListener('click', () => this.selectFiltered('duplicates'));
    $<HTMLButtonElement>('smbl-sel-inv-btn').addEventListener('click', () => this.selectFiltered('invert'));
    $<HTMLButtonElement>('smbl-sel-none-btn').addEventListener('click', () => this.selectFiltered('none'));

    const strategyGroup = $<HTMLDivElement>('smbl-strategy-group');
    strategyGroup.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-strategy]');
      if (!btn || !this.settings) return;
      const strategy = btn.dataset.strategy as PricingStrategy;
      if (strategy === this.settings.strategy) return;
      this.settings.strategy = strategy;
      void saveSettings(this.settings);
      this.addLog('info', `已切换定价策略：${getStrategyLabel(strategy, this.getCustomPriceOptions())}`);
      this.syncSettingsControls();
      this.renderTable();
      this.renderSummary();
    });

    $<HTMLSelectElement>('smbl-custom-mode').addEventListener('change', (e) => {
      if (!this.settings) return;
      this.settings.customPriceMode = (e.target as HTMLSelectElement).value as CustomPriceMode;
      void saveSettings(this.settings);
      this.syncSettingsControls();
      this.renderTable();
      this.renderSummary();
    });

    const onCustomValChanged = (e: Event) => {
      if (!this.settings) return;
      const raw = (e.target as HTMLInputElement).value;
      const mode = this.settings.customPriceMode;
      if (mode === 'fixed_buyer' || mode === 'fixed_seller') {
        const cents = inputValueToCents(raw);
        if (cents !== null) {
          this.settings.customFixedPriceCents = cents;
          void saveSettings(this.settings);
        }
      } else if (mode === 'offset_lowest_sell') {
        const cents = signedInputValueToCents(raw);
        if (cents !== null) {
          this.settings.customOffsetCents = cents;
          void saveSettings(this.settings);
        }
      } else if (mode === 'percent_lowest_sell') {
        const pct = Math.round(Number(raw));
        if (Number.isFinite(pct) && pct >= 10 && pct <= 500) {
          this.settings.customPercent = pct;
          void saveSettings(this.settings);
        }
      }
      this.syncSettingsControls();
      this.renderTable();
      this.renderSummary();
    };
    const customValInputEl = $<HTMLInputElement>('smbl-custom-val-input');
    customValInputEl.addEventListener('input', onCustomValChanged);
    customValInputEl.addEventListener('change', onCustomValChanged);

    $<HTMLButtonElement>('smbl-apply-custom-selected-btn').addEventListener('click', () => {
      if (!this.settings) return;
      const selected = this.groups.filter((g) => g.selected);
      if (selected.length === 0) {
        this.addLog('warn', '请先勾选要应用自定义价格的物品');
        return;
      }
      let applied = 0;
      let skipped = 0;
      const opts = this.getCustomPriceOptions();
      for (const g of selected) {
        const calc = resolveStrategyPrice('custom', g.quote, null, g.publisherFeePercent, this.wallet, opts);
        if (calc) {
          g.manualBuyerPriceCents = calc.buyerPaysCents;
          applied += 1;
        } else {
          skipped += 1;
        }
      }
      this.addLog(
        applied > 0 ? 'ok' : 'warn',
        `已将自定义价格锁定到 ${applied} 组选中物品${skipped > 0 ? `（${skipped} 组缺行情已跳过）` : ''}`,
      );
      this.renderTable();
      this.renderSummary();
    });

    $<HTMLButtonElement>('smbl-clear-manual-btn').addEventListener('click', () => {
      let cleared = 0;
      for (const g of this.groups) {
        if (g.manualBuyerPriceCents !== null) {
          g.manualBuyerPriceCents = null;
          cleared += 1;
        }
      }
      this.addLog('info', cleared > 0 ? `已清除 ${cleared} 组手动自定义价` : '当前没有手动改价项');
      this.renderTable();
      this.renderSummary();
    });

    $<HTMLButtonElement>('smbl-fetch-price-btn').addEventListener('click', () => {
      void this.runBatchPriceFetch(false);
    });
    $<HTMLButtonElement>('smbl-refresh-price-btn').addEventListener('click', () => {
      clearMemoryQuoteCache();
      void this.runBatchPriceFetch(true);
    });

    $<HTMLInputElement>('smbl-opt-human-mode').addEventListener('change', (e) => {
      if (!this.settings) return;
      this.settings.humanMode = (e.target as HTMLInputElement).checked;
      void saveSettings(this.settings);
      this.syncSettingsControls();
      this.addLog(
        'info',
        this.settings.humanMode
          ? '已开启「🛡 拟真防风控」：随机延迟 + 分批休眠 + 429 熔断保护'
          : '已切换为固定间隔模式（请注意避免触发 Steam 429 限流）',
      );
    });

    $<HTMLInputElement>('smbl-opt-sell-min').addEventListener('change', (e) => {
      if (!this.settings) return;
      const ms = Math.max(800, Math.min(30000, parseInt((e.target as HTMLInputElement).value, 10) || 2200));
      this.settings.sellDelayMinMs = ms;
      if (this.settings.sellDelayMaxMs < ms) {
        this.settings.sellDelayMaxMs = ms;
      }
      void saveSettings(this.settings);
      this.syncSettingsControls();
    });

    $<HTMLInputElement>('smbl-opt-sell-max').addEventListener('change', (e) => {
      if (!this.settings) return;
      const ms = Math.max(1000, Math.min(60000, parseInt((e.target as HTMLInputElement).value, 10) || 5200));
      this.settings.sellDelayMaxMs = Math.max(ms, this.settings.sellDelayMinMs);
      void saveSettings(this.settings);
      this.syncSettingsControls();
    });

    $<HTMLInputElement>('smbl-opt-rest-every').addEventListener('change', (e) => {
      if (!this.settings) return;
      const n = Math.max(0, Math.min(500, parseInt((e.target as HTMLInputElement).value, 10) || 0));
      this.settings.batchRestEvery = n;
      (e.target as HTMLInputElement).value = String(n);
      void saveSettings(this.settings);
    });

    $<HTMLInputElement>('smbl-opt-rest-min').addEventListener('change', (e) => {
      if (!this.settings) return;
      const sec = Math.max(5, Math.min(600, parseInt((e.target as HTMLInputElement).value, 10) || 30));
      this.settings.batchRestMinSec = sec;
      if (this.settings.batchRestMaxSec < sec) {
        this.settings.batchRestMaxSec = sec;
      }
      void saveSettings(this.settings);
      this.syncSettingsControls();
    });

    $<HTMLInputElement>('smbl-opt-rest-max').addEventListener('change', (e) => {
      if (!this.settings) return;
      const sec = Math.max(5, Math.min(600, parseInt((e.target as HTMLInputElement).value, 10) || 60));
      this.settings.batchRestMaxSec = Math.max(sec, this.settings.batchRestMinSec);
      void saveSettings(this.settings);
      this.syncSettingsControls();
    });

    $<HTMLInputElement>('smbl-opt-low-warn').addEventListener('change', (e) => {
      if (!this.settings) return;
      const pct = Math.max(0, Math.min(95, parseInt((e.target as HTMLInputElement).value, 10) || 0));
      this.settings.lowPriceWarnPercent = pct;
      (e.target as HTMLInputElement).value = String(pct);
      void saveSettings(this.settings);
      this.renderTable();
    });

    $<HTMLInputElement>('smbl-opt-whole-units').addEventListener('change', (e) => {
      if (!this.settings) return;
      this.settings.roundToWholeUnits = (e.target as HTMLInputElement).checked;
      void saveSettings(this.settings);
      this.syncSettingsControls();
      this.renderTable();
      this.renderSummary();
    });

    $<HTMLInputElement>('smbl-opt-skip-mod').addEventListener('change', (e) => {
      if (!this.settings) return;
      this.settings.skipModified = (e.target as HTMLInputElement).checked;
      void saveSettings(this.settings);
    });

    $<HTMLInputElement>('smbl-opt-keep-one').addEventListener('change', (e) => {
      if (!this.settings) return;
      this.settings.keepOneDuplicate = (e.target as HTMLInputElement).checked;
      void saveSettings(this.settings);
      this.applyKeepOneToGroups();
      this.renderTable();
      this.renderSummary();
    });

    $<HTMLInputElement>('smbl-opt-threshold').addEventListener('change', (e) => {
      if (!this.settings) return;
      const major = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
      this.settings.highValueThresholdCents = Math.round(major * 100);
      void saveSettings(this.settings);
      this.renderTable();
    });

    $<HTMLInputElement>('smbl-opt-price-delay').addEventListener('change', (e) => {
      if (!this.settings) return;
      const ms = Math.max(500, Math.min(10000, parseInt((e.target as HTMLInputElement).value, 10) || 1500));
      this.settings.priceDelayMs = ms;
      (e.target as HTMLInputElement).value = String(ms);
      void saveSettings(this.settings);
    });

    $<HTMLInputElement>('smbl-opt-sell-delay').addEventListener('change', (e) => {
      if (!this.settings) return;
      const ms = Math.max(500, Math.min(10000, parseInt((e.target as HTMLInputElement).value, 10) || 1200));
      this.settings.sellDelayMs = ms;
      (e.target as HTMLInputElement).value = String(ms);
      void saveSettings(this.settings);
    });

    $<HTMLButtonElement>('smbl-clear-log-btn').addEventListener('click', () => {
      this.logs = [];
      this.renderLogs();
    });

    $<HTMLButtonElement>('smbl-multisell-btn').addEventListener('click', () => {
      this.openOfficialMultisell();
    });

    $<HTMLButtonElement>('smbl-skip-rest-btn').addEventListener('click', () => {
      if (this.isResting) {
        this.skipCurrentRest = true;
        this.addLog('info', '已手动跳过本次休眠，继续上架...');
      }
    });

    $<HTMLButtonElement>('smbl-pause-btn').addEventListener('click', () => {
      this.isPaused = !this.isPaused;
      this.addLog('warn', this.isPaused ? '任务已暂停，点击“继续”恢复' : '任务已继续');
      this.renderTaskControls();
    });

    $<HTMLButtonElement>('smbl-stop-btn').addEventListener('click', () => {
      if (this.abortController) {
        this.abortController.abort();
      }
      this.isPaused = false;
      this.addLog('warn', '正在停止当前任务...');
    });

    $<HTMLButtonElement>('smbl-start-sell-btn').addEventListener('click', () => {
      this.openSellConfirmationModal();
    });

    $<HTMLButtonElement>('smbl-retry-failed-btn').addEventListener('click', () => {
      void this.runRetryFailedQueue();
    });

    $<HTMLButtonElement>('smbl-modal-cancel').addEventListener('click', () => {
      this.modalEl?.classList.remove('smbl-open');
    });

    $<HTMLButtonElement>('smbl-modal-confirm').addEventListener('click', () => {
      this.modalEl?.classList.remove('smbl-open');
      void this.runBatchSell();
    });

    // Delegated table interactions
    const tbody = $<HTMLTableSectionElement>('smbl-tbody');
    tbody.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const tr = target.closest<HTMLTableRowElement>('tr[data-group-key]');
      if (!tr) return;
      const key = tr.dataset.groupKey!;
      const group = this.groups.find((g) => g.groupKey === key);
      if (!group) return;

      if (target.classList.contains('smbl-row-check')) {
        group.selected = target.checked;
        tr.classList.toggle('smbl-row-selected', group.selected);
        this.renderSummary();
      } else if (target.classList.contains('smbl-qty-input')) {
        const val = Math.max(1, Math.min(group.assets.length, parseInt(target.value, 10) || 1));
        group.quantityToSell = val;
        target.value = String(val);
        this.renderSummary();
      } else if (target.classList.contains('smbl-price-input')) {
        const cents = inputValueToCents(target.value);
        group.manualBuyerPriceCents = cents;
        this.renderTable();
        this.renderSummary();
      } else if (target.classList.contains('smbl-cost-input')) {
        const raw = target.value.trim().replace(/,/g, '.');
        const num = raw ? Number(raw) : NaN;
        const costCny = Number.isFinite(num) && num > 0 ? num : null;
        group.costPriceCny = costCny;
        saveCostPriceCny(group.appid, group.marketHashName, costCny);
        // Sync identical marketHashName groups (e.g. split modified copies)
        for (const other of this.groups) {
          if (other !== group && other.appid === group.appid && other.marketHashName === group.marketHashName) {
            other.costPriceCny = costCny;
          }
        }
        this.renderTable();
        this.renderSummary();
      }
    });

    tbody.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      if (!btn) return;
      const tr = btn.closest<HTMLTableRowElement>('tr[data-group-key]');
      if (!tr) return;
      const group = this.groups.find((g) => g.groupKey === tr.dataset.groupKey);
      if (!group) return;

      if (btn.dataset.action === 'fetch-one') {
        void this.fetchSingleGroupPrice(group, true);
      } else if (btn.dataset.action === 'reset-manual') {
        group.manualBuyerPriceCents = null;
        this.renderTable();
        this.renderSummary();
      }
    });

    // Delegated game tab switch
    $<HTMLDivElement>('smbl-gamebar').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-appid]');
      if (!btn || this.isRunningTask !== 'none' || this.isScanning) return;
      const appid = Number(btn.dataset.appid);
      if (!appid) return;
      void this.handleSwitchGameTab(appid);
    });
  }

  public openPanel(): void {
    const ctx = resolveSteamPageContext();
    if (ctx.viewingOwnProfile === false) {
      window.alert('当前正在浏览他人库存，无法执行批量上架操作。请打开自己的 Steam 库存页面。');
      return;
    }

    this.isOpen = true;
    this.backdropEl?.classList.add('smbl-open');
    this.wallet = createWalletFeeConfig(ctx.walletInfo);
    this.renderWalletBadge();
    void this.refreshExchangeRate(false);

    if (this.groups.length === 0 || getActiveAppIdFromPage() !== this.currentAppId) {
      void this.scanCurrentInventory();
    } else {
      this.gameTabs = getAvailableGameTabs();
      this.renderGameTabs();
    }
  }

  private async refreshExchangeRate(forceRefresh: boolean): Promise<void> {
    if (this.isLoadingFx) return;
    this.isLoadingFx = true;
    this.renderFxBadge();
    try {
      const info = await fetchDailyExchangeRateToCny(this.wallet.currencyCode, {
        forceRefresh,
        manualOverrideRate: this.settings?.manualFxRateToCny || 0,
      });
      this.fxRate = info;
      if (info && this.wallet.currencyCode !== 'CNY') {
        this.addLog(
          'info',
          `汇率已更新：1 ${info.currencyCode} = ¥${info.rateToCny.toFixed(4)} (${info.date} · ${info.source})`,
        );
      } else if (!info && this.wallet.currencyCode !== 'CNY') {
        this.addLog('warn', `获取 ${this.wallet.currencyCode}→CNY 汇率失败，可点击顶部汇率标签手动填写`);
      }
    } finally {
      this.isLoadingFx = false;
      this.renderFxBadge();
      this.renderTable();
      this.renderSummary();
    }
  }

  public closePanel(): void {
    if (this.isRunningTask !== 'none') {
      const ok = window.confirm('当前仍有批量任务正在运行，确定要停止并关闭面板吗？');
      if (!ok) return;
      this.abortController?.abort();
    }
    this.isOpen = false;
    this.backdropEl?.classList.remove('smbl-open');
    this.modalEl?.classList.remove('smbl-open');
  }

  private async handleSwitchGameTab(appid: number): Promise<void> {
    this.addLog('info', `正在切换至库存 AppID ${appid}...`);
    const switched = await switchInventoryTab(appid);
    if (!switched) {
      this.addLog('warn', `未能自动切换到 AppID ${appid}，请直接在 Steam 库存页点击对应游戏标签`);
      return;
    }
    await this.scanCurrentInventory();
  }

  public async scanCurrentInventory(): Promise<void> {
    if (this.isScanning || this.isRunningTask !== 'none') return;
    this.isScanning = true;
    this.failedQueue = [];
    this.renderTaskControls();

    const badge = document.getElementById('smbl-app-badge');
    if (badge) badge.textContent = '正在加载完整库存...';
    this.addLog('info', '正在扫描并加载当前库存全部页面...');

    try {
      const ctx = resolveSteamPageContext();
      this.wallet = createWalletFeeConfig(ctx.walletInfo);
      this.renderWalletBadge();
      if (!this.fxRate || this.fxRate.currencyCode !== this.wallet.currencyCode) {
        void this.refreshExchangeRate(false);
      }

      const result = await loadActiveSteamInventory(this.wallet);
      this.currentAppId = result.appid;
      this.currentAppName = result.appName;
      this.totalScannedAssets = result.totalScanned;
      this.groups = groupInventoryAssets(result.assets, {
        keepOneDuplicate: this.settings?.keepOneDuplicate,
        skipModified: this.settings?.skipModified,
      });
      for (const g of this.groups) {
        g.costPriceCny = getSavedCostPriceCny(g.appid, g.marketHashName);
      }
      this.gameTabs = getAvailableGameTabs();

      this.addLog(
        'ok',
        `扫描完成 [${this.currentAppName}]：共 ${this.totalScannedAssets} 件，可上架 ${result.assets.length} 件（${this.groups.length} 组）｜钱包 ${this.wallet.currencyCode}${this.wallet.walletDetected ? '' : '(未检测到，使用默认)'} 费率 ${(this.wallet.steamFeePercent * 100).toFixed(0)}%+${(this.wallet.publisherFeePercentDefault * 100).toFixed(0)}%`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('err', `扫描失败：${msg}`);
    } finally {
      this.isScanning = false;
      this.renderAll();
    }
  }

  private applyKeepOneToGroups(): void {
    const keepOne = Boolean(this.settings?.keepOneDuplicate);
    for (const g of this.groups) {
      if (keepOne) {
        g.quantityToSell = Math.max(1, g.assets.length - 1);
      } else {
        g.quantityToSell = g.assets.length;
      }
    }
  }

  private getFilteredGroups(): ItemGroup[] {
    if (!this.searchQuery) return this.groups;
    const q = this.searchQuery;
    return this.groups.filter(
      (g) =>
        g.displayName.toLowerCase().includes(q) ||
        g.marketHashName.toLowerCase().includes(q) ||
        g.typeText.toLowerCase().includes(q),
    );
  }

  private selectFiltered(mode: 'all' | 'duplicates' | 'invert' | 'none'): void {
    const visible = this.getFilteredGroups();
    const skipModified = Boolean(this.settings?.skipModified);

    for (const g of visible) {
      if (mode === 'none') {
        g.selected = false;
      } else if (mode === 'all') {
        g.selected = !(skipModified && g.hasModifier);
        if (g.selected && this.settings?.keepOneDuplicate && g.assets.length <= 1) {
          g.selected = false;
        }
      } else if (mode === 'duplicates') {
        if (g.assets.length > 1 && !(skipModified && g.hasModifier)) {
          g.selected = true;
          g.quantityToSell = g.assets.length - 1;
        } else {
          g.selected = false;
        }
      } else if (mode === 'invert') {
        g.selected = !g.selected;
      }
    }

    this.renderTable();
    this.renderSummary();
  }

  private getCustomPriceOptions(): CustomPriceOptions | undefined {
    if (!this.settings) return undefined;
    return {
      mode: this.settings.customPriceMode,
      fixedPriceCents: this.settings.customFixedPriceCents,
      offsetCents: this.settings.customOffsetCents,
      percent: this.settings.customPercent,
      roundToWholeUnits: this.settings.roundToWholeUnits,
    };
  }

  private getEffectiveFxRate(): number | null {
    if (this.wallet.currencyCode === 'CNY') return 1;
    if (this.settings && this.settings.manualFxRateToCny > 0) {
      return this.settings.manualFxRateToCny;
    }
    return this.fxRate?.rateToCny ?? null;
  }

  private getEffectivePrice(group: ItemGroup): CalculatedListingPrice | null {
    if (!this.settings) return null;
    return resolveStrategyPrice(
      this.settings.strategy,
      group.quote,
      group.manualBuyerPriceCents,
      group.publisherFeePercent,
      this.wallet,
      this.getCustomPriceOptions(),
    );
  }

  private async waitIfPaused(signal: AbortSignal): Promise<void> {
    while (this.isPaused) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      await sleepWithAbort(200, signal);
    }
  }

  private async fetchSingleGroupPrice(group: ItemGroup, forceRefresh: boolean): Promise<void> {
    if (this.isRunningTask !== 'none' || !this.settings) return;
    group.priceStatus = 'loading';
    this.renderTable();

    try {
      const quote = await fetchMarketQuote(group.appid, group.marketHashName, this.wallet, {
        includeBuyOrder: true,
        forceRefresh,
        onRateLimit: (waitMs, attempt) => {
          this.addLog('warn', `触发 Steam 限流 (429)，第 ${attempt} 次退避等待 ${(waitMs / 1000).toFixed(1)}s...`);
        },
      });
      group.quote = quote;
      group.priceStatus = 'ready';
      this.addLog(
        'ok',
        `[${group.displayName}] 最低卖价 ${formatCents(quote.lowestSellCents, this.wallet)} / 最高求购 ${formatCents(quote.highestBuyCents, this.wallet)}`,
      );
    } catch (err) {
      group.priceStatus = 'error';
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('err', `[${group.displayName}] 查价失败：${msg}`);
    } finally {
      this.renderTable();
      this.renderSummary();
    }
  }

  private async runBatchPriceFetch(forceRefresh: boolean): Promise<void> {
    if (this.isRunningTask !== 'none' || !this.settings) return;

    const selected = this.groups.filter((g) => g.selected);
    const targets = selected.length > 0 ? selected : this.getFilteredGroups();
    if (targets.length === 0) {
      this.addLog('warn', '当前没有可查价的物品');
      return;
    }

    // Deduplicate by appid + marketHashName so split modified items share 1 market query
    const uniqueKeyToGroups = new Map<string, ItemGroup[]>();
    for (const g of targets) {
      const key = `${g.appid}:${g.marketHashName}`;
      const list = uniqueKeyToGroups.get(key) || [];
      list.push(g);
      uniqueKeyToGroups.set(key, list);
    }

    const entries = Array.from(uniqueKeyToGroups.values());
    const includeBuyOrder = this.settings.strategy === 'highest_buy' || forceRefresh;

    this.isRunningTask = 'pricing';
    this.isPaused = false;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.progressCurrent = 0;
    this.progressTotal = entries.length;
    this.progressLabel = includeBuyOrder
      ? '正在批量查价（含最低卖价 + 最高求购）...'
      : '正在批量查价（最低卖价）...';
    this.renderTaskControls();

    this.addLog(
      'info',
      `开始批量查价：共 ${entries.length} 种唯一物品（模式：${includeBuyOrder ? '完整挂单簿' : '快速最低价'}，间隔 ${this.settings.priceDelayMs}ms）`,
    );

    let successCount = 0;
    let failCount = 0;
    let consecutive429 = 0;
    const max429 = this.settings.circuitBreakerMax429;

    try {
      for (let i = 0; i < entries.length; i += 1) {
        await this.waitIfPaused(signal);
        const groupBatch = entries[i];
        const sample = groupBatch[0];
        for (const g of groupBatch) {
          g.priceStatus = 'loading';
        }
        this.progressLabel = `查价中：${sample.displayName}`;
        this.renderTable();
        this.renderProgress();

        try {
          const quote = await fetchMarketQuote(sample.appid, sample.marketHashName, this.wallet, {
            includeBuyOrder,
            forceRefresh,
            signal,
            onRateLimit: (waitMs, attempt) => {
              this.progressLabel = `触发 429 限流，冷却 ${(waitMs / 1000).toFixed(1)}s (重试 ${attempt})...`;
              this.renderProgress();
              this.addLog(
                'warn',
                `查价触发 Steam 429 限流，自动等待 ${(waitMs / 1000).toFixed(1)}s 后重试`,
              );
            },
          });

          for (const g of groupBatch) {
            g.quote = quote;
            g.priceStatus = 'ready';
          }
          successCount += 1;
          consecutive429 = 0;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            for (const g of groupBatch) {
              if (g.priceStatus === 'loading') g.priceStatus = 'idle';
            }
            throw err;
          }
          for (const g of groupBatch) {
            g.priceStatus = 'error';
          }
          failCount += 1;
          const msg = err instanceof Error ? err.message : String(err);
          this.addLog('err', `[${sample.displayName}] 查价失败：${msg}`);

          if (err instanceof SteamRateLimitError) {
            consecutive429 += 1;
            if (max429 > 0 && consecutive429 >= max429 && i < entries.length - 1) {
              this.isPaused = true;
              this.progressLabel = `🛑 熔断暂停：连续 ${consecutive429} 次 429 限流`;
              this.addLog(
                'warn',
                `🛑 429 熔断保护触发：查价连续遭遇 ${consecutive429} 次限流，已自动暂停！建议冷却 2~5 分钟后再点击“继续”`,
              );
              this.renderTaskControls();
              consecutive429 = 0;
            }
          }
        }

        this.progressCurrent = i + 1;
        this.renderTable();
        this.renderSummary();
        this.renderProgress();

        if (i < entries.length - 1) {
          const waitMs = computeNextPriceDelayMs(this.settings);
          await sleepWithAbort(waitMs, signal);
        }
      }

      this.addLog('ok', `批量查价结束：成功 ${successCount} 项，失败 ${failCount} 项`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.addLog('warn', `批量查价已手动停止（已完成 ${this.progressCurrent}/${this.progressTotal}）`);
      } else {
        this.addLog('err', `批量查价异常中断：${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      this.isRunningTask = 'none';
      this.isPaused = false;
      this.abortController = null;
      this.renderAll();
    }
  }

  private openOfficialMultisell(): void {
    const selectedCommodity = this.groups.filter((g) => g.selected && g.commodity);
    const pool =
      selectedCommodity.length > 0
        ? selectedCommodity
        : this.getFilteredGroups().filter((g) => g.commodity);

    if (pool.length === 0) {
      this.addLog(
        'warn',
        '当前库存未找到可走官方批量出售的大宗商品（如 CS2 箱子/胶囊、集换式卡牌等）；普通单件饰品请直接用“确认批量上架”',
      );
      return;
    }

    // Group by appid + contextid (multisell URL operates on one appid + contextid at a time)
    const primary = pool[0];
    const sameContext = pool.filter(
      (g) => g.appid === primary.appid && g.contextid === primary.contextid,
    );

    const entries = sameContext.map((g) => ({
      marketHashName: g.marketHashName,
      quantity: Math.max(1, Math.min(g.assets.length, g.quantityToSell)),
    }));

    const url = buildSteamMultisellUrl(primary.appid, primary.contextid, entries, 25);
    if (!url) return;

    const totalQty = entries.slice(0, 25).reduce((sum, e) => sum + e.quantity, 0);
    const truncated = entries.length > 25 ? `（超出单页上限，已取前 25 种）` : '';
    this.addLog(
      'ok',
      `正在打开 Steam 官方批量出售页（${Math.min(entries.length, 25)} 种大宗物品，共 ${totalQty} 件）${truncated}`,
    );

    const opened = window.open(url, '_blank');
    if (!opened) {
      window.location.href = url;
    }
  }

  private buildSellPlan(): {
    plan: FailedSellItem[];
    missingPriceGroups: ItemGroup[];
    modifiedCount: number;
    highValueCount: number;
    abnormalLowItems: Array<{ name: string; buyerPaysCents: number; lowestSellCents: number; ratioPercent: number }>;
    totalBuyerCents: number;
    totalSellerCents: number;
  } {
    const plan: FailedSellItem[] = [];
    const missingPriceGroups: ItemGroup[] = [];
    const abnormalLowItems: Array<{
      name: string;
      buyerPaysCents: number;
      lowestSellCents: number;
      ratioPercent: number;
    }> = [];
    let modifiedCount = 0;
    let highValueCount = 0;
    let totalBuyerCents = 0;
    let totalSellerCents = 0;

    const threshold = this.settings?.highValueThresholdCents ?? 10000;
    const lowWarnPct = this.settings?.lowPriceWarnPercent ?? 70;

    for (const group of this.groups) {
      if (!group.selected) continue;
      const calc = this.getEffectivePrice(group);
      if (!calc) {
        missingPriceGroups.push(group);
        continue;
      }

      const qty = Math.max(1, Math.min(group.assets.length, group.quantityToSell));
      if (group.hasModifier) modifiedCount += qty;
      if (threshold > 0 && calc.buyerPaysCents >= threshold) highValueCount += qty;

      const lowCheck = checkAbnormalLowPrice(calc.buyerPaysCents, group.quote, lowWarnPct);
      if (lowCheck) {
        abnormalLowItems.push({
          name: group.displayName,
          buyerPaysCents: calc.buyerPaysCents,
          lowestSellCents: lowCheck.lowestSellCents,
          ratioPercent: lowCheck.ratioPercent,
        });
      }

      for (let i = 0; i < qty; i += 1) {
        const asset = group.assets[i];
        plan.push({
          groupKey: group.groupKey,
          appid: asset.appid,
          contextid: asset.contextid,
          assetid: asset.assetid,
          amount: 1,
          displayName: group.displayName,
          buyerPaysCents: calc.buyerPaysCents,
          sellerReceivesCents: calc.sellerReceivesCents,
        });
        totalBuyerCents += calc.buyerPaysCents;
        totalSellerCents += calc.sellerReceivesCents;
      }
    }

    return {
      plan,
      missingPriceGroups,
      modifiedCount,
      highValueCount,
      abnormalLowItems,
      totalBuyerCents,
      totalSellerCents,
    };
  }

  private openSellConfirmationModal(): void {
    if (this.isRunningTask !== 'none' || !this.settings) return;

    const ctx = resolveSteamPageContext();
    if (!ctx.sessionId) {
      this.addLog('err', '未检测到 Steam 会话 (sessionid)，请确认已登录 Steam 客户端并刷新库存页');
      return;
    }

    const summary = this.buildSellPlan();
    if (summary.plan.length === 0) {
      if (summary.missingPriceGroups.length > 0) {
        this.addLog(
          'warn',
          `已选中的 ${summary.missingPriceGroups.length} 组物品尚未查到可用价格（当前策略：${getStrategyLabel(this.settings.strategy, this.getCustomPriceOptions())}），请先点击“批量查价”或手动输入价格`,
        );
      } else {
        this.addLog('warn', '请先勾选至少一件要上架的物品');
      }
      return;
    }

    const modalBody = document.getElementById('smbl-modal-body');
    if (!modalBody) return;

    const warnings: string[] = [];
    if (summary.missingPriceGroups.length > 0) {
      warnings.push(
        `有 ${summary.missingPriceGroups.length} 组已选物品缺少当前策略报价，本次将自动跳过。`,
      );
    }
    if (summary.modifiedCount > 0) {
      warnings.push(`注意：包含 ${summary.modifiedCount} 件带印花 / 改名 / 宝石等特殊修饰的物品！`);
    }
    if (summary.highValueCount > 0) {
      warnings.push(
        `高价提醒：包含 ${summary.highValueCount} 件单价达到或超过 ${formatCents(this.settings.highValueThresholdCents, this.wallet)} 的物品！`,
      );
    }

    // Group preview lines
    const previewMap = new Map<
      string,
      { name: string; count: number; buyer: number; seller: number; costCny: number | null }
    >();
    const groupByKey = new Map(this.groups.map((g) => [g.groupKey, g]));
    for (const item of summary.plan) {
      const existing = previewMap.get(item.groupKey);
      if (existing) {
        existing.count += 1;
      } else {
        const g = groupByKey.get(item.groupKey);
        previewMap.set(item.groupKey, {
          name: item.displayName,
          count: 1,
          buyer: item.buyerPaysCents,
          seller: item.sellerReceivesCents,
          costCny: g?.costPriceCny ?? null,
        });
      }
    }

    const fx = this.getEffectiveFxRate();
    const isNonCny = this.wallet.currencyCode !== 'CNY';
    const totalBuyerCny = centsToCnyYuan(summary.totalBuyerCents, fx);
    const totalSellerCny = centsToCnyYuan(summary.totalSellerCents, fx);

    let costCoveredCostCny = 0;
    let costCoveredSellerCny = 0;
    for (const r of previewMap.values()) {
      if (r.costCny !== null && r.costCny > 0) {
        const netYuan = centsToCnyYuan(r.seller, fx);
        if (netYuan !== null && netYuan > 0) {
          costCoveredCostCny += r.costCny * r.count;
          costCoveredSellerCny += netYuan * r.count;
        }
      }
    }
    const overallRatio = calculateBalanceRatio(costCoveredCostCny, costCoveredSellerCny);

    const previewRows = Array.from(previewMap.values()).slice(0, 60);
    const moreCount = previewMap.size - previewRows.length;

    const pacingDesc = this.settings.humanMode
      ? `🛡 拟真随机 ${(this.settings.sellDelayMinMs / 1000).toFixed(1)}~${(this.settings.sellDelayMaxMs / 1000).toFixed(1)}s${
          this.settings.batchRestEvery > 0
            ? ` · 每 ${this.settings.batchRestEvery} 件休眠 ${this.settings.batchRestMinSec}~${this.settings.batchRestMaxSec}s`
            : ''
        }${this.settings.circuitBreakerMax429 > 0 ? ` · 连续 ${this.settings.circuitBreakerMax429} 次 429 自动熔断` : ''}`
      : `固定间隔 ${this.settings.sellDelayMs}ms`;

    const fxLine =
      isNonCny && fx !== null
        ? `<div style="margin-top:4px;font-size:12px;color:#93e2ff;">当前汇率：1 ${escapeHtml(this.wallet.currencyCode)} = ¥${fx.toFixed(4)}${this.fxRate ? `（${escapeHtml(this.fxRate.date)} · ${escapeHtml(this.fxRate.source)}）` : ''}</div>`
        : '';

    modalBody.innerHTML = `
      <div>当前库存：<strong>${escapeHtml(this.currentAppName)}</strong> ｜ 定价策略：<strong>${escapeHtml(getStrategyLabel(this.settings.strategy, this.getCustomPriceOptions()))}</strong></div>
      <div style="margin-top:4px;font-size:12px;color:#86efac;">防风控节奏：${escapeHtml(pacingDesc)}</div>
      ${fxLine}
      <div style="margin-top:6px;">
        即将上架：<strong>${summary.plan.length}</strong> 件 ｜
        预计买家总付：<strong class="smbl-price-sell">${escapeHtml(formatCents(summary.totalBuyerCents, this.wallet))}</strong>${isNonCny && totalBuyerCny !== null ? ` <span class="smbl-muted">(≈${escapeHtml(formatCnyYuan(totalBuyerCny))})</span>` : ''} ｜
        预计实收总额：<strong class="smbl-price-net">${escapeHtml(formatCents(summary.totalSellerCents, this.wallet))}</strong>${isNonCny && totalSellerCny !== null ? ` <span class="smbl-muted">(≈${escapeHtml(formatCnyYuan(totalSellerCny))})</span>` : ''}
      </div>
      ${
        overallRatio
          ? `<div style="margin-top:4px;font-size:12.5px;">
              已填成本合计：<strong>${escapeHtml(formatCnyYuan(costCoveredCostCny))}</strong> ｜
              对应实收：<strong>${escapeHtml(formatCnyYuan(costCoveredSellerCny))}</strong> ｜
              综合余额率：<strong class="${overallRatio.ratio <= 0.72 ? 'smbl-ratio-good' : overallRatio.ratio <= 0.85 ? 'smbl-ratio-mid' : 'smbl-ratio-warn'}">${overallRatio.formatted}</strong>
            </div>`
          : ''
      }
      ${
        summary.abnormalLowItems.length > 0
          ? `<div style="margin-top:8px;padding:8px 10px;border-radius:4px;background:rgba(220,38,38,0.18);border:1px solid rgba(248,113,113,0.55);color:#fecaca;">
              <div><strong>🚨 异常低价拦截警告（共 ${summary.abnormalLowItems.length} 组低于市场最低价的 ${this.settings.lowPriceWarnPercent}%）：</strong></div>
              ${summary.abnormalLowItems
                .slice(0, 6)
                .map(
                  (it) =>
                    `<div style="font-size:12px;margin-top:2px;">• ${escapeHtml(it.name)}：计划标价 ${escapeHtml(formatCents(it.buyerPaysCents, this.wallet))}（仅为最低卖价 ${escapeHtml(formatCents(it.lowestSellCents, this.wallet))} 的 ${it.ratioPercent}%）</div>`,
                )
                .join('')}
              ${
                summary.abnormalLowItems.length > 6
                  ? `<div style="font-size:11.5px;margin-top:2px;">... 其余 ${summary.abnormalLowItems.length - 6} 组请仔细核对</div>`
                  : ''
              }
            </div>`
          : ''
      }
      ${
        warnings.length > 0
          ? `<div style="margin-top:8px;padding:8px 10px;border-radius:4px;background:rgba(217,119,6,0.16);border:1px solid rgba(251,191,36,0.45);color:#fde68a;">
              ${warnings.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join('')}
            </div>`
          : ''
      }
      <div class="smbl-modal-list">
        ${previewRows
          .map((r) => {
            const sellerCny = centsToCnyYuan(r.seller, fx);
            const ratioObj = calculateBalanceRatio(r.costCny, sellerCny);
            const cnyPart =
              isNonCny && sellerCny !== null ? ` (实收≈${formatCnyYuan(sellerCny)})` : '';
            const ratioPart = ratioObj ? ` · 余额率 ${ratioObj.formatted}` : '';
            return `
          <div class="smbl-modal-row">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.name)} × ${r.count}</span>
            <span class="smbl-num" style="flex-shrink:0;">
              标价 ${escapeHtml(formatCents(r.buyer, this.wallet))} / 实收 ${escapeHtml(formatCents(r.seller, this.wallet))}${escapeHtml(cnyPart + ratioPart)}
            </span>
          </div>`;
          })
          .join('')}
        ${moreCount > 0 ? `<div class="smbl-muted" style="padding-top:4px;">... 其余 ${moreCount} 组已省略</div>` : ''}
      </div>
      <div class="smbl-muted" style="margin-top:8px;font-size:12px;">
        提示：触发 Steam 安全规则的挂单提交后会进入手机 Steam Guard 令牌确认队列，请在手机端统一确认。
      </div>
    `;

    this.modalEl?.classList.add('smbl-open');
  }

  private async runBatchSell(): Promise<void> {
    const { plan } = this.buildSellPlan();
    if (plan.length === 0) return;
    await this.executeSellPlan(plan);
  }

  private async runRetryFailedQueue(): Promise<void> {
    if (this.failedQueue.length === 0 || this.isRunningTask !== 'none') return;
    const retryItems = [...this.failedQueue];
    this.failedQueue = [];
    await this.executeSellPlan(retryItems);
  }

  private async executeSellPlan(plan: FailedSellItem[]): Promise<void> {
    if (!this.settings) return;
    const ctx = resolveSteamPageContext();
    const sessionId = ctx.sessionId;
    if (!sessionId) {
      this.addLog('err', '缺少 Steam sessionid，无法上架');
      return;
    }

    this.isRunningTask = 'selling';
    this.isPaused = false;
    this.isResting = false;
    this.skipCurrentRest = false;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.progressCurrent = 0;
    this.progressTotal = plan.length;
    this.progressLabel = '正在批量上架...';
    this.renderTaskControls();

    const modeLog = this.settings.humanMode
      ? `🛡 拟真模式 ${(this.settings.sellDelayMinMs / 1000).toFixed(1)}~${(this.settings.sellDelayMaxMs / 1000).toFixed(1)}s`
      : `固定间隔 ${this.settings.sellDelayMs}ms`;
    this.addLog('info', `开始批量上架：共 ${plan.length} 件物品（${modeLog}）`);

    let listedDirect = 0;
    let listedNeedConfirm = 0;
    let consecutive429 = 0;
    let batchProcessedSinceRest = 0;
    const max429 = this.settings.circuitBreakerMax429;
    const newFailed: FailedSellItem[] = [];

    try {
      for (let i = 0; i < plan.length; i += 1) {
        await this.waitIfPaused(signal);
        const task = plan[i];
        this.progressLabel = `上架中 (${i + 1}/${plan.length})：${task.displayName}`;
        this.renderProgress();

        const res = await listItemOnMarket({
          sessionId,
          appid: task.appid,
          contextid: task.contextid,
          assetid: task.assetid,
          amount: task.amount,
          sellerReceivesCents: task.sellerReceivesCents,
          signal,
          onRateLimit: (waitMs, attempt) => {
            this.progressLabel = `上架触发限流，冷却 ${(waitMs / 1000).toFixed(1)}s (重试 ${attempt})...`;
            this.renderProgress();
            this.addLog('warn', `上架触发 Steam 限流，等待 ${(waitMs / 1000).toFixed(1)}s 后重试`);
          },
        });

        if (res.ok) {
          consecutive429 = 0;
          batchProcessedSinceRest += 1;
          const fx = this.getEffectiveFxRate();
          const netCny = centsToCnyYuan(task.sellerReceivesCents, fx);
          const cnyNote =
            this.wallet.currencyCode !== 'CNY' && netCny !== null
              ? ` ≈ ${formatCnyYuan(netCny)}`
              : '';
          if (res.requiresConfirmation) {
            listedNeedConfirm += 1;
            this.addLog(
              'ok',
              `[待令牌确认] ${task.displayName} | 标价 ${formatCents(task.buyerPaysCents, this.wallet)} / 实收 ${formatCents(task.sellerReceivesCents, this.wallet)}${cnyNote} (price=${task.sellerReceivesCents})`,
            );
          } else {
            listedDirect += 1;
            this.addLog(
              'ok',
              `[已上架] ${task.displayName} | 标价 ${formatCents(task.buyerPaysCents, this.wallet)} / 实收 ${formatCents(task.sellerReceivesCents, this.wallet)}${cnyNote} (price=${task.sellerReceivesCents})`,
            );
          }
          this.removeSoldAssetFromGroups(task.groupKey, task.assetid);
        } else {
          newFailed.push(task);
          this.addLog('err', `[失败] ${task.displayName}：${res.message}`);

          if (res.rateLimited) {
            consecutive429 += 1;
            if (max429 > 0 && consecutive429 >= max429 && i < plan.length - 1) {
              this.isPaused = true;
              this.progressLabel = `🛑 熔断暂停：连续 ${consecutive429} 次限流`;
              this.addLog(
                'warn',
                `🛑 429 熔断保护触发：上架连续遭遇 ${consecutive429} 次 Steam 限流，已自动暂停队列！建议冷却 3~5 分钟后再点击“继续”`,
              );
              this.renderTaskControls();
              consecutive429 = 0;
            }
          }
        }

        this.progressCurrent = i + 1;
        this.renderTable();
        this.renderSummary();
        this.renderProgress();

        if (i < plan.length - 1) {
          // Batch rest in human mode after every N successful listings
          if (
            this.settings.humanMode &&
            this.settings.batchRestEvery > 0 &&
            batchProcessedSinceRest >= this.settings.batchRestEvery &&
            !this.isPaused
          ) {
            batchProcessedSinceRest = 0;
            const restMs = computeBatchRestMs(this.settings);
            const restSec = Math.round(restMs / 1000);
            this.isResting = true;
            this.skipCurrentRest = false;
            this.addLog(
              'info',
              `🛡 拟真分批休眠：本批已上架 ${this.settings.batchRestEvery} 件，自动休息 ${restSec}s（期间可到手机端确认令牌，或点“跳过休眠”）`,
            );
            this.renderTaskControls();
            try {
              await sleepCountdownWithSkip(restMs, {
                signal,
                shouldSkip: () => this.skipCurrentRest,
                onTick: (remSec) => {
                  this.progressLabel = `🛡 拟真分批休眠中：剩余 ${remSec}s 后继续...`;
                  this.renderProgress();
                },
              });
            } finally {
              this.isResting = false;
              this.skipCurrentRest = false;
              this.renderTaskControls();
            }
          } else {
            const waitMs = computeNextSellDelayMs(this.settings);
            if (this.settings.humanMode) {
              this.progressLabel = `🛡 等待下一次上架 (${(waitMs / 1000).toFixed(1)}s)...`;
              this.renderProgress();
            }
            await sleepWithAbort(waitMs, signal);
          }
        }
      }

      this.addLog(
        'ok',
        `批量上架完成：直接上架 ${listedDirect} 件，待手机令牌确认 ${listedNeedConfirm} 件，失败 ${newFailed.length} 件`,
      );
      if (listedNeedConfirm > 0) {
        this.addLog('warn', `请在手机 Steam App -> 确认 中统一确认这 ${listedNeedConfirm} 条挂单`);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.addLog('warn', `批量上架已停止（已处理 ${this.progressCurrent}/${this.progressTotal}）`);
      } else {
        this.addLog('err', `批量上架异常中断：${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      this.failedQueue = newFailed;
      this.isRunningTask = 'none';
      this.isPaused = false;
      this.isResting = false;
      this.skipCurrentRest = false;
      this.abortController = null;
      this.renderAll();
    }
  }

  private removeSoldAssetFromGroups(groupKey: string, assetid: string): void {
    const idx = this.groups.findIndex((g) => g.groupKey === groupKey);
    if (idx === -1) return;
    const group = this.groups[idx];
    group.assets = group.assets.filter((a) => a.assetid !== assetid);
    if (group.assets.length === 0) {
      this.groups.splice(idx, 1);
    } else if (group.quantityToSell > group.assets.length) {
      group.quantityToSell = group.assets.length;
    }
  }

  private addLog(level: LogEntry['level'], text: string): void {
    this.logs.push({ time: nowTimeStr(), level, text });
    if (this.logs.length > 300) {
      this.logs.splice(0, this.logs.length - 300);
    }
    this.renderLogs();
  }

  private syncSettingsControls(): void {
    if (!this.settings) return;
    const humanMode = document.getElementById('smbl-opt-human-mode') as HTMLInputElement | null;
    const humanRangeWrap = document.getElementById('smbl-human-range-wrap');
    const fixedSellWrap = document.getElementById('smbl-fixed-sell-wrap');
    const sellMin = document.getElementById('smbl-opt-sell-min') as HTMLInputElement | null;
    const sellMax = document.getElementById('smbl-opt-sell-max') as HTMLInputElement | null;
    const restEvery = document.getElementById('smbl-opt-rest-every') as HTMLInputElement | null;
    const restMin = document.getElementById('smbl-opt-rest-min') as HTMLInputElement | null;
    const restMax = document.getElementById('smbl-opt-rest-max') as HTMLInputElement | null;
    const lowWarn = document.getElementById('smbl-opt-low-warn') as HTMLInputElement | null;
    const wholeUnits = document.getElementById('smbl-opt-whole-units') as HTMLInputElement | null;
    const skipMod = document.getElementById('smbl-opt-skip-mod') as HTMLInputElement | null;
    const keepOne = document.getElementById('smbl-opt-keep-one') as HTMLInputElement | null;
    const threshold = document.getElementById('smbl-opt-threshold') as HTMLInputElement | null;
    const priceDelay = document.getElementById('smbl-opt-price-delay') as HTMLInputElement | null;
    const sellDelay = document.getElementById('smbl-opt-sell-delay') as HTMLInputElement | null;

    if (humanMode) humanMode.checked = this.settings.humanMode;
    if (humanRangeWrap) humanRangeWrap.style.display = this.settings.humanMode ? 'inline-flex' : 'none';
    if (fixedSellWrap) fixedSellWrap.style.display = this.settings.humanMode ? 'none' : 'inline-flex';
    if (sellMin) sellMin.value = String(this.settings.sellDelayMinMs);
    if (sellMax) sellMax.value = String(this.settings.sellDelayMaxMs);
    if (restEvery) restEvery.value = String(this.settings.batchRestEvery);
    if (restMin) restMin.value = String(this.settings.batchRestMinSec);
    if (restMax) restMax.value = String(this.settings.batchRestMaxSec);
    if (lowWarn) lowWarn.value = String(this.settings.lowPriceWarnPercent);
    if (wholeUnits) wholeUnits.checked = this.settings.roundToWholeUnits;
    if (skipMod) skipMod.checked = this.settings.skipModified;
    if (keepOne) keepOne.checked = this.settings.keepOneDuplicate;
    if (threshold) threshold.value = String(Math.round(this.settings.highValueThresholdCents / 100));
    if (priceDelay) priceDelay.value = String(this.settings.priceDelayMs);
    if (sellDelay) sellDelay.value = String(this.settings.sellDelayMs);

    const strategyBtns = document.querySelectorAll<HTMLButtonElement>('#smbl-strategy-group [data-strategy]');
    strategyBtns.forEach((btn) => {
      btn.classList.toggle('smbl-active', btn.dataset.strategy === this.settings?.strategy);
    });

    const customBar = document.getElementById('smbl-custom-bar');
    const customModeEl = document.getElementById('smbl-custom-mode') as HTMLSelectElement | null;
    const customValInput = document.getElementById('smbl-custom-val-input') as HTMLInputElement | null;
    const customValPrefix = document.getElementById('smbl-custom-val-prefix');
    const customValSuffix = document.getElementById('smbl-custom-val-suffix');
    const customHint = document.getElementById('smbl-custom-hint');

    if (customBar) {
      customBar.classList.toggle('smbl-visible', this.settings.strategy === 'custom');
    }
    if (customModeEl) {
      customModeEl.value = this.settings.customPriceMode;
    }
    if (customValInput && customValPrefix && customValSuffix && customHint) {
      const mode = this.settings.customPriceMode;
      const isFocused = document.activeElement === customValInput;
      if (mode === 'fixed_buyer') {
        customValPrefix.textContent = '买家付:';
        customValSuffix.textContent = this.wallet.currencySymbol.trim() || '元';
        customValInput.step = this.wallet.zeroDecimal || this.settings.roundToWholeUnits ? '1' : '0.01';
        customValInput.min = '0.01';
        if (!isFocused) customValInput.value = centsToInputValue(this.settings.customFixedPriceCents, this.wallet);
        const preview = resolveStrategyPrice(
          'custom',
          null,
          null,
          this.wallet.publisherFeePercentDefault,
          this.wallet,
          this.getCustomPriceOptions(),
        );
        const fx = this.getEffectiveFxRate();
        const netCny = preview ? centsToCnyYuan(preview.sellerReceivesCents, fx) : null;
        customHint.textContent = preview
          ? `免查价直挂 → 实际标价 ${formatCents(preview.buyerPaysCents, this.wallet)} / 实收 ${formatCents(preview.sellerReceivesCents, this.wallet)}${this.wallet.currencyCode !== 'CNY' && netCny !== null ? ` (≈${formatCnyYuan(netCny)})` : ''}`
          : '无需查价，所有选中物品统一按此挂单价出售';
      } else if (mode === 'fixed_seller') {
        customValPrefix.textContent = '实收:';
        customValSuffix.textContent = this.wallet.currencySymbol.trim() || '元';
        customValInput.step = this.wallet.zeroDecimal || this.settings.roundToWholeUnits ? '1' : '0.01';
        customValInput.min = '0.01';
        if (!isFocused) customValInput.value = centsToInputValue(this.settings.customFixedPriceCents, this.wallet);
        const preview = resolveStrategyPrice(
          'custom',
          null,
          null,
          this.wallet.publisherFeePercentDefault,
          this.wallet,
          this.getCustomPriceOptions(),
        );
        const fx = this.getEffectiveFxRate();
        const netCny = preview ? centsToCnyYuan(preview.sellerReceivesCents, fx) : null;
        customHint.textContent = preview
          ? `免查价直挂 → 买家付 ${formatCents(preview.buyerPaysCents, this.wallet)} / 实收 ${formatCents(preview.sellerReceivesCents, this.wallet)}${this.wallet.currencyCode !== 'CNY' && netCny !== null ? ` (≈${formatCnyYuan(netCny)})` : ''}`
          : '无需查价，自动叠加 Steam 手续费保证到手金额';
      } else if (mode === 'offset_lowest_sell') {
        customValPrefix.textContent = '偏移:';
        customValSuffix.textContent = this.wallet.currencySymbol.trim() || '元';
        customValInput.step = this.wallet.zeroDecimal ? '1' : '0.01';
        customValInput.removeAttribute('min');
        if (!isFocused) {
          customValInput.value = this.wallet.zeroDecimal
            ? String(Math.round(this.settings.customOffsetCents / 100))
            : (this.settings.customOffsetCents / 100).toFixed(2);
        }
        customHint.textContent = '填负数减价（如 -0.05），填正数加价（如 0.10），需先批量查价';
      } else {
        customValPrefix.textContent = '比例:';
        customValSuffix.textContent = '%';
        customValInput.step = '1';
        customValInput.min = '10';
        if (!isFocused) customValInput.value = String(this.settings.customPercent);
        customHint.textContent = '如 95 表示最低卖价的 95%，105 表示 105%，需先批量查价';
      }
    }
  }

  private renderWalletBadge(): void {
    const el = document.getElementById('smbl-wallet-badge');
    if (!el) return;
    const feePct = Math.round((this.wallet.steamFeePercent + this.wallet.publisherFeePercentDefault) * 100);
    el.textContent = `钱包 ${this.wallet.country} (${this.wallet.currencyCode} ${this.wallet.currencySymbol.trim()}) · 费率 ${feePct}%`;
    el.title = `Steam 费率 ${(this.wallet.steamFeePercent * 100).toFixed(1)}% + 发行商默认 ${(this.wallet.publisherFeePercentDefault * 100).toFixed(1)}%，最小手续费 ${this.wallet.feeMinimum} 最小单位`;
    this.renderFxBadge();
  }

  private renderFxBadge(): void {
    const el = document.getElementById('smbl-fx-badge');
    const refreshBtn = document.getElementById('smbl-fx-refresh-btn') as HTMLButtonElement | null;
    if (!el) return;

    if (this.wallet.currencyCode === 'CNY') {
      el.textContent = '💱 人民币本币 (1:1)';
      if (refreshBtn) refreshBtn.style.display = 'none';
      return;
    }

    if (refreshBtn) {
      refreshBtn.style.display = 'inline-flex';
      refreshBtn.disabled = this.isLoadingFx;
    }

    if (this.isLoadingFx && !this.fxRate) {
      el.textContent = `💱 查询 ${this.wallet.currencyCode}→CNY 汇率...`;
      return;
    }

    const rate = this.getEffectiveFxRate();
    if (rate !== null) {
      const manualTag = this.settings && this.settings.manualFxRateToCny > 0 ? '手动' : this.fxRate?.date || '今日';
      el.textContent = `💱 1 ${this.wallet.currencyCode} = ¥${rate.toFixed(4)} (${manualTag})`;
    } else {
      el.textContent = `💱 ${this.wallet.currencyCode}→CNY 获取失败(点此手动设)`;
    }
  }

  private renderGameTabs(): void {
    const bar = document.getElementById('smbl-gamebar');
    if (!bar) return;

    if (this.gameTabs.length === 0) {
      bar.innerHTML = `<span class="smbl-muted" style="font-size:12px;">支持 CS2 / Dota 2 / TF2 / Steam 通用库存及任意游戏库存</span>`;
      return;
    }

    bar.innerHTML = this.gameTabs
      .map((tab) => {
        const activeCls = tab.appid === this.currentAppId ? ' smbl-active' : '';
        const countStr = tab.countText ? ` (${tab.countText})` : '';
        return `<button type="button" class="smbl-gametab${activeCls}" data-appid="${tab.appid}">${escapeHtml(tab.shortName + countStr)}</button>`;
      })
      .join('');
  }

  private renderTable(): void {
    const tbody = document.getElementById('smbl-tbody');
    if (!tbody) return;

    const appBadge = document.getElementById('smbl-app-badge');
    if (appBadge && !this.isScanning) {
      const totalMarketable = this.groups.reduce((acc, g) => acc + g.assets.length, 0);
      appBadge.textContent = `${this.currentAppName} · 可上架 ${totalMarketable} 件 (${this.groups.length} 组)`;
    }

    const visible = this.getFilteredGroups();
    if (visible.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="smbl-empty">
            ${
              this.isScanning
                ? '正在加载完整库存，请稍候...'
                : this.groups.length === 0
                  ? '当前库存标签页暂无可上架物品，可点击上方游戏标签切换或点击“扫描当前库存”。'
                  : '没有匹配当前搜索条件的物品。'
            }
          </td>
        </tr>
      `;
      return;
    }

    const threshold = this.settings?.highValueThresholdCents ?? 10000;
    const busy = this.isRunningTask !== 'none';
    const fx = this.getEffectiveFxRate();
    const isNonCny = this.wallet.currencyCode !== 'CNY';

    tbody.innerHTML = visible
      .map((g) => {
        const calc = this.getEffectivePrice(g);
        const isHighValue = Boolean(calc && threshold > 0 && calc.buyerPaysCents >= threshold);
        const isManual = g.manualBuyerPriceCents !== null;
        const inputVal = isManual
          ? centsToInputValue(g.manualBuyerPriceCents, this.wallet)
          : calc
            ? centsToInputValue(calc.buyerPaysCents, this.wallet)
            : '';

        const buyerCny = calc ? centsToCnyYuan(calc.buyerPaysCents, fx) : null;
        const sellerCny = calc ? centsToCnyYuan(calc.sellerReceivesCents, fx) : null;
        const balanceRatio = calculateBalanceRatio(g.costPriceCny, sellerCny);
        const ratioCls = !balanceRatio
          ? 'smbl-muted'
          : balanceRatio.ratio <= 0.72
            ? 'smbl-ratio-good'
            : balanceRatio.ratio <= 0.85
              ? 'smbl-ratio-mid'
              : balanceRatio.ratio <= 1.0
                ? 'smbl-ratio-warn'
                : 'smbl-ratio-bad';

        const costInputVal = g.costPriceCny !== null ? String(g.costPriceCny) : '';

        const lowestSellText =
          g.priceStatus === 'loading'
            ? '查价中...'
            : g.priceStatus === 'error'
              ? '失败'
              : formatCents(g.quote?.lowestSellCents, this.wallet);

        const highestBuyText =
          g.priceStatus === 'loading'
            ? '...'
            : g.quote?.source === 'overview' && g.quote.highestBuyCents === null
              ? '未查'
              : formatCents(g.quote?.highestBuyCents, this.wallet);

        const badges: string[] = [];
        if (g.commodity && g.assets.length > 1) {
          badges.push(`<span class="smbl-badge smbl-badge-ok" title="支持 Steam 官方批量出售 /market/multisell">大宗</span>`);
        }
        if (g.hasModifier) {
          badges.push(`<span class="smbl-badge smbl-badge-warn">⚠ ${escapeHtml(g.modifierHints.join('/'))}</span>`);
        }
        if (isHighValue) {
          badges.push(`<span class="smbl-badge smbl-badge-danger">高价</span>`);
        }
        const lowCheck = calc
          ? checkAbnormalLowPrice(
              calc.buyerPaysCents,
              g.quote,
              this.settings?.lowPriceWarnPercent ?? 70,
            )
          : null;
        if (lowCheck) {
          badges.push(
            `<span class="smbl-badge smbl-badge-danger" title="低于市场最低卖价（仅 ${lowCheck.ratioPercent}%）">⚠ 低价(${lowCheck.ratioPercent}%)</span>`,
          );
        }
        if (g.typeText) {
          badges.push(`<span>${escapeHtml(g.typeText)}</span>`);
        }

        return `
          <tr data-group-key="${escapeHtml(g.groupKey)}" class="${g.selected ? 'smbl-row-selected' : ''}">
            <td style="text-align:center;">
              <input type="checkbox" class="smbl-row-check" ${g.selected ? 'checked' : ''} ${busy ? 'disabled' : ''} />
            </td>
            <td>
              <div class="smbl-item-cell">
                ${g.iconUrl ? `<img class="smbl-item-icon" src="${escapeHtml(g.iconUrl)}" alt="" loading="lazy" />` : ''}
                <div class="smbl-item-meta">
                  <div class="smbl-item-name" style="color:${escapeHtml(g.nameColor)};" title="${escapeHtml(g.marketHashName)}">
                    ${escapeHtml(g.displayName)}
                  </div>
                  <div class="smbl-item-sub">${badges.join('')}</div>
                </div>
              </div>
            </td>
            <td class="smbl-num" style="overflow:visible;text-overflow:clip;">
              <div class="smbl-qty-wrap">
                <input type="number" class="smbl-qty-input" min="1" max="${g.assets.length}" value="${g.quantityToSell}" ${busy || g.assets.length <= 1 ? 'disabled' : ''} />
                <span class="smbl-muted">/ ${g.assets.length}</span>
              </div>
            </td>
            <td class="smbl-num smbl-price-sell">${escapeHtml(lowestSellText)}</td>
            <td class="smbl-num smbl-price-buy">${escapeHtml(highestBuyText)}</td>
            <td class="smbl-num">
              <div>
                <input type="number" step="${this.wallet.zeroDecimal || this.settings?.roundToWholeUnits ? '1' : '0.01'}" min="0" class="smbl-price-input${isManual ? ' smbl-manual' : ''}" value="${escapeHtml(inputVal)}" placeholder="未查价" ${busy ? 'disabled' : ''} />
                ${
                  isManual
                    ? `<button type="button" class="smbl-btn smbl-btn-ghost" data-action="reset-manual" title="恢复策略价" style="padding:2px 4px;font-size:11px;">↺</button>`
                    : ''
                }
              </div>
              ${
                isNonCny && buyerCny !== null
                  ? `<div class="smbl-cny-sub">≈ ${escapeHtml(formatCnyYuan(buyerCny))}</div>`
                  : ''
              }
            </td>
            <td class="smbl-num">
              <div class="smbl-price-net">${escapeHtml(formatCents(calc?.sellerReceivesCents, this.wallet))}</div>
              ${
                isNonCny && sellerCny !== null
                  ? `<div class="smbl-cny-sub">≈ ${escapeHtml(formatCnyYuan(sellerCny))}</div>`
                  : ''
              }
            </td>
            <td class="smbl-num">
              <input type="number" step="0.01" min="0" class="smbl-cost-input" value="${escapeHtml(costInputVal)}" placeholder="选填 ¥" title="填入单件饰品成本价（人民币）自动计算余额率" ${busy ? 'disabled' : ''} />
            </td>
            <td class="smbl-num ${ratioCls}" title="${balanceRatio ? `成本 ¥${g.costPriceCny} ÷ 实收 ${formatCnyYuan(sellerCny)} = ${balanceRatio.formatted}` : '填入成本价后自动计算'}">
              ${balanceRatio ? balanceRatio.formatted : '--'}
            </td>
            <td style="text-align:center;">
              <button type="button" class="smbl-btn" data-action="fetch-one" title="查询此物品完整挂单价" style="padding:3px 7px;" ${busy ? 'disabled' : ''}>查</button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  private renderSummary(): void {
    const el = document.getElementById('smbl-summary');
    if (!el) return;

    let selectedGroups = 0;
    let selectedItems = 0;
    let pricedItems = 0;
    let unpricedGroups = 0;
    let totalBuyer = 0;
    let totalSeller = 0;
    let costCoveredCostCny = 0;
    let costCoveredSellerCny = 0;

    const fx = this.getEffectiveFxRate();
    const isNonCny = this.wallet.currencyCode !== 'CNY';

    for (const g of this.groups) {
      if (!g.selected) continue;
      selectedGroups += 1;
      const qty = Math.max(1, Math.min(g.assets.length, g.quantityToSell));
      selectedItems += qty;
      const calc = this.getEffectivePrice(g);
      if (calc) {
        pricedItems += qty;
        totalBuyer += calc.buyerPaysCents * qty;
        totalSeller += calc.sellerReceivesCents * qty;
        if (g.costPriceCny !== null && g.costPriceCny > 0) {
          const unitSellerCny = centsToCnyYuan(calc.sellerReceivesCents, fx);
          if (unitSellerCny !== null && unitSellerCny > 0) {
            costCoveredCostCny += g.costPriceCny * qty;
            costCoveredSellerCny += unitSellerCny * qty;
          }
        }
      } else {
        unpricedGroups += 1;
      }
    }

    const totalBuyerCny = centsToCnyYuan(totalBuyer, fx);
    const totalSellerCny = centsToCnyYuan(totalSeller, fx);
    const overallRatio = calculateBalanceRatio(costCoveredCostCny, costCoveredSellerCny);
    const overallRatioCls = !overallRatio
      ? ''
      : overallRatio.ratio <= 0.72
        ? 'smbl-ratio-good'
        : overallRatio.ratio <= 0.85
          ? 'smbl-ratio-mid'
          : overallRatio.ratio <= 1.0
            ? 'smbl-ratio-warn'
            : 'smbl-ratio-bad';

    el.innerHTML = `
      <span>已选 <strong>${selectedGroups}</strong> 组 / <strong>${selectedItems}</strong> 件</span>
      <span>可上架 <strong>${pricedItems}</strong> 件${unpricedGroups > 0 ? ` <span class="smbl-badge smbl-badge-warn">${unpricedGroups} 组待查价</span>` : ''}</span>
      <span>预计标价 <strong class="smbl-price-sell">${escapeHtml(formatCents(totalBuyer, this.wallet))}</strong>${isNonCny && totalBuyerCny !== null ? ` <span class="smbl-muted">(≈${escapeHtml(formatCnyYuan(totalBuyerCny))})</span>` : ''}</span>
      <span>预计实收 <strong class="smbl-price-net">${escapeHtml(formatCents(totalSeller, this.wallet))}</strong>${isNonCny && totalSellerCny !== null ? ` <span class="smbl-muted">(≈${escapeHtml(formatCnyYuan(totalSellerCny))})</span>` : ''}</span>
      ${
        overallRatio
          ? `<span>成本 <strong>${escapeHtml(formatCnyYuan(costCoveredCostCny))}</strong> · 综合余额率 <strong class="${overallRatioCls}">${overallRatio.formatted}</strong></span>`
          : ''
      }
    `;
  }

  private renderLogs(): void {
    const el = document.getElementById('smbl-log-list');
    if (!el) return;
    el.innerHTML = this.logs
      .map(
        (l) =>
          `<div class="smbl-log-item smbl-log-${l.level}">[${l.time}] ${escapeHtml(l.text)}</div>`,
      )
      .join('');
    el.scrollTop = el.scrollHeight;
  }

  private renderProgress(): void {
    const wrap = document.getElementById('smbl-progress-wrap');
    const label = document.getElementById('smbl-progress-label');
    const count = document.getElementById('smbl-progress-count');
    const fill = document.getElementById('smbl-progress-fill');
    if (!wrap || !label || !count || !fill) return;

    const visible = this.isRunningTask !== 'none';
    wrap.classList.toggle('smbl-visible', visible);
    if (!visible) return;

    const pct = this.progressTotal > 0 ? Math.min(100, (this.progressCurrent / this.progressTotal) * 100) : 0;
    label.textContent = this.isPaused ? `已暂停 — ${this.progressLabel}` : this.progressLabel;
    count.textContent = `${this.progressCurrent} / ${this.progressTotal}`;
    fill.style.width = `${pct.toFixed(1)}%`;
  }

  private renderTaskControls(): void {
    const busy = this.isRunningTask !== 'none';
    const pauseBtn = document.getElementById('smbl-pause-btn') as HTMLButtonElement | null;
    const skipRestBtn = document.getElementById('smbl-skip-rest-btn') as HTMLButtonElement | null;
    const stopBtn = document.getElementById('smbl-stop-btn') as HTMLButtonElement | null;
    const sellBtn = document.getElementById('smbl-start-sell-btn') as HTMLButtonElement | null;
    const multisellBtn = document.getElementById('smbl-multisell-btn') as HTMLButtonElement | null;
    const fetchBtn = document.getElementById('smbl-fetch-price-btn') as HTMLButtonElement | null;
    const refreshBtn = document.getElementById('smbl-refresh-price-btn') as HTMLButtonElement | null;
    const rescanBtn = document.getElementById('smbl-rescan-btn') as HTMLButtonElement | null;
    const retryBtn = document.getElementById('smbl-retry-failed-btn') as HTMLButtonElement | null;

    if (pauseBtn) {
      pauseBtn.style.display = busy ? 'inline-flex' : 'none';
      pauseBtn.textContent = this.isPaused ? '▶ 继续' : '⏸ 暂停';
    }
    if (skipRestBtn) {
      skipRestBtn.style.display = busy && this.isResting ? 'inline-flex' : 'none';
    }
    if (stopBtn) stopBtn.style.display = busy ? 'inline-flex' : 'none';
    if (sellBtn) sellBtn.disabled = busy || this.isScanning;
    if (multisellBtn) multisellBtn.disabled = busy || this.isScanning;
    if (fetchBtn) fetchBtn.disabled = busy || this.isScanning;
    if (refreshBtn) refreshBtn.disabled = busy || this.isScanning;
    if (rescanBtn) rescanBtn.disabled = busy || this.isScanning;
    if (retryBtn) {
      retryBtn.style.display = !busy && this.failedQueue.length > 0 ? 'inline-flex' : 'none';
      retryBtn.textContent = `🔁 重试失败项 (${this.failedQueue.length})`;
    }
    this.renderProgress();
  }

  private renderAll(): void {
    this.syncSettingsControls();
    this.renderGameTabs();
    this.renderTable();
    this.renderSummary();
    this.renderLogs();
    this.renderTaskControls();
  }
}

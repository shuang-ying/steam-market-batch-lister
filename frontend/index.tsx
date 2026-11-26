import {
  definePlugin,
  Dropdown,
  Field,
  SliderField,
  ToggleField,
} from 'millennium';
import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  type CustomPriceMode,
  type PluginSettings,
  type PricingStrategy,
} from '../webview/types';

const STRATEGY_OPTIONS = [
  { data: 'lowest_sell', label: '最低卖价（跟随市场最低挂单价）' },
  { data: 'lowest_sell_minus_1', label: '卖家减 0.01（低于最低卖价 1 分抢先成交）' },
  { data: 'highest_buy', label: '最高求购（按最高求购价秒出）' },
  { data: 'custom', label: '自定义价格（统一固定价 / 偏移 / 比例）' },
];

const CUSTOM_MODE_OPTIONS = [
  { data: 'fixed_buyer', label: '统一固定价（买家付 · 免查价直挂）' },
  { data: 'fixed_seller', label: '统一固定价（卖家实收 · 免查价直挂）' },
  { data: 'offset_lowest_sell', label: '最低卖价 ± 固定金额偏移' },
  { data: 'percent_lowest_sell', label: '最低卖价 × 百分比(%)' },
];

const MarketIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3h2l.4 2M7 13h10l4-8H5.4" />
    <circle cx="9" cy="19" r="1.5" />
    <circle cx="17" cy="19" r="1.5" />
    <path d="M13 6l-2 4h3l-2 4" />
  </svg>
);

const SettingsContent = () => {
  const [settings, setSettings] = useState<PluginSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [statusText, setStatusText] = useState('');

  useEffect(() => {
    let active = true;
    backend
      .get_settings_json()
      .then((raw) => {
        if (!active) return;
        try {
          const parsed = JSON.parse(raw) as Partial<PluginSettings>;
          setSettings({ ...DEFAULT_SETTINGS, ...parsed });
        } catch {
          setSettings(DEFAULT_SETTINGS);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateSettings = (patch: Partial<PluginSettings>) => {
    const next: PluginSettings = { ...settings, ...patch };
    setSettings(next);
    backend
      .save_settings_json(JSON.stringify(next))
      .then((ok) => {
        setStatusText(ok ? '设置已保存（重新打开库存页生效）' : '保存失败');
      })
      .catch(() => {
        setStatusText('保存失败');
      });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <Field
        label="使用说明"
        description="在 Steam 客户端打开「个人资料 → 库存」（支持 CS2 / Dota 2 / TF2 / Steam 通用及任意游戏），点击页面内的「⚡ 市场批量上架」按钮即可打开工作台。"
      />

      <Field
        label="默认定价策略"
        description="打开库存批量上架面板时默认选中的定价模式"
      >
        <Dropdown
          rgOptions={STRATEGY_OPTIONS}
          selectedOption={settings.strategy}
          disabled={!loaded}
          onChange={(opt) => updateSettings({ strategy: opt.data as PricingStrategy })}
        />
      </Field>

      {settings.strategy === 'custom' ? (
        <Field
          label="自定义价格默认模式"
          description="具体金额或比例可在库存批量上架面板中随时调整"
        >
          <Dropdown
            rgOptions={CUSTOM_MODE_OPTIONS}
            selectedOption={settings.customPriceMode}
            disabled={!loaded}
            onChange={(opt) => updateSettings({ customPriceMode: opt.data as CustomPriceMode })}
          />
        </Field>
      ) : null}

      <ToggleField
        label="开启「🛡 拟真防风控」类人节奏模式"
        description="开启后使用随机区间延迟（默认 2.2s~5.2s）+ 偶尔微停顿 + 分批自动休眠 + 连续 429 自动熔断，贴近真实玩家上架节奏"
        checked={settings.humanMode}
        disabled={!loaded}
        onChange={(checked) => updateSettings({ humanMode: checked })}
      />

      {settings.humanMode ? (
        <SliderField
          label="分批自动休眠触发件数（0 为关闭）"
          description="每成功上架指定件数后自动休息 30~60 秒（可在面板中手动跳过或去手机确认令牌）"
          value={settings.batchRestEvery}
          min={0}
          max={100}
          step={5}
          showValue
          valueSuffix=" 件"
          disabled={!loaded}
          onChange={(val) => updateSettings({ batchRestEvery: val })}
        />
      ) : null}

      <SliderField
        label="连续 429 自动熔断阈值（0 为关闭）"
        description="连续触发该次数 Steam 429 限流后立即自动暂停队列，防止反复撞风控墙"
        value={settings.circuitBreakerMax429}
        min={0}
        max={5}
        step={1}
        showValue
        valueSuffix=" 次"
        disabled={!loaded}
        onChange={(val) => updateSettings({ circuitBreakerMax429: val })}
      />

      <SliderField
        label="异常低价拦截警告阈值（0 为关闭）"
        description="当上架标价低于市场最低卖价的该百分比时标红并在确认窗口重点提醒"
        value={settings.lowPriceWarnPercent}
        min={0}
        max={95}
        step={5}
        showValue
        valueSuffix=" %"
        disabled={!loaded}
        onChange={(val) => updateSettings({ lowPriceWarnPercent: val })}
      />

      <ToggleField
        label="全选时跳过含印花 / 改名 / 宝石物品"
        description="自动保护 CS2 印花/挂件/改名枪、Dota 2 镶嵌宝石、TF2 涂色/咒语物品，避免按底价误卖"
        checked={settings.skipModified}
        disabled={!loaded}
        onChange={(checked) => updateSettings({ skipModified: checked })}
      />

      <ToggleField
        label="同类物品默认保留 1 件"
        description="开启后“全选”仅选中库存数量大于 1 的物品，并默认上架 (总数 - 1) 件"
        checked={settings.keepOneDuplicate}
        disabled={!loaded}
        onChange={(checked) => updateSettings({ keepOneDuplicate: checked })}
      />

      <ToggleField
        label="打开库存页时自动弹出批量上架面板"
        description="默认关闭，需要时手动点击库存页中的「⚡ 市场批量上架」按钮"
        checked={settings.autoOpenOnInventory}
        disabled={!loaded}
        onChange={(checked) => updateSettings({ autoOpenOnInventory: checked })}
      />

      <SliderField
        label="高价提醒阈值（元）"
        description="单件上架价达到该金额时标红并在确认窗口重点提醒（设为 0 关闭提醒）"
        value={Math.round(settings.highValueThresholdCents / 100)}
        min={0}
        max={1000}
        step={10}
        showValue
        valueSuffix=" 元"
        disabled={!loaded}
        onChange={(val) => updateSettings({ highValueThresholdCents: Math.round(val * 100) })}
      />

      <SliderField
        label="批量查价间隔（毫秒）"
        description="建议 1500ms 及以上，过快容易触发 Steam 429 限流"
        value={settings.priceDelayMs}
        min={500}
        max={5000}
        step={100}
        showValue
        valueSuffix=" ms"
        disabled={!loaded}
        onChange={(val) => updateSettings({ priceDelayMs: val })}
      />

      <SliderField
        label="批量上架间隔（毫秒）"
        description="每件物品提交挂单之间的等待时间，建议 1000ms ~ 2000ms"
        value={settings.sellDelayMs}
        min={500}
        max={5000}
        step={100}
        showValue
        valueSuffix=" ms"
        disabled={!loaded}
        onChange={(val) => updateSettings({ sellDelayMs: val })}
      />

      {statusText ? (
        <Field label="状态" description={statusText} bottomSeparator="none" />
      ) : null}
    </div>
  );
};

export default definePlugin(() => ({
  title: 'Steam 市场批量上架助手',
  icon: <MarketIcon />,
  content: <SettingsContent />,
}));

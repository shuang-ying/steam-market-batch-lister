<div align="center">

# ⚡ Steam Market Batch Lister

**基于 [Millennium](https://steambrew.app/) 的 Steam 桌面客户端原生市场批量上架插件**

支持 **CS2 / Dota 2 / TF2 / Steam 通用库存**及任意游戏 · 四大定价策略 · 拟真防风控节奏 · 同源油猴双端构建

[![Millennium](https://img.shields.io/badge/Millennium-%3E%3Dv3.4.0-1b2838?logo=steam&logoColor=66c0f4)](https://steambrew.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

</div>

---

## ✨ 功能特性

### 1. 全库存扫描与智能分组
- **多游戏原生支持**：置顶快捷切换 **CS2 (`730`)**、**Dota 2 (`570`)**、**TF2 (`440`)**、**Steam 通用库存 (`753/6`，集换式卡牌 / 表情 / 背景 / 补充包)**，同时自动兼容库存中其他所有支持社区市场的游戏。
- **突破分页限制**：自动加载完整库存并过滤不可出售物品，同类物品自动按数量聚合，支持搜索筛选、全选、仅选重复、反选以及指定上架数量。
- **隔离上下文全兼容**：同时支持主世界 `g_ActiveInventory` 与 Millennium 隔离 WebKit 环境下的 Steam 同源库存接口，开箱即用。

### 2. 四大定价策略 + 精准手续费反算
| 策略 | 说明 | 是否需要先查价 |
| :--- | :--- | :---: |
| **最低卖价** | 跟随当前市场最低在售挂单价 | 是 |
| **卖家减 0.01** | 低于最低卖价 1 个最小货币单位（自动保底合法最低价），抢占第一顺位 | 是 |
| **最高求购（秒出）** | 自动获取并本地缓存 `item_nameid`，查询官方挂单簿按最高求购价即时成交 | 是 |
| **自定义价格** | 支持 **固定买家付**、**固定卖家实收**、**最低卖价 ± 偏移**、**最低卖价 × 百分比**，并支持分批锁定单行价与表格内直接手填 | 固定价**免查价** |

- **精准手续费计算**：自动读取 Steam 钱包币种与费率（默认 Steam 5% + 发行商 10%，兼容 45+ 种 Steam 官方货币，支持「整数上架」对齐选项），实时展示买家标价与卖家预计实收。
- **每日实时汇率 & 人民币折算**：按自然日自动查询一次当前 Steam 账户货币兑人民币（CNY）汇率并本地缓存（支持点击顶部汇率手动刷新或自定义），列表、底部汇总与确认弹窗同步展示上架价与预计实收的人民币折算金额。
- **成本价与余额率计算**：每件饰品均可选填「成本价（人民币）」（按物品名本地自动记忆），实时计算 **余额率 = 成本价 ÷ 卖出实际获得价（人民币）**（精确到小数点后 3 位，如 `1 / 1.5 = 0.667`），底部汇总区同步计算已填成本物品的总成本与综合余额率。
- **📜 本地持久化上架记录**：每次通过插件成功上架的物品均自动落盘保存当时的完整数据（时间、游戏、物品、策略、原币种及折合人民币标价/实收、当时汇率、成本价与余额率），支持在「上架记录」页按游戏/时间/关键词检索、统计累计实收与综合余额率，并支持一键导出 Excel 兼容的 CSV 账单。

### 3. 🛡 安全防护与拟真防风控
- **类人随机节奏（默认开启）**：采用三角分布随机延迟（默认 `2.2s ~ 5.2s`）+ 偶尔自然微停顿 + 查价抖动，避免固定周期请求特征。
- **分批自动休眠**：默认每成功上架 `20` 件自动休眠 `30 ~ 60` 秒（带倒计时与「跳过休眠」按钮），方便期间在手机 Steam Guard 确认令牌。
- **429 自动熔断保护**：单次触发 `HTTP 429` 自动指数退避重试，连续触发多次限流立即自动暂停队列，防止持续撞风控墙。
- **大宗商品官方通道**：针对 CS2 箱子/胶囊、集换式卡牌等可堆叠大宗商品（标记 `大宗` 徽章），支持一键跳转 Steam 官方原生 `/market/multisell` 批量出售页（单次请求，零限流）。
- **防误卖与二次确认**：
  - 自动识别并单独拆组 **CS2 印花/挂件/布章/改名标签**、**Dota 2 宝石/签名**、**TF2 涂色/连杀/奇异部件/咒语**，全选时默认跳过；
  - 支持高价提醒阈值与异常低价警告（低于市场最低价 70% 时标红拦截）；
  - 上架前弹出完整汇总与明细预览，二次确认后再执行。
- **零账号敏感信息**：全程复用当前已登录 Steam 客户端的同源会话，**不收集、不接触**账号密码、Steam API Key 或 `.maFile`。

---

## 📦 安装方式

### 方式一：安装到 Steam 桌面客户端（推荐）

#### 1. 安装前置框架 Millennium
> 需要 [Millennium](https://steambrew.app/) **>= v3.4.0**。

**完全退出 Steam** 后，在 Windows PowerShell 中执行官方安装命令：
```powershell
iwr -useb "https://steambrew.app/install.ps1" | iex
```
或前往 [SteamClientHomebrew/Installer Releases](https://github.com/SteamClientHomebrew/Installer/releases) 下载 `MillenniumInstaller-Windows.exe` 图形化安装器。

#### 2. 安装本插件

- **从 Releases 安装**（若已发布 `.star` 包）：
  下载 `com.steammarket.batchlister.star`，复制到 `<你的 Steam 目录>\millennium\plugins\` 目录下。
- **从源码一键构建安装**（需要 Node.js >= 18）：
  ```powershell
  git clone https://github.com/shuang-ying/steam-market-batch-lister.git
  cd steam-market-batch-lister
  npm install
  npm run build:install
  ```
  > 若自动检测不到 Steam 路径，可手动指定：`.\scripts\install-millennium.ps1 -SteamPath "D:\Steam"`

#### 3. 启用插件
1. **完全退出并重启** Steam 客户端。
2. 在 Steam 客户端打开 **Millennium → 插件（Plugins）**，启用 **Steam Market Batch Lister**。
3. 打开 **个人资料 → 库存**，点击页面内的 **「⚡ 市场批量上架」** 按钮即可打开工作台。

---

### 方式二：浏览器油猴脚本（Tampermonkey / Violentmonkey）

如果你习惯在 Chrome / Edge / Firefox 浏览器中管理 Steam 库存，也可以直接构建单文件油猴脚本：

```powershell
npm install
npm run build:userscript
```

将生成的 `dist/steam-market-batch-lister.user.js` 导入 Tampermonkey / Violentmonkey 后，打开 `steamcommunity.com` 个人库存页即可使用相同界面与功能。

---

## 🧭 使用指南

1. 进入 Steam **个人资料 → 库存**，点击 **「⚡ 市场批量上架」**。
2. 在工作台顶部选择目标游戏（**CS2 / Dota 2 / TF2 / Steam 通用**或其它游戏），等待自动扫描完成。
3. 勾选待出售物品，选择定价策略（**最低卖价 / 卖家减 0.01 / 最高求购 / 自定义价格**）：
   - 使用行情策略时，点击 **「📊 批量查价」** 获取市场报价；
   - 使用「自定义价格 → 固定买家付 / 固定卖家实收」时，可直接免查价上架；
   - 出售大量同类箱子、卡牌等大宗物品时，推荐点击 **「📦 官方批量出售(大宗)」**。
4. 点击 **「🚀 确认批量上架」**，在预览弹窗中核对总件数、标价、预计实收与风控警告后开始执行。
5. 如挂单触发 Steam 安全校验，请前往手机 Steam App 的 **「确认」** 列表统一确认。

---

## 🛠️ 项目结构与开发

```text
├── backend/
│   └── main.lua             # Millennium Lua 后端（配置持久化与 RPC）
├── frontend/
│   └── index.tsx            # Millennium 原生设置页（React / TSX）
├── webview/
│   ├── preload.ts           # WebKit 注入入口（匹配 Steam 库存页）
│   ├── inventory.ts         # 库存读取、隔离上下文解析、修饰识别与分组
│   ├── market-api.ts        # Steam 市场查价（挂单簿/概览缓存）与上架接口
│   ├── pricing.ts           # Steam 手续费正反算、四大定价策略与多币种解析
│   ├── pacing.ts            # 拟真随机延迟、分批休眠、异常低价检测与 multisell URL
│   ├── settings.ts          # 跨后端/本地配置同步
│   ├── styles.ts            # 作用域隔离的 Steam 深色主题样式
│   └── ui.ts                # 批量上架工作台界面与任务调度器
├── scripts/
│   ├── build-userscript.mjs # 同源构建 Tampermonkey 油猴脚本
│   ├── install-millennium.ps1 # Windows 自动安装脚本
│   └── run-tests.mjs        # 单元测试运行器
├── tests/
│   └── pricing.test.ts      # 单元测试（手续费/策略/币种/隔离解析/防风控）
└── millennium.toml          # Millennium v3 插件配置
```

### 常用命令

```powershell
npm run typecheck         # TypeScript 严格类型检查
npm test                  # 运行全部单元测试
npm run build             # 构建 Millennium 发布包 (dist/com.steammarket.batchlister.star)
npm run build:install     # 构建并自动安装到本机 Steam Millennium 插件目录
npm run build:userscript  # 构建浏览器油猴脚本 (dist/steam-market-batch-lister.user.js)
npm run dev               # Millennium 热重载开发模式 (starlight watch)
```

---

## ⚠️ 免责声明与风控提示

- 本项目仅供个人整理库存、提升 Steam 市场操作效率的学习与交流使用，与 Valve Corporation 无任何关联。
- 请合理控制单次上架数量与频率，保持稳定网络环境，避免高频撤单/反复压价。
- 使用本工具产生的交易行为及账号相关风险由使用者自行承担；上架前请务必通过二次确认弹窗仔细核对价格。

## 📄 更新日志与开源协议

- 完整版本变更记录请查看 [CHANGELOG.md](./CHANGELOG.md)
- 开源协议：[MIT](./LICENSE)

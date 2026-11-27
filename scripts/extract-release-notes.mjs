import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tag = (process.argv[2] || '').trim();
const outPath = resolve(process.argv[3] || 'dist/release-notes.md');

const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf8');

function extractVersionSection(md, versionTag) {
  if (!versionTag) return '';
  const escaped = versionTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^##\\s+\\[${escaped}\\][^\\n]*\\r?\\n`, 'm');
  const match = headingRe.exec(md);
  if (!match) return '';

  const start = match.index + match[0].length;
  const rest = md.slice(start);
  const nextHeading = rest.search(/^##\s+\[/m);
  const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading))
    .replace(/\r?\n---\s*$/m, '')
    .trim();
  return section;
}

const section = extractVersionSection(changelog, tag);

const installGuide = `## 📦 安装方式

### 1. Steam 桌面客户端（Millennium >= v3.4.0）
1. 下载下方附件中的 **\`com.steammarket.batchlister.star\`**；
2. 复制到 \`<你的 Steam 安装目录>\\millennium\\plugins\\\` 目录；
3. 完全退出并重启 Steam 客户端，在 **Millennium → 插件** 中启用 **Steam Market Batch Lister**；
4. 打开 Steam **个人资料 → 库存**，点击 **「⚡ 市场批量上架」** 即可使用。

### 2. 浏览器油猴脚本（备用版）
- 下载下方附件中的 **\`steam-market-batch-lister.user.js\`**，导入 Tampermonkey / Violentmonkey 即可在网页版 Steam 库存使用。`;

const body = section
  ? `## 📋 更新日志 (${tag})\n\n${section}\n\n---\n\n${installGuide}\n`
  : `${installGuide}\n`;

writeFileSync(outPath, body, 'utf8');
console.log(`Generated release notes for ${tag || '(default)'} -> ${outPath}`);

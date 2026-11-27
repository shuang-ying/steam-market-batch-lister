import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const banner = `// ==UserScript==
// @name         Steam 市场批量上架助手 (Steam Market Batch Lister)
// @namespace    com.steammarket.batchlister
// @version      1.2.0
// @description  支持 CS2 / Dota 2 / TF2 / Steam 通用库存批量查价与上架（最低卖价、卖家减 0.01、最高求购秒出）
// @match        https://steamcommunity.com/id/*/inventory*
// @match        https://steamcommunity.com/profiles/*/inventory*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
`;

mkdirSync(resolve('dist'), { recursive: true });

await build({
  stdin: {
    contents: `import main from './webview/preload.ts'; main();`,
    resolveDir: resolve('.'),
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: resolve('dist/steam-market-batch-lister.user.js'),
  banner: { js: banner },
  minify: false,
});

console.log('Built userscript -> dist/steam-market-batch-lister.user.js');
